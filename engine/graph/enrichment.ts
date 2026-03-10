import { analyzeAuthorityDrift, loadAuthorityState } from '../authority/index.js';
import { analyzeSwiftTrpcBridge } from '../bridges/swift-trpc.js';
import { attachRuntimeSignals } from '../runtime/index.js';
import type { EcosystemGraph, OmniLinkConfig, ReviewFinding } from '../types.js';
import { attachOwnersToGraph } from '../ownership/index.js';

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return uniqueBy(
    findings,
    (finding) => `${finding.kind}:${finding.repo}:${finding.file}:${finding.line}:${finding.title}`,
  );
}

export function enrichGraphForConfig(
  graph: EcosystemGraph,
  config: OmniLinkConfig,
): EcosystemGraph {
  let nextGraph = graph;

  if (config.workflowProfile === 'hustlexp') {
    const authority = loadAuthorityState(config);
    const bridgeAnalysis = analyzeSwiftTrpcBridge(config, nextGraph, authority);
    const authorityFindings = analyzeAuthorityDrift(nextGraph, authority, {
      backendProcedureIds: bridgeAnalysis.backendProcedures.map(
        (procedure) => `${procedure.router}.${procedure.procedure}`,
      ),
      iosCallCount: bridgeAnalysis.iosCalls.length,
    });

    nextGraph = {
      ...nextGraph,
      bridges: uniqueBy(
        [...nextGraph.bridges, ...bridgeAnalysis.bridges],
        (bridge) =>
          `${bridge.consumer.repo}:${bridge.consumer.file}:${bridge.consumer.line}:${bridge.provider.repo}:${bridge.provider.route}`,
      ),
      contractMismatches: uniqueBy(
        [...bridgeAnalysis.mismatches, ...nextGraph.contractMismatches],
        (mismatch) =>
          `${mismatch.kind}:${mismatch.provider.repo}:${mismatch.provider.file}:${mismatch.provider.field}:${mismatch.consumer.repo}:${mismatch.consumer.file}:${mismatch.description}`,
      ),
      authority: authority ?? undefined,
      findings: dedupeFindings([
        ...(nextGraph.findings ?? []),
        ...authorityFindings,
        ...bridgeAnalysis.findings,
      ]),
    };
  }

  return attachRuntimeSignals(attachOwnersToGraph(nextGraph, config), config);
}
