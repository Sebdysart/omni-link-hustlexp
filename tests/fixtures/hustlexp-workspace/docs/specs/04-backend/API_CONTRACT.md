# HustleXP API Contract v1.0.0

## Overview

Production: https://api.hustlexp.com/trpc
Development: http://localhost:3000/trpc

## Error Codes

| Code          | Meaning                       |
| ------------- | ----------------------------- |
| HX001         | Task terminal state violation |
| AUTH_REQUIRED | Authentication required       |

## Task Endpoints

### task.create

Create a new task.

**Input:**

```typescript
{
  title: string;
  price: number;
  category?: string;
}
```

**Output:**

```typescript
{
  id: string;
  state: string;
}
```

## Notification Endpoints

### messaging.sendMessage

Send a message.

**Input:**

```typescript
{
  conversationId: string;
  body: string;
}
```

**Output:**

```typescript
{
  id: string;
  body: string;
}
```

### notification.getList

Get notifications.

**Input:** None

**Output:**

```typescript
{
  notifications: string[];
}
```
