// engine/scanner/api-extractor.ts — Extracts exports, routes, and tRPC procedures from source code
import type { ExportDef, RouteDefinition, ProcedureDef } from '../types.js';
import { createParser } from './tree-sitter.js';

// ─── Exports ────────────────────────────────────────────────────────────────

function normalizeSignature(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s*{\s*$/, '').replace(/;$/, '').trim();
}

function signatureBeforeBody(node: any): string {
  return normalizeSignature(node.text.split('{')[0] ?? node.text);
}

function isGoExportedName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isRustPublic(node: any): boolean {
  return node.children.some((child: any) => child.type === 'visibility_modifier' && child.text.startsWith('pub'));
}

function isJavaPublic(node: any): boolean {
  return node.children.some((child: any) => child.type === 'modifiers' && /\bpublic\b/.test(child.text));
}

/**
 * Extract exported symbols from source code.
 * - TypeScript: walks export_statement nodes
 * - Swift: walks top-level function_declaration, class_declaration (struct/class)
 */
export function extractExports(
  source: string,
  file: string,
  language: string,
): ExportDef[] {
  if (language === 'typescript' || language === 'tsx' || language === 'javascript') {
    return extractTSExports(source, file, language);
  }
  if (language === 'swift') {
    return extractSwiftExports(source, file);
  }
  if (language === 'python') {
    return extractPythonExports(source, file);
  }
  if (language === 'go') {
    return extractGoExports(source, file);
  }
  if (language === 'rust') {
    return extractRustExports(source, file);
  }
  if (language === 'java') {
    return extractJavaExports(source, file);
  }
  return [];
}

function extractTSExports(source: string, file: string, language: string): ExportDef[] {
  const parser = createParser(language);
  const tree = parser.parse(source);
  const results: ExportDef[] = [];

  const exportNodes = tree.rootNode.descendantsOfType('export_statement');
  for (const exportNode of exportNodes) {
    const declaration = exportNode.namedChildren.find((c: any) =>
      [
        'function_declaration',
        'class_declaration',
        'interface_declaration',
        'type_alias_declaration',
        'lexical_declaration',
        'enum_declaration',
      ].includes(c.type),
    );
    if (!declaration) continue;

    switch (declaration.type) {
      case 'function_declaration': {
        const nameNode = declaration.childForFieldName('name');
        if (nameNode) {
          results.push({
            name: nameNode.text,
            kind: 'function',
            signature: declaration.text.split('{')[0].trim(),
            file,
            line: declaration.startPosition.row + 1,
          });
        }
        break;
      }
      case 'class_declaration': {
        const nameNode = declaration.descendantsOfType('type_identifier')[0];
        if (nameNode) {
          results.push({
            name: nameNode.text,
            kind: 'class',
            signature: `class ${nameNode.text}`,
            file,
            line: declaration.startPosition.row + 1,
          });
        }
        break;
      }
      case 'interface_declaration': {
        const nameNode = declaration.descendantsOfType('type_identifier')[0];
        if (nameNode) {
          results.push({
            name: nameNode.text,
            kind: 'interface',
            signature: `interface ${nameNode.text}`,
            file,
            line: declaration.startPosition.row + 1,
          });
        }
        break;
      }
      case 'type_alias_declaration': {
        const nameNode = declaration.descendantsOfType('type_identifier')[0];
        if (nameNode) {
          results.push({
            name: nameNode.text,
            kind: 'type',
            signature: declaration.text.replace(/;$/, '').trim(),
            file,
            line: declaration.startPosition.row + 1,
          });
        }
        break;
      }
      case 'enum_declaration': {
        const nameNode = declaration.descendantsOfType('identifier')[0];
        if (nameNode) {
          results.push({
            name: nameNode.text,
            kind: 'enum',
            signature: `enum ${nameNode.text}`,
            file,
            line: declaration.startPosition.row + 1,
          });
        }
        break;
      }
      case 'lexical_declaration': {
        const declarators = declaration.descendantsOfType('variable_declarator');
        for (const declarator of declarators) {
          const nameNode = declarator.childForFieldName('name');
          if (!nameNode) continue;
          const valueNode = declarator.childForFieldName('value');
          const isFunction =
            valueNode &&
            (valueNode.type === 'arrow_function' ||
              valueNode.type === 'function_expression' ||
              valueNode.type === 'function');
          results.push({
            name: nameNode.text,
            kind: isFunction ? 'function' : 'constant',
            signature: declarator.text,
            file,
            line: declarator.startPosition.row + 1,
          });
        }
        break;
      }
    }
  }

  return results;
}

