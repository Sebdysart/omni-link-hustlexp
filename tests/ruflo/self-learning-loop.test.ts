import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelfLearningLoop } from '../../engine/ruflo/coordination/application/SelfLearningLoop.js';
import { HybridBackend } from '../../engine/ruflo/memory/infrastructure/HybridBackend.js';
import { SQLiteBackend } from '../../engine/ruflo/memory/infrastructure/SQLiteBackend.js';
import { AgentDBBackend } from '../../engine/ruflo/memory/infrastructure/AgentDBBackend.js';
import { BuiltInEmbeddingProvider } from '../../engine/ruflo/memory/infrastructure/EmbeddingProvider.js';
import type { OrbitFinding } from '../../engine/ruflo/coordination/application/SelfLearningLoop.js';

describe('ruflo SelfLearningLoop (Gap 2: learn from R52 before R53)', () => {
  let loop: SelfLearningLoop;
  let backend: HybridBackend;

  beforeEach(async () => {
    const sqlite = new SQLiteBackend(':memory:');
    const agentdb = new AgentDBBackend({ dbPath: ':memory:', dimensions: 64 });
    backend = new HybridBackend(sqlite, agentdb);
    await backend.initialize();

    const embedder = new BuiltInEmbeddingProvider(64);
    loop = new SelfLearningLoop(backend, embedder);
  });

  afterEach(async () => {
    await backend.close();
  });

  const r52Findings: OrbitFinding[] = [
    {
      id: 'f1',
      round: 'R52',
      domain: 'auth',
      severity: 'critical',
      title: 'Missing rate limiting on login',
      description: 'Login endpoint allows unlimited attempts',
      fixed: false,
    },
    {
      id: 'f2',
      round: 'R52',
      domain: 'auth',
      severity: 'high',
      title: 'JWT expiry too long',
      description: 'Tokens expire after 30 days instead of 24 hours',
      fixed: true,
      fixedInRound: 'R52',
    },
    {
      id: 'f3',
      round: 'R52',
      domain: 'fin',
      severity: 'critical',
      title: 'Webhook not idempotent',
      description: 'Payment webhook can charge twice on retry',
      fixed: false,
    },
    {
      id: 'f4',
      round: 'R52',
      domain: 'fin',
      severity: 'medium',
      title: 'Missing audit trail on refunds',
      description: 'Refund operations not logged',
      fixed: true,
      fixedInRound: 'R52',
    },
    {
      id: 'f5',
      round: 'R52',
      domain: 'onboarding',
      severity: 'low',
      title: 'Welcome email delayed',
      description: 'Email sent after 10 minutes instead of immediately',
      fixed: true,
      fixedInRound: 'R52',
    },
  ];

  it('records round findings into memory', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const memories = await backend.query({ agentId: 'self-learning-loop' });
    expect(memories).toHaveLength(5);
  });

  it('stores embeddings with findings for vector search', async () => {
    await loop.recordRoundFindings('R52', [r52Findings[0]]);

    const memories = await backend.query({ agentId: 'self-learning-loop' });
    expect(memories[0].embedding).toBeDefined();
    expect(memories[0].embedding!.length).toBe(64);
  });

  it('generates learning report with domain weights', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const report = await loop.generateLearningReport('R53', 'R52', ['auth', 'fin', 'onboarding']);

    expect(report.round).toBe('R53');
    expect(report.priorRound).toBe('R52');
    expect(report.totalPriorFindings).toBe(5);
    expect(report.domainWeights).toHaveLength(3);

    const authWeight = report.domainWeights.find((d) => d.domain === 'auth');
    const finWeight = report.domainWeights.find((d) => d.domain === 'fin');
    const onbWeight = report.domainWeights.find((d) => d.domain === 'onboarding');

    expect(authWeight).toBeDefined();
    expect(finWeight).toBeDefined();
    expect(onbWeight).toBeDefined();

    expect(authWeight!.weight).toBeGreaterThan(onbWeight!.weight);
    expect(finWeight!.weight).toBeGreaterThan(onbWeight!.weight);
  });

  it('recommends high priority for domains with critical findings', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const report = await loop.generateLearningReport('R53', 'R52', ['auth', 'fin', 'onboarding']);

    const authPriority = report.recommendedPriorities.find((p) => p.domain === 'auth');
    expect(authPriority!.priority).toBe('high');
  });

  it('identifies regression candidates from fixed findings', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const report = await loop.generateLearningReport('R53', 'R52', ['auth', 'fin', 'onboarding']);

    expect(report.regressionCandidates.length).toBeGreaterThan(0);
    expect(report.regressionCandidates.every((r) => r.fixed)).toBe(true);
  });

  it('flags regression risk for domains with fixed findings', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const report = await loop.generateLearningReport('R53', 'R52', ['auth', 'fin', 'onboarding']);

    const authWeight = report.domainWeights.find((d) => d.domain === 'auth');
    expect(authWeight!.regressionRisk).toBe(true);
  });

  it('tracks unfixed count per domain', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const report = await loop.generateLearningReport('R53', 'R52', ['auth', 'fin']);

    const authWeight = report.domainWeights.find((d) => d.domain === 'auth');
    expect(authWeight!.unfixedCount).toBe(1);

    const finWeight = report.domainWeights.find((d) => d.domain === 'fin');
    expect(finWeight!.unfixedCount).toBe(1);
  });

  it('computes learning confidence based on data volume', async () => {
    const report1 = await loop.generateLearningReport('R53', null, ['auth']);
    expect(report1.learningConfidence).toBe(0);

    await loop.recordRoundFindings('R52', r52Findings);
    const report2 = await loop.generateLearningReport('R53', 'R52', ['auth']);
    expect(report2.learningConfidence).toBeGreaterThan(0);
    expect(report2.learningConfidence).toBeLessThanOrEqual(1.0);
  });

  it('finds similar findings via vector search', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const similar = await loop.findSimilarFindings('authentication rate limit missing', 3);

    expect(similar.length).toBeGreaterThanOrEqual(1);
  });

  it('gets domain history across rounds', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const history = await loop.getDomainHistory('auth');
    expect(history.totalFindings).toBe(2);
    expect(history.fixedCount).toBe(1);
    expect(history.unfixedCount).toBe(1);
    expect(history.rounds).toContain('R52');
  });

  it('marks findings as fixed', async () => {
    await loop.recordRoundFindings('R52', [r52Findings[0]]);

    const memoryId = `orbit-finding-R52-f1`;
    await loop.markFixed(memoryId, 'R53');

    const memory = await backend.retrieve(memoryId);
    expect(memory?.metadata?.fixed).toBe(true);
    expect(memory?.metadata?.fixedInRound).toBe('R53');
  });

  it('learning improves over multiple rounds', async () => {
    await loop.recordRoundFindings('R52', r52Findings);

    const r53Findings: OrbitFinding[] = [
      {
        id: 'f6',
        round: 'R53',
        domain: 'auth',
        severity: 'high',
        title: 'Session fixation vulnerability',
        description: 'Session not regenerated after login',
        fixed: false,
      },
    ];
    await loop.recordRoundFindings('R53', r53Findings);

    const report = await loop.generateLearningReport('R54', 'R53', ['auth', 'fin', 'onboarding']);

    expect(report.totalPriorFindings).toBe(6);

    const authWeight = report.domainWeights.find((d) => d.domain === 'auth');
    expect(authWeight!.priorFindings).toBe(3);
    expect(authWeight!.weight).toBeGreaterThan(0);
  });
});
