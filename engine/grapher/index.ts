// engine/grapher/index.ts — Grapher orchestrator: assembles EcosystemGraph from all repo manifests

import type { RepoManifest, EcosystemGraph, Mismatch, ApiBridge, TypeDef } from '../types.js';

import { buildInternalDeps, detectCrossRepoDeps } from './dependency-graph.js';
import { mapApiContracts, compareFieldDefinitions } from './api-contract-map.js';
import { analyzeImpact } from './impact-analyzer.js';
import { mapTypeFlows } from './type-flow.js';

/**
 * Build a complete EcosystemGraph from a set of repo manifests.
 *
 * Pipeline:
 * 1. Build internal deps for each manifest
 * 2. Detect cross-repo deps
 * 3. Map API contracts -> bridges
 * 4. Map type flows -> sharedTypes
 * 5. Find contract mismatches
 * 6. Analyze impact for uncommitted changes
 * 7. Assemble EcosystemGraph
 */
export function buildEcosystemGraph(manifests: RepoManifest[]): EcosystemGraph {
  // 1. Build internal deps for each manifest and enrich manifests in-place
  const enrichedManifests = manifests.map((manifest) => {
    const internalDeps = buildInternalDeps(manifest);
    return {
      ...manifest,
      dependencies: {
        ...manifest.dependencies,
        internal: internalDeps,
      },
    };
  });

  // 2. Detect cross-repo deps (informational — stored in bridges and sharedTypes)
  // We don't store crossRepoDeps directly in the graph, but they inform our analysis
  detectCrossRepoDeps(enrichedManifests);

  // 3. Map API contracts -> bridges
  const bridges = mapApiContracts(enrichedManifests);

  // 4. Map type flows -> sharedTypes
  const sharedTypes = mapTypeFlows(enrichedManifests);

  // 5. Find contract mismatches from bridges
  const contractMismatches = findContractMismatches(bridges, enrichedManifests);

  // 6. Analyze impact for uncommitted changes
  // Build a partial graph for impact analysis (needs repos and bridges populated)
  const partialGraph: EcosystemGraph = {
    repos: enrichedManifests,
    bridges,
    sharedTypes,
    contractMismatches,
    impactPaths: [],
  };

  const changedFiles = collectUncommittedChanges(enrichedManifests);
  const impactPaths = analyzeImpact(partialGraph, changedFiles);

  // 7. Assemble final EcosystemGraph
  return {
    repos: enrichedManifests,
    bridges: bridges.map((bridge) => ({
      ...bridge,
      sourceKind: bridge.sourceKind ?? 'mixed',
      confidence: bridge.confidence ?? 0.76,
      provenance: bridge.provenance ?? [
        {
          sourceKind: 'parser',
          adapter: 'graph-contract-map',
          detail: 'api contract mapping',
          confidence: 0.76,
        },
      ],
    })),
    sharedTypes: sharedTypes.map((lineage) => ({
      ...lineage,
      sourceKind: lineage.sourceKind ?? 'mixed',
      confidence: lineage.confidence ?? 0.72,
      provenance: lineage.provenance ?? [
        {
          sourceKind: 'parser',
          adapter: 'type-flow-map',
          detail: 'shared type lineage',
          confidence: 0.72,
        },
      ],
    })),
    contractMismatches: contractMismatches.map((mismatch) => ({
      ...mismatch,
      sourceKind: mismatch.sourceKind ?? 'mixed',
      confidence: mismatch.confidence ?? (mismatch.severity === 'breaking' ? 0.9 : 0.75),
      riskScore:
        mismatch.riskScore ??
        (mismatch.severity === 'breaking' ? 92 : mismatch.severity === 'warning' ? 63 : 28),
      provenance: mismatch.provenance ?? [
        {
          sourceKind: 'mixed',
          adapter: 'contract-mismatch-detector',
          detail: 'provider/consumer contract mismatch',
          confidence: mismatch.severity === 'breaking' ? 0.9 : 0.75,
        },
      ],
    })),
    impactPaths: impactPaths.map((impactPath) => ({
      ...impactPath,
      sourceKind: impactPath.sourceKind ?? 'mixed',
      confidence: impactPath.confidence ?? 0.7,
      riskScore:
        impactPath.riskScore ??
        impactPath.affected.reduce(
          (highest, affected) =>
            Math.max(
              highest,
              affected.severity === 'breaking' ? 85 : affected.severity === 'warning' ? 55 : 20,
            ),
          0,
        ),
      provenance: impactPath.provenance ?? [
        {
          sourceKind: 'mixed',
          adapter: 'impact-analyzer',
          detail: 'cross-repo impact path',
          confidence: 0.7,
        },
      ],
    })),
    semanticReferences: enrichedManifests.flatMap((manifest) => manifest.symbolReferences ?? []),
    owners: enrichedManifests.flatMap((manifest) => manifest.owners ?? []),
    runtimeSignals: enrichedManifests.flatMap((manifest) => manifest.runtimeSignals ?? []),
  };
}