function extractSwiftExports(source: string, file: string): ExportDef[] {
  const parser = createParser('swift');
  const tree = parser.parse(source);
  const results: ExportDef[] = [];
  const root = tree.rootNode;

  // Top-level function_declaration
  for (const child of root.namedChildren) {
    if (child.type === 'function_declaration') {
      const nameNode = child.descendantsOfType('simple_identifier')[0];
      if (nameNode) {
        results.push({
          name: nameNode.text,
          kind: 'function',
          signature: child.text.split('{')[0].trim(),
          file,
          line: child.startPosition.row + 1,
        });
      }
    } else if (child.type === 'class_declaration') {
      // tree-sitter-swift uses class_declaration for both struct and class
      const nameNode = child.descendantsOfType('type_identifier')[0];
      if (nameNode) {
        results.push({
          name: nameNode.text,
          kind: 'class',
          signature: child.text.split('{')[0].trim(),
          file,
          line: child.startPosition.row + 1,
        });
      }
    } else if (child.type === 'protocol_declaration') {
      const nameNode = child.descendantsOfType('type_identifier')[0];
      if (nameNode) {
        results.push({
          name: nameNode.text,
          kind: 'interface',
          signature: child.text.split('{')[0].trim(),
          file,
          line: child.startPosition.row + 1,
        });
      }
    }
  }

  return results;
}

function extractPythonExports(source: string, file: string): ExportDef[] {
  const parser = createParser('python');
  const tree = parser.parse(source);
  const results: ExportDef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === 'function_definition') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode || nameNode.text.startsWith('_')) continue;
      results.push({
        name: nameNode.text,
        kind: 'function',
        signature: normalizeSignature(child.text.split(':')[0] ?? child.text),
        file,
        line: child.startPosition.row + 1,
      });
      continue;
    }

    if (child.type === 'class_definition') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode || nameNode.text.startsWith('_')) continue;
      results.push({
        name: nameNode.text,
        kind: 'class',
        signature: `class ${nameNode.text}`,
        file,
        line: child.startPosition.row + 1,
      });
      continue;
    }

    if (child.type === 'expression_statement') {
      const assignment = child.namedChildren.find((node: any) => node.type === 'assignment');
      const nameNode = assignment?.childForFieldName('left');
      if (!nameNode || nameNode.type !== 'identifier' || !/^[A-Z][A-Z0-9_]*$/.test(nameNode.text)) {
        continue;
      }

      results.push({
        name: nameNode.text,
        kind: 'constant',
        signature: normalizeSignature(child.text),
        file,
        line: child.startPosition.row + 1,
      });
    }
  }

  return results;
}

