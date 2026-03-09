import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function measure(fn) {
  const start = performance.now();
  const value = await fn();
  return {
    value,
    ms: Number((performance.now() - start).toFixed(1)),
  };
}

async function loadEngine(engine) {
  if (engine) {
    return engine;
  }

  const moduleUrl = new URL('../dist/index.js', import.meta.url);
  const configUrl = new URL('../dist/config.js', import.meta.url);
  assert(
    fs.existsSync(fileURLToPath(moduleUrl)) && fs.existsSync(fileURLToPath(configUrl)),
    'dist output not found. Run `npm run build` before `npm run benchmark:hustlexp:live`.',
  );

  return {
    ...(await import(moduleUrl.href)),
    ...(await import(configUrl.href)),
  };
}

function parseArgs(argv) {
  let configPath = process.env.HUSTLEXP_OMNI_LINK_CONFIG;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--config') {
      configPath = argv[index + 1];
      index++;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { configPath };
}

function defaultThresholds(options) {
  return {
    minRepos: options.minRepos ?? 3,
    minDocsProcedures: options.minDocsProcedures ?? 60,
    minBackendProcedures: options.minBackendProcedures ?? 200,
    minIosCalls: options.minIosCalls ?? 130,
    minBridges: options.minBridges ?? 140,
    minAuthorityFindings: options.minAuthorityFindings ?? 2,
    minHealthOverall: options.minHealthOverall ?? 70,
    maxObsoleteCalls: options.maxObsoleteCalls ?? 0,
    maxTokenCount: options.maxTokenCount,
    maxColdWatchMs: options.maxColdWatchMs ?? 25000,
    maxWarmWatchMs: options.maxWarmWatchMs ?? 1000,
    maxAuthorityMs: options.maxAuthorityMs ?? 20000,
    maxWarmScanMs: options.maxWarmScanMs ?? 1000,
    maxHealthMs: options.maxHealthMs ?? 1000,
    maxImpactMs: options.maxImpactMs ?? 2000,
    maxReviewMs: options.maxReviewMs ?? 1000,
  };
}