// ─── Contract Mismatch Detection ────────────────────────────────────────────

/**
 * Extract Mismatch objects from bridges that have mismatched or partial contracts.
 *
 * For each bridge with a mismatch:
 * - Compare provider and consumer output types field by field
 * - Generate specific Mismatch entries for missing, extra, or renamed fields
 */
function findContractMismatches(bridges: ApiBridge[], manifests: RepoManifest[]): Mismatch[] {
  const mismatches: Mismatch[] = [];

  for (const bridge of bridges) {
    if (bridge.contract.matchStatus === 'exact') continue;

    const providerType = bridge.contract.outputType;

    // Find consumer output type (look in the consumer's type registry)
    const consumerManifest = manifests.find((m) => m.repoId === bridge.consumer.repo);
    if (!consumerManifest) continue;

    const consumerType = findConsumerType(consumerManifest, providerType.name);
    if (!consumerType) continue;

    const providerFieldNames = new Set(providerType.fields.map((f) => f.name));
    const consumerFieldNames = new Set(consumerType.fields.map((f) => f.name));

    for (const providerField of providerType.fields) {
      const consumerField = consumerType.fields.find((field) => field.name === providerField.name);
      if (!consumerField) continue;

      const compatibility = compareFieldDefinitions(providerField, consumerField);
      if (compatibility === 'exact') continue;

      mismatches.push({
        kind: 'type-mismatch',
        description: `Field '${providerField.name}' differs between provider ${bridge.provider.repo} and consumer ${bridge.consumer.repo}`,
        provider: {
          repo: bridge.provider.repo,
          file: providerType.source.file,
          line: providerType.source.line,
          field: providerField.name,
        },
        consumer: {
          repo: bridge.consumer.repo,
          file: consumerType.source.file,
          line: consumerType.source.line,
          field: providerField.name,
        },
        severity: compatibility === 'mismatch' ? 'breaking' : 'warning',
      });
    }

    // Find fields in consumer that are not in provider (extra fields)
    for (const field of consumerType.fields) {
      if (!providerFieldNames.has(field.name)) {
        mismatches.push({
          kind: 'extra-field',
          description: `Consumer ${bridge.consumer.repo} expects field '${field.name}' on ${providerType.name} which provider ${bridge.provider.repo} does not provide`,
          provider: {
            repo: bridge.provider.repo,
            file: providerType.source.file,
            line: providerType.source.line,
            field: field.name,
          },
          consumer: {
            repo: bridge.consumer.repo,
            file: consumerType.source.file,
            line: consumerType.source.line,
            field: field.name,
          },
          severity: 'breaking',
        });
      }
    }

    // Find fields in provider that are not in consumer (missing fields — usually a warning)
    if (bridge.contract.matchStatus === 'mismatch') {
      for (const field of providerType.fields) {
        if (!consumerFieldNames.has(field.name)) {
          mismatches.push({
            kind: 'missing-field',
            description: `Consumer ${bridge.consumer.repo} does not use field '${field.name}' from ${providerType.name} provided by ${bridge.provider.repo}`,
            provider: {
              repo: bridge.provider.repo,
              file: providerType.source.file,
              line: providerType.source.line,
              field: field.name,
            },
            consumer: {
              repo: bridge.consumer.repo,
              file: consumerType.source.file,
              line: consumerType.source.line,
            },
            severity: 'info',
          });
        }
      }
    }
  }

  return mismatches;
}

/**
 * Find a consumer type by name in a manifest's type registry.
 */
function findConsumerType(manifest: RepoManifest, typeName: string): TypeDef | undefined {
  const found = manifest.typeRegistry.types.find((t) => t.name === typeName);
  if (found) return found;

  // Check schemas
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

// ─── Uncommitted Change Collection ──────────────────────────────────────────

/**
 * Collect all uncommitted changes across all repos.
 * These become the input for impact analysis.
 */
function collectUncommittedChanges(
  manifests: RepoManifest[],
): Array<{ repo: string; file: string; change: string }> {
  const changes: Array<{ repo: string; file: string; change: string }> = [];

  for (const manifest of manifests) {
    for (const file of manifest.gitState.uncommittedChanges) {
      // Infer change type from filename
      const change = inferChangeType(file);
      changes.push({
        repo: manifest.repoId,
        file,
        change,
      });
    }
  }

  return changes;
}

/**
 * Infer a basic change type from a filename.
 */
function inferChangeType(file: string): string {
  const lower = file.toLowerCase();

  if (
    lower.includes('type') ||
    lower.includes('model') ||
    lower.includes('schema') ||
    lower.includes('interface')
  ) {
    return 'type-change';
  }
  if (lower.includes('route') || lower.includes('api') || lower.includes('endpoint')) {
    return 'route-change';
  }
  return 'implementation-change';
}