function extractGoExports(source: string, file: string): ExportDef[] {
  const parser = createParser('go');
  const tree = parser.parse(source);
  const results: ExportDef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (child.type === 'type_declaration') {
      const typeSpecs = child.namedChildren.filter((node: any) => node.type === 'type_spec');
      for (const typeSpec of typeSpecs) {
        const nameNode = typeSpec.childForFieldName('name');
        const typeNode = typeSpec.childForFieldName('type');
        if (!nameNode || !typeNode || !isGoExportedName(nameNode.text)) continue;

        let kind: ExportDef['kind'] = 'type';
        let signature = `type ${nameNode.text}`;
        if (typeNode.type === 'struct_type') {
          kind = 'class';
          signature = `type ${nameNode.text} struct`;
        } else if (typeNode.type === 'interface_type') {
          kind = 'interface';
          signature = `type ${nameNode.text} interface`;
        }

        results.push({
          name: nameNode.text,
          kind,
          signature,
          file,
          line: typeSpec.startPosition.row + 1,
        });
      }
      continue;
    }

    if (child.type === 'function_declaration' || child.type === 'method_declaration') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode || !isGoExportedName(nameNode.text)) continue;

      results.push({
        name: nameNode.text,
        kind: 'function',
        signature: signatureBeforeBody(child),
        file,
        line: child.startPosition.row + 1,
      });
      continue;
    }

    if (child.type === 'const_declaration' || child.type === 'var_declaration') {
      const specs = child.namedChildren.filter((node: any) =>
        node.type === 'const_spec' || node.type === 'var_spec',
      );

      for (const spec of specs) {
        const names = spec.namedChildren.filter((node: any) => node.type === 'identifier');
        for (const nameNode of names) {
          if (!isGoExportedName(nameNode.text)) continue;
          results.push({
            name: nameNode.text,
            kind: 'constant',
            signature: normalizeSignature(spec.text),
            file,
            line: spec.startPosition.row + 1,
          });
        }
      }
    }
  }

  return results;
}

function extractRustExports(source: string, file: string): ExportDef[] {
  const parser = createParser('rust');
  const tree = parser.parse(source);
  const results: ExportDef[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (!isRustPublic(child)) continue;

    const nameNode = child.childForFieldName('name');
    if (!nameNode) continue;

    const kindMap: Record<string, ExportDef['kind']> = {
      function_item: 'function',
      struct_item: 'class',
      enum_item: 'enum',
      trait_item: 'interface',
      const_item: 'constant',
      type_item: 'type',
    };
    const kind = kindMap[child.type];
    if (!kind) continue;

    results.push({
      name: nameNode.text,
      kind,
      signature: signatureBeforeBody(child),
      file,
      line: child.startPosition.row + 1,
    });
  }

  return results;
}

function extractJavaExports(source: string, file: string): ExportDef[] {
  const parser = createParser('java');
  const tree = parser.parse(source);
  const results: ExportDef[] = [];
  const typeKindMap: Record<string, ExportDef['kind']> = {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    record_declaration: 'class',
  };

  for (const child of tree.rootNode.namedChildren) {
    const typeKind = typeKindMap[child.type];
    if (!typeKind || !isJavaPublic(child)) continue;

    const nameNode = child.childForFieldName('name');
    if (!nameNode) continue;

    results.push({
      name: nameNode.text,
      kind: typeKind,
      signature: signatureBeforeBody(child),
      file,
      line: child.startPosition.row + 1,
    });

    const body = child.childForFieldName('body');
    if (!body) continue;

    const isInterface = child.type === 'interface_declaration';
    for (const member of body.namedChildren) {
      if (member.type === 'method_declaration') {
        if (!isInterface && !isJavaPublic(member)) continue;

        const methodName = member.childForFieldName('name');
        if (!methodName) continue;
        results.push({
          name: methodName.text,
          kind: 'function',
          signature: signatureBeforeBody(member),
          file,
          line: member.startPosition.row + 1,
        });
      }

      if (member.type === 'field_declaration' && isJavaPublic(member) && /\bstatic\b/.test(member.text) && /\bfinal\b/.test(member.text)) {
        const declarators = member.namedChildren.filter((node: any) => node.type === 'variable_declarator');
        for (const declarator of declarators) {
          const nameNode = declarator.childForFieldName('name');
          if (!nameNode) continue;
          results.push({
            name: nameNode.text,
            kind: 'constant',
            signature: normalizeSignature(member.text),
            file,
            line: member.startPosition.row + 1,
          });
        }
      }
    }
  }

  return results;
}

