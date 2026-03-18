"""
communication-bus MCP server — file-based message queue for inter-agent communication.

Zero external dependencies. Uses a JSONL file as the message store.
Provides send_message, read_messages, and clear_messages tools.
"""

import json
import os
import sys
import time
from pathlib import Path

QUEUE_PATH = Path(os.environ.get("AGENT_QUEUE_PATH", ".claude/agent-queue.jsonl"))


def ensure_queue():
    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not QUEUE_PATH.exists():
        QUEUE_PATH.touch()


def send_message(to: str, msg: str, sender: str = "unknown") -> dict:
    ensure_queue()
    entry = {
        "to": to,
        "from": sender,
        "msg": msg,
        "ts": time.time(),
        "read": False,
    }
    with open(QUEUE_PATH, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"status": "sent", "to": to, "ts": entry["ts"]}


def read_messages(recipient: str, mark_read: bool = True) -> list:
    ensure_queue()
    messages = []
    updated_lines = []

    with open(QUEUE_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                updated_lines.append(line)
                continue

            if entry.get("to") == recipient or entry.get("to") == "broadcast":
                messages.append(entry)
                if mark_read:
                    entry["read"] = True
            updated_lines.append(json.dumps(entry))

    if mark_read:
        with open(QUEUE_PATH, "w") as f:
            f.write("\n".join(updated_lines) + "\n")

    return messages


def clear_messages(recipient: str = None) -> dict:
    ensure_queue()
    if recipient is None:
        QUEUE_PATH.write_text("")
        return {"status": "cleared", "scope": "all"}

    remaining = []
    removed = 0
    with open(QUEUE_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("to") == recipient:
                    removed += 1
                    continue
            except json.JSONDecodeError:
                pass
            remaining.append(line)

    with open(QUEUE_PATH, "w") as f:
        f.write("\n".join(remaining) + "\n" if remaining else "")

    return {"status": "cleared", "scope": recipient, "removed": removed}


TOOLS = {
    "send_message": {
        "fn": send_message,
        "schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient agent name or 'broadcast'"},
                "msg": {"type": "string", "description": "Message content (JSON or text)"},
                "sender": {"type": "string", "description": "Sender agent name"},
            },
            "required": ["to", "msg"],
        },
    },
    "read_messages": {
        "fn": read_messages,
        "schema": {
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "Read messages for this agent"},
                "mark_read": {"type": "boolean", "description": "Mark messages as read"},
            },
            "required": ["recipient"],
        },
    },
    "clear_messages": {
        "fn": clear_messages,
        "schema": {
            "type": "object",
            "properties": {
                "recipient": {
                    "type": "string",
                    "description": "Clear messages for this agent (omit for all)",
                },
            },
        },
    },
}


def handle_request(req: dict) -> dict:
    method = req.get("method", "")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "communication-bus",
                    "version": "1.0.0",
                },
            },
        }

    if method == "tools/list":
        tools_list = []
        for name, tool in TOOLS.items():
            tools_list.append(
                {
                    "name": name,
                    "description": f"Agent communication: {name.replace('_', ' ')}",
                    "inputSchema": tool["schema"],
                }
            )
        return {
            "jsonrpc": "2.0",
            "id": req.get("id"),
            "result": {"tools": tools_list},
        }

    if method == "tools/call":
        tool_name = req.get("params", {}).get("name")
        args = req.get("params", {}).get("arguments", {})

        if tool_name not in TOOLS:
            return {
                "jsonrpc": "2.0",
                "id": req.get("id"),
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        try:
            result = TOOLS[tool_name]["fn"](**args)
            return {
                "jsonrpc": "2.0",
                "id": req.get("id"),
                "result": {
                    "content": [{"type": "text", "text": json.dumps(result)}],
                },
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req.get("id"),
                "error": {"code": -32000, "message": str(e)},
            }

    if method == "notifications/initialized":
        return None

    return {
        "jsonrpc": "2.0",
        "id": req.get("id"),
        "error": {"code": -32601, "message": f"Unknown method: {method}"},
    }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            response = handle_request(req)
            if response is not None:
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError:
            err = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            }
            sys.stdout.write(json.dumps(err) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
