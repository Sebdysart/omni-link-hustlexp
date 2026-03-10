// engine/grapher/api-contract-map.ts — API contract mapper: bridge detection and type matching across repos

import {
  UNKNOWN_FILE,
  UNKNOWN_LINE,
  type RepoManifest,
  type ApiBridge,
  type TypeDef,
  type TypeField,
  type RouteDefinition,
  type ProcedureDef,
} from '../types.js';

/**
 * Compare two TypeDefs by their field sets.
 *
 * - `exact`: all consumer fields exist in provider with same names
 * - `compatible`: consumer fields are a strict subset of provider fields
 * - `mismatch`: consumer expects fields the provider does not have
 */
export function compareTypes(
  providerType: TypeDef,
  consumerType: TypeDef,
): 'exact' | 'compatible' | 'mismatch' {
  const providerFields = new Map(providerType.fields.map((field) => [field.name, field]));
  let isExact = true;

  for (const consumerField of consumerType.fields) {
    const providerField = providerFields.get(consumerField.name);
    if (!providerField) return 'mismatch';

    const compatibility = compareFieldDefinitions(providerField, consumerField);
    if (compatibility === 'mismatch') return 'mismatch';
    if (compatibility === 'compatible') isExact = false;
  }

  if (consumerType.fields.length !== providerType.fields.length) {
    isExact = false;
  }

  return isExact ? 'exact' : 'compatible';
}

export function compareFieldDefinitions(
  providerField: TypeField,
  consumerField: TypeField,
): 'exact' | 'compatible' | 'mismatch' {
  const providerType = normalizeTypeForComparison(providerField.type);
  const consumerType = normalizeTypeForComparison(consumerField.type);

  if (providerType !== consumerType) return 'mismatch';

  const providerOptional = isOptionalField(providerField);
  const consumerOptional = isOptionalField(consumerField);

  if (providerOptional === consumerOptional) return 'exact';
  if (providerOptional && !consumerOptional) return 'mismatch';
  return 'compatible';
}

function isOptionalField(field: TypeField): boolean {
  if (field.optional === true) return true;
  const raw = field.type.replace(/\s+/g, '');
  return (
    raw.endsWith('?') ||
    /^Optional<.+>$/.test(raw) ||
    /^Option<.+>$/.test(raw) ||
    /^Nullable<.+>$/.test(raw) ||
    /^Maybe<.+>$/.test(raw)
  );
}

export function normalizeTypeForComparison(type: string): string {
  let normalized = type.trim().replace(/\s+/g, '');

  const unwrapOptional = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      if (normalized.endsWith('?')) {
        normalized = normalized.slice(0, -1);
        changed = true;
      }

      const wrapperMatch = normalized.match(/^(Optional|Option|Nullable|Maybe)<(.+)>$/);
      if (wrapperMatch) {
        normalized = wrapperMatch[2];
        changed = true;
      }
    }
  };

  const canonicalize = (value: string): string => {
    const noWhitespace = value.trim().replace(/\s+/g, '');

    const arrayMatch =
      noWhitespace.match(/^Array<(.+)>$/) ??
      noWhitespace.match(/^Vec<(.+)>$/) ??
      noWhitespace.match(/^List<(.+)>$/) ??
      noWhitespace.match(/^\[(.+)\]$/);
    if (arrayMatch) {
      return `array<${canonicalize(arrayMatch[1])}>`;
    }

    if (noWhitespace.endsWith('[]')) {
      return `array<${canonicalize(noWhitespace.slice(0, -2))}>`;
    }

    const primitive = noWhitespace.toLowerCase();
    if (['string', 'str', '&str', 'java.lang.string'].includes(primitive)) return 'string';
    if (['bool', 'boolean'].includes(primitive)) return 'boolean';
    if (
      [
        'number',
        'int',
        'int32',
        'int64',
        'int16',
        'int8',
        'integer',
        'uint',
        'uint32',
        'uint64',
        'usize',
        'isize',
        'float',
        'float32',
        'float64',
        'double',
        'decimal',
        'cgfloat',
      ].includes(primitive)
    ) {
      return 'number';
    }
    if (['date', 'datetime', 'instant', 'timestamp'].includes(primitive)) return 'datetime';
    if (['object', 'map<string,unknown>', 'record<string,unknown>'].includes(primitive)) {
      return 'object';
    }

    return primitive;
  };

  unwrapOptional();
  return canonicalize(normalized);
}

/**
 * Map API contracts across all repos.
 *
 * Finds all API connections by:
 * 1. Collecting routes and procedures from provider repos
 * 2. Scanning consumer repos for references to those routes/procedures
 * 3. Matching output types across the bridge
 * 4. Producing ApiBridge[] with match status
 */