const ROUTE_LITERAL_PATTERN = /\/(?:api|v\d+|trpc)\/[A-Za-z0-9_./:{}-]*/;

function extractRoutePathFromLiteral(value: string): string | null {
  if (!value) return null;

  const extractRouteFromPath = (pathValue: string): string | null => {
    const pathMatch = pathValue.match(ROUTE_LITERAL_PATTERN);
    if (!pathMatch) return null;
    return pathMatch[0].replace(/\/$/, '');
  };

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return extractRouteFromPath(new URL(value).pathname);
    }
  } catch {
    // Ignore invalid URLs and continue with substring extraction.
  }

  return extractRouteFromPath(value);
}

function makeCallSiteExport(value: string, file: string, line: number): ExportDef {
  return {
    name: value,
    kind: 'constant',
    signature: value,
    file,
    line,
  };
}

export function extractScriptApiCallSites(source: string, file: string): ExportDef[] {
  const results: ExportDef[] = [];
  const seen = new Set<string>();
  const lines = source.split('\n');
  const trpcChainPattern =
    /\b(?:trpc|client|api|rpc)((?:\.[A-Za-z_]\w*)+)\.(?:query|mutate|subscribe|useQuery|useMutation)\s*\(/g;
  const routeCallPatterns = [
    /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /axios\s*\.\s*(?:get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\brequest\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\.(?:get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*')
    ) {
      continue;
    }

    for (const pattern of routeCallPatterns) {
      pattern.lastIndex = 0;
      let routeMatch: RegExpExecArray | null;
      while ((routeMatch = pattern.exec(line)) !== null) {
        const path = extractRoutePathFromLiteral(routeMatch[1]);
        if (!path) continue;
        const key = `route:${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(makeCallSiteExport(path, file, i + 1));
        }
      }
    }

    const stringLiteralPattern = /["'`](.*?)["'`]/g;
    let stringMatch: RegExpExecArray | null;
    while ((stringMatch = stringLiteralPattern.exec(line)) !== null) {
      const literalValue = stringMatch[1];
      if (
        (line.includes('trpc') || line.includes('query(') || line.includes('mutation(') || line.includes('subscribe(')) &&
        /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(literalValue)
      ) {
        const key = `proc:${literalValue}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(makeCallSiteExport(literalValue, file, i + 1));
        }
      }
    }

    trpcChainPattern.lastIndex = 0;
    let chainMatch: RegExpExecArray | null;
    while ((chainMatch = trpcChainPattern.exec(line)) !== null) {
      const procedure = chainMatch[1].slice(1);
      const key = `proc:${procedure}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(makeCallSiteExport(procedure, file, i + 1));
      }
    }
  }

  return results;
}

/**
 * Regex-scan Swift source for outbound API call sites:
 * - URL path strings like "/api/users", "/v1/posts", "/trpc/..."
 * - tRPC procedure name strings like "user.create", "post.getAll"
 *
 * Returns ExportDef entries whose `signature` contains the URL path or
 * procedure name string. This lets mapApiContracts() detect iOS→backend
 * bridges via findConsumerReferences() signature matching, without needing
 * full AST parsing of call expressions.
 */
export function extractSwiftApiCallSites(source: string, file: string): ExportDef[] {
  const results: ExportDef[] = [];
  const lines = source.split('\n');

  // URL path pattern: string literals that are API paths.
  // Matches: "/api/...", "/v1/...", "/v2/...", "/trpc/..."
  // Also matches bare paths starting with "/" followed by 3+ word chars (e.g., "/users")
  const urlPathPattern = /"(?:[^"\\]|\\.)*(\/(?:api|v\d+|trpc)\/[^"\\]*)"/g;

  // tRPC procedure pattern: "namespace.procedureName" — dotted lowercase identifiers
  // Matches things like "user.create", "post.getAll", "auth.login"
  // Both parts must start with lowercase letter, contain only letters/digits
  const trpcProcPattern = /"([a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)"/g;

  // Track seen values to deduplicate (same path appears in multiple methods)
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*')
    ) {
      continue;
    }

    // URL paths
    urlPathPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = urlPathPattern.exec(line)) !== null) {
      const value = match[1];
      const key = `url:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(makeCallSiteExport(value, file, i + 1));
      }
    }

    // tRPC procedure names
    trpcProcPattern.lastIndex = 0;
    while ((match = trpcProcPattern.exec(line)) !== null) {
      const value = match[1];
      const key = `proc:${value}`;
      if (
        !seen.has(key) &&
        (line.includes('trpc') || line.includes('query(') || line.includes('mutation(') || line.includes('subscribe('))
      ) {
        seen.add(key);
        results.push(makeCallSiteExport(value, file, i + 1));
      }
    }
  }

  return results;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

/**
 * Extract GraphQL operations (Query/Mutation/Subscription fields) from SDL source.
 *
 * Known limitations:
 * - Fields with multi-line argument lists are not extracted (args must be on the same line
 *   as the field name, e.g., `field(arg: Type): ReturnType`).
 * - Fields inside inline type declarations (e.g., `type Query { field: T }`) are extracted
 *   only if they fit on a single field per line.
 */
function extractGraphQLOperations(source: string, file: string): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const ROOT_TYPES = ['Query', 'Mutation', 'Subscription'];

  let currentRootType: string | null = null;
  let braceDepth = 0;
  let lineNumber = 0;

  for (const rawLine of source.split('\n')) {
    lineNumber++;
    const line = rawLine.trim();

    // Check if entering a root type block
    if (currentRootType === null) {
      for (const rootType of ROOT_TYPES) {
        if (new RegExp(`^type\\s+${rootType}\\s*\\{`).test(line)) {
          currentRootType = rootType;
          braceDepth = 1;

          // Handle single-line type blocks: type Query { field: T }
          const afterBrace = line.replace(/^[^{]*\{/, '').trim();
          if (afterBrace) {
            // Check if block closes on same line
            if (afterBrace.includes('}')) {
              // Extract any fields between { and }
              const inlineContent = afterBrace.replace(/}.*$/, '').trim();
              const inlineField = inlineContent.match(/^(\w+)\s*(?:\([^)]*\))?\s*:/);
              if (inlineField) {
                routes.push({
                  method: currentRootType.toUpperCase(),
                  path: `/${inlineField[1]}`,
                  handler: inlineField[1],
                  file,
                  line: lineNumber,
                });
              }
              currentRootType = null;
              braceDepth = 0;
            }
            // If not closing on same line, the next loop iteration will pick up
          }
          break; // done checking ROOT_TYPES
        }
      }
      continue;
    }

    // We are inside a root type block — track brace depth
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    if (braceDepth <= 0) {
      currentRootType = null;
      braceDepth = 0;
      continue;
    }

    // Extract field name at depth 1: fieldName(args): ReturnType or fieldName: ReturnType
    if (braceDepth === 1) {
      const fieldMatch = line.match(/^(\w+)\s*(?:\([^)]*\))?\s*:/);
      if (fieldMatch) {
        routes.push({
          method: currentRootType.toUpperCase(),
          path: `/${fieldMatch[1]}`,
          handler: fieldMatch[1],
          file,
          line: lineNumber,
        });
      }
    }
  }

  return routes;
}

/**
 * Extract HTTP route definitions from Hono/Express-style code.
 * Looks for `app.METHOD(path, handler)` patterns.
 * Also handles GraphQL SDL files (.graphql/.gql) via SDL parsing.
 */
export function extractRoutes(
  source: string,
  file: string,
  language: string,
): RouteDefinition[] {
  if (language === 'graphql') {
    return extractGraphQLOperations(source, file);
  }

  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') {
    return [];
  }

  const parser = createParser(language);
  const tree = parser.parse(source);
  const results: RouteDefinition[] = [];

  const callExpressions = tree.rootNode.descendantsOfType('call_expression');
  for (const call of callExpressions) {
    const funcNode = call.childForFieldName('function');
    if (!funcNode || funcNode.type !== 'member_expression') continue;

    const propertyNode = funcNode.childForFieldName('property');
    if (!propertyNode) continue;

    const method = propertyNode.text.toLowerCase();
    if (!HTTP_METHODS.has(method)) continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    // First argument should be a string literal (the path)
    const firstArg = args.namedChildren[0];
    if (!firstArg) continue;

    let path: string | null = null;
    if (firstArg.type === 'string' || firstArg.type === 'template_string') {
      // Strip surrounding quotes
      path = firstArg.text.replace(/^['"`]|['"`]$/g, '');
    }
    if (!path) continue;

    // Handler is second argument (or rest of args)
    const handlerNode = args.namedChildren[1];
    const handler = handlerNode?.text ?? '';

    results.push({
      method: method.toUpperCase(),
      path,
      handler,
      file,
      line: call.startPosition.row + 1,
    });
  }

  return results;
}

// ─── tRPC Procedures ────────────────────────────────────────────────────────

/**
 * Extract tRPC procedure definitions from router({...}) patterns.
 * Each property in the router object maps to a procedure name.
 * The chain terminator (.query/.mutation/.subscription) determines the kind.
 */
export function extractProcedures(
  source: string,
  file: string,
  language: string,
): ProcedureDef[] {
  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') {
    return [];
  }

  const parser = createParser(language);
  const tree = parser.parse(source);
  const results: ProcedureDef[] = [];

  // Find all call_expression nodes where the function is `router`
  const callExpressions = tree.rootNode.descendantsOfType('call_expression');
  for (const call of callExpressions) {
    const funcNode = call.childForFieldName('function');
    if (!funcNode) continue;

    // router(...) direct call
    const isRouterCall =
      (funcNode.type === 'identifier' && funcNode.text === 'router') ||
      (funcNode.type === 'member_expression' &&
        funcNode.childForFieldName('property')?.text === 'router');

    if (!isRouterCall) continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    // First argument should be an object
    const objArg = args.namedChildren.find((c: any) => c.type === 'object');
    if (!objArg) continue;

    // Each pair in the object is a procedure
    const pairs = objArg.descendantsOfType('pair');
    for (const pair of pairs) {
      // Only process direct children (not nested objects)
      if (pair.parent !== objArg) continue;

      const keyNode = pair.childForFieldName('key');
      const valueNode = pair.childForFieldName('value');
      if (!keyNode || !valueNode) continue;

      const procName = keyNode.text;
      const kind = detectProcedureKind(valueNode);
      if (!kind) continue;

      results.push({
        name: procName,
        kind,
        file,
        line: pair.startPosition.row + 1,
      });
    }
  }

  return results;
}

/**
 * Walk a call chain to find the terminal .query(), .mutation(), or .subscription() call.
 */
function detectProcedureKind(node: any): 'query' | 'mutation' | 'subscription' | null {
  // The value is typically a call_expression chain like:
  //   publicProcedure.input(...).query(...)
  // The outermost call_expression has a member_expression whose property is the kind.
  if (node.type === 'call_expression') {
    const funcNode = node.childForFieldName('function');
    if (funcNode?.type === 'member_expression') {
      const prop = funcNode.childForFieldName('property')?.text;
      if (prop === 'query' || prop === 'mutation' || prop === 'subscription') {
        return prop as 'query' | 'mutation' | 'subscription';
      }
    }
  }

  // Recurse into call_expression children
  const callChildren = node.descendantsOfType('call_expression');
  for (const child of callChildren) {
    if (child === node) continue;
    const funcNode = child.childForFieldName('function');
    if (funcNode?.type === 'member_expression') {
      const prop = funcNode.childForFieldName('property')?.text;
      if (prop === 'query' || prop === 'mutation' || prop === 'subscription') {
        return prop as 'query' | 'mutation' | 'subscription';
      }
    }
  }

  return null;
}