export async function runHustleXpLiveBenchmark(options = {}) {
  const logger = options.logger ?? console.log;
  const { configPath } = options.configPath ? options : parseArgs(options.argv ?? []);
  assert(
    configPath,
    'Missing HustleXP config path. Pass --config <path> or set HUSTLEXP_OMNI_LINK_CONFIG.',
  );

  const { loadConfig, watch, authorityStatus, scan, health, impactFromUncommitted, reviewPr } =
    await loadEngine(options.engine);
  const config = loadConfig(configPath);
  assert(
    config.workflowProfile === 'hustlexp',
    'benchmark:hustlexp:live requires workflowProfile "hustlexp".',
  );

  const thresholds = defaultThresholds({
    ...options,
    maxTokenCount: options.maxTokenCount ?? config.context.tokenBudget,
  });

  const coldWatchRun = await measure(() => watch(config, { once: true }));
  const warmWatchRun = await measure(() => watch(config, { once: true }));
  const authorityRun = await measure(() => authorityStatus(config));
  const scanRun = await measure(() => scan(config));
  const healthRun = await measure(() => health(config));
  const impactRun = await measure(() => impactFromUncommitted(config));
  const reviewRun = await measure(() => reviewPr(config, 'main', 'HEAD'));

  const summary = {
    timings: {
      coldWatchMs: coldWatchRun.ms,
      warmWatchMs: warmWatchRun.ms,
      authorityMs: authorityRun.ms,
      warmScanMs: scanRun.ms,
      healthMs: healthRun.ms,
      impactMs: impactRun.ms,
      reviewMs: reviewRun.ms,
    },
    watch: {
      running: coldWatchRun.value.running,
      dirtyRepos: coldWatchRun.value.dirtyRepos,
      branchSignature: coldWatchRun.value.branchSignature,
    },
    authority: {
      currentPhase: authorityRun.value.authority?.currentPhase ?? null,
      blockedApply: authorityRun.value.blockedApply,
      findingCount: authorityRun.value.findings.length,
      docsProcedures: authorityRun.value.procedureCoverage.docs,
      backendProcedures: authorityRun.value.procedureCoverage.backend,
      iosCalls: authorityRun.value.procedureCoverage.iosCalls,
      bridges: authorityRun.value.procedureCoverage.bridges,
      docsOnly: authorityRun.value.procedureCoverage.docsOnly.length,
      backendOnly: authorityRun.value.procedureCoverage.backendOnly.length,
      obsoleteCalls: authorityRun.value.procedureCoverage.obsoleteCalls.length,
      payloadDrift: authorityRun.value.procedureCoverage.payloadDrift.length,
      recommendations: authorityRun.value.recommendations,
    },
    scan: {
      repos: scanRun.value.manifests.length,
      tokenCount: scanRun.value.context.digest.tokenCount,
      bridgeCount: scanRun.value.graph.bridges.length,
      mismatchCount: scanRun.value.graph.contractMismatches.length,
      authorityPhase: scanRun.value.graph.authority?.currentPhase ?? null,
      authorityFindings: (scanRun.value.graph.findings ?? []).filter(
        (finding) => finding.kind === 'authority_drift',
      ).length,
    },
    health: {
      overall: healthRun.value.overall,
    },
    impact: {
      paths: impactRun.value.length,
    },
    review: {
      risk: reviewRun.value.risk.level,
      findings: reviewRun.value.findings.length,
      impactPaths: reviewRun.value.impact.length,
      blocked: reviewRun.value.executionPlan?.blocked ?? false,
    },
    thresholds,
  };

  assert(summary.watch.running, 'Expected daemon watch run to report running=true.');
  assert(
    summary.scan.repos >= thresholds.minRepos,
    `Expected at least ${thresholds.minRepos} repos, got ${summary.scan.repos}.`,
  );
  assert(summary.scan.authorityPhase, 'Expected warm daemon scan to preserve authority metadata.');
  assert(
    summary.scan.authorityFindings >= thresholds.minAuthorityFindings,
    `Expected at least ${thresholds.minAuthorityFindings} authority findings, got ${summary.scan.authorityFindings}.`,
  );
  assert(
    summary.authority.blockedApply,
    'Expected live HustleXP authority status to block apply until reconciliation is complete.',
  );
  assert(
    summary.authority.docsProcedures >= thresholds.minDocsProcedures,
    `Expected at least ${thresholds.minDocsProcedures} docs procedures, got ${summary.authority.docsProcedures}.`,
  );
  assert(
    summary.authority.backendProcedures >= thresholds.minBackendProcedures,
    `Expected at least ${thresholds.minBackendProcedures} backend procedures, got ${summary.authority.backendProcedures}.`,
  );
  assert(
    summary.authority.iosCalls >= thresholds.minIosCalls,
    `Expected at least ${thresholds.minIosCalls} Swift calls, got ${summary.authority.iosCalls}.`,
  );
  assert(
    summary.authority.bridges >= thresholds.minBridges,
    `Expected at least ${thresholds.minBridges} bridges, got ${summary.authority.bridges}.`,
  );
  assert(
    summary.authority.obsoleteCalls <= thresholds.maxObsoleteCalls,
    `Expected at most ${thresholds.maxObsoleteCalls} obsolete Swift calls, got ${summary.authority.obsoleteCalls}.`,
  );
  assert(
    summary.scan.tokenCount <= thresholds.maxTokenCount,
    `Expected token budget <= ${thresholds.maxTokenCount}, got ${summary.scan.tokenCount}.`,
  );
  assert(
    summary.health.overall >= thresholds.minHealthOverall,
    `Expected overall health >= ${thresholds.minHealthOverall}, got ${summary.health.overall}.`,
  );
  if (summary.authority.findingCount > 0) {
    assert(
      summary.authority.blockedApply,
      'Expected authority drift findings to block apply until reconciliation is complete.',
    );
    assert(
      summary.review.blocked,
      'Expected review execution plan to be blocked while authority drift is unresolved.',
    );
  }
  assert(
    coldWatchRun.ms <= thresholds.maxColdWatchMs,
    `Cold watch benchmark regressed: ${coldWatchRun.ms}ms.`,
  );
  assert(
    warmWatchRun.ms <= thresholds.maxWarmWatchMs,
    `Warm watch benchmark regressed: ${warmWatchRun.ms}ms.`,
  );
  assert(
    authorityRun.ms <= thresholds.maxAuthorityMs,
    `Authority benchmark regressed: ${authorityRun.ms}ms.`,
  );
  assert(scanRun.ms <= thresholds.maxWarmScanMs, `Warm scan benchmark regressed: ${scanRun.ms}ms.`);
  assert(healthRun.ms <= thresholds.maxHealthMs, `Health benchmark regressed: ${healthRun.ms}ms.`);
  assert(impactRun.ms <= thresholds.maxImpactMs, `Impact benchmark regressed: ${impactRun.ms}ms.`);
  assert(reviewRun.ms <= thresholds.maxReviewMs, `Review benchmark regressed: ${reviewRun.ms}ms.`);

  logger(JSON.stringify(summary, null, 2));
  return summary;
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  await runHustleXpLiveBenchmark({ argv: process.argv.slice(2) });
}