export function mapApiContracts(manifests: RepoManifest[]): ApiBridge[] {
  const bridges: ApiBridge[] = [];

  // Collect all route and procedure providers
  const providers: ProviderEndpoint[] = [];
  for (const manifest of manifests) {
    for (const route of manifest.apiSurface.routes) {
      providers.push({
        repoId: manifest.repoId,
        kind: 'route',
        route,
        procedure: undefined,
        manifest,
      });
    }
    for (const proc of manifest.apiSurface.procedures) {
      providers.push({
        repoId: manifest.repoId,
        kind: 'procedure',
        route: undefined,
        procedure: proc,
        manifest,
      });
    }
  }

  if (providers.length === 0) return [];

  // For each consumer repo, look for references to provider endpoints
  for (const consumerManifest of manifests) {
    for (const provider of providers) {
      if (provider.repoId === consumerManifest.repoId) continue;

      const matches = findConsumerReferences(consumerManifest, provider);
      for (const match of matches) {
        const providerRoute = provider.route;
        const providerProc = provider.procedure;

        const routeLabel =
          provider.kind === 'route' && providerRoute
            ? `${providerRoute.method} ${providerRoute.path}`
            : providerProc
              ? `${providerProc.kind} ${providerProc.name}`
              : 'unknown';

        const handlerName =
          provider.kind === 'route' && providerRoute
            ? providerRoute.handler
            : (providerProc?.name ?? 'unknown');

        // Resolve output type for this endpoint
        const outputTypeName =
          provider.kind === 'route' && providerRoute
            ? providerRoute.outputType
            : providerProc?.outputType;

        const providerOutputType = outputTypeName
          ? findType(provider.manifest, outputTypeName)
          : makeEmptyType('unknown', provider.repoId);

        // Try to find matching type in consumer
        const consumerOutputType = outputTypeName
          ? findType(consumerManifest, outputTypeName)
          : undefined;

        const matchStatus =
          providerOutputType && consumerOutputType
            ? compareTypes(providerOutputType, consumerOutputType)
            : 'compatible'; // If types can't be resolved, assume compatible

        const bridge: ApiBridge = {
          consumer: {
            repo: consumerManifest.repoId,
            file: match.file,
            line: match.line,
          },
          provider: {
            repo: provider.repoId,
            route: routeLabel,
            handler: handlerName,
          },
          contract: {
            inputType: resolveInputType(provider),
            outputType:
              providerOutputType ?? makeEmptyType(outputTypeName ?? 'unknown', provider.repoId),
            matchStatus,
          },
        };

        bridges.push(bridge);
      }
    }
  }

  return bridges;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface ProviderEndpoint {
  repoId: string;
  kind: 'route' | 'procedure';
  route: RouteDefinition | undefined;
  procedure: ProcedureDef | undefined;
  manifest: RepoManifest;
}

interface ConsumerMatch {
  file: string;
  line: number;
}

// ─── Reference Detection ────────────────────────────────────────────────────

/**
 * Find references to a provider endpoint within a consumer manifest.
 *
 * Checks exports for:
 * - URL path string literals (e.g., "/api/users")
 * - Method + path patterns (e.g., "GET /api/users")
 * - Procedure name references (e.g., "user.getProfile")
 */
function findConsumerReferences(
  consumer: RepoManifest,
  provider: ProviderEndpoint,
): ConsumerMatch[] {
  const matches: ConsumerMatch[] = [];

  if (provider.kind === 'route' && provider.route) {
    const route = provider.route;
    const urlPattern = route.path;
    const methodUrlPattern = `${route.method} ${route.path}`;

    // Guard against empty path patterns (would match everything)
    if (!urlPattern) return matches;

    for (const exp of consumer.apiSurface.exports) {
      if (
        exp.signature.includes(urlPattern) ||
        exp.signature.includes(methodUrlPattern) ||
        exp.name.includes(urlPattern)
      ) {
        matches.push({
          file: exp.file || UNKNOWN_FILE,
          line: exp.line ?? UNKNOWN_LINE,
        });
      }
    }
  }

  if (provider.kind === 'procedure' && provider.procedure) {
    const proc = provider.procedure;
    const procName = proc.name;

    // Guard against empty procedure names (would match everything)
    if (!procName) return matches;

    for (const exp of consumer.apiSurface.exports) {
      if (exp.signature.includes(procName) || exp.name.includes(procName)) {
        matches.push({
          file: exp.file || UNKNOWN_FILE,
          line: exp.line ?? UNKNOWN_LINE,
        });
      }
    }
  }

  return matches;
}

// ─── Type Resolution ────────────────────────────────────────────────────────

/**
 * Find a TypeDef by name in a manifest's type registry.
 */
function findType(manifest: RepoManifest, typeName: string): TypeDef | undefined {
  // Search types
  const found = manifest.typeRegistry.types.find((t) => t.name === typeName);
  if (found) return found;

  // Search schemas (convert to TypeDef)
  const schema = manifest.typeRegistry.schemas.find((s) => s.name === typeName);
  if (schema) {
    return {
      name: schema.name,
      fields: schema.fields,
      source: schema.source,
    };
  }

  return undefined;
}

/**
 * Resolve the input type for a provider endpoint.
 */
function resolveInputType(provider: ProviderEndpoint): TypeDef {
  const inputTypeName =
    provider.kind === 'route' ? provider.route?.inputType : provider.procedure?.inputType;

  if (inputTypeName) {
    const found = findType(provider.manifest, inputTypeName);
    if (found) return found;
  }

  return makeEmptyType(inputTypeName ?? 'unknown', provider.repoId);
}

/**
 * Create an empty TypeDef placeholder when the actual type is not found.
 */
function makeEmptyType(name: string, repo: string): TypeDef {
  return {
    name,
    fields: [],
    source: { repo, file: UNKNOWN_FILE, line: UNKNOWN_LINE },
  };
}
