/**
 * SelfLearningLoop — Learns from past orbit rounds to improve future ones.
 *
 * Closes Gap 2: implements the "learn from R52 before running R53" logic.
 *
 * Architecture:
 * 1. After each orbit round, findings are stored with round metadata + embeddings
 * 2. Before a new round, the loop queries past findings by domain similarity
 * 3. High-severity domains from prior rounds get weighted attack priority
 * 4. Previously-fixed patterns are flagged as regression risks
 * 5. The loop emits a LearningReport that adjusts swarm task priorities
 */

import type {
  RufloMemory,
  MemoryBackend,
  MemorySearchResult,
  TaskPriority,
} from '../../shared/types.js';
import type { EmbeddingProvider } from '../../memory/infrastructure/EmbeddingProvider.js';

export interface OrbitFinding {
  id: string;
  round: string;
  domain: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  fixed: boolean;
  fixedInRound?: string;
}

export interface DomainWeight {
  domain: string;
  weight: number;
  reason: string;
  priorFindings: number;
  unfixedCount: number;
  regressionRisk: boolean;
}

export interface LearningReport {
  round: string;
  priorRound: string | null;
  domainWeights: DomainWeight[];
  regressionCandidates: OrbitFinding[];
  recommendedPriorities: Array<{
    domain: string;
    priority: TaskPriority;
  }>;
  totalPriorFindings: number;
  totalUnfixed: number;
  learningConfidence: number;
}

export class SelfLearningLoop {
  private memoryBackend: MemoryBackend;
  private embeddingProvider: EmbeddingProvider;

  constructor(memoryBackend: MemoryBackend, embeddingProvider: EmbeddingProvider) {
    this.memoryBackend = memoryBackend;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Record findings from a completed orbit round.
   */
  async recordRoundFindings(round: string, findings: OrbitFinding[]): Promise<void> {
    for (const finding of findings) {
      const content = `[${finding.domain}] ${finding.severity}: ${finding.title} — ${finding.description}`;
      const embedding = await this.embeddingProvider.embed(content);

      const memory: RufloMemory = {
        id: `orbit-finding-${round}-${finding.id}`,
        agentId: 'self-learning-loop',
        content,
        type: 'event',
        timestamp: Date.now(),
        embedding,
        metadata: {
          round,
          domain: finding.domain,
          severity: finding.severity,
          findingId: finding.id,
          fixed: finding.fixed,
          fixedInRound: finding.fixedInRound,
          title: finding.title,
        },
      };

      await this.memoryBackend.store(memory);
    }
  }

  /**
   * Mark a finding as fixed in a specific round.
   */
  async markFixed(findingId: string, fixedInRound: string): Promise<void> {
    const existing = await this.memoryBackend.retrieve(findingId);
    if (existing) {
      await this.memoryBackend.update({
        ...existing,
        metadata: {
          ...existing.metadata,
          fixed: true,
          fixedInRound,
        },
      });
    }
  }

  /**
   * Generate a learning report before starting a new round.
   * Analyzes past findings to recommend domain priorities and flag regressions.
   */
  async generateLearningReport(
    newRound: string,
    priorRound: string | null,
    domains: string[],
  ): Promise<LearningReport> {
    const allFindings = await this.memoryBackend.query({
      agentId: 'self-learning-loop',
      type: 'event',
    });

    const domainStats = new Map<
      string,
      {
        findings: number;
        unfixed: number;
        criticalCount: number;
        highCount: number;
      }
    >();

    for (const domain of domains) {
      domainStats.set(domain, {
        findings: 0,
        unfixed: 0,
        criticalCount: 0,
        highCount: 0,
      });
    }

    const regressionCandidates: OrbitFinding[] = [];

    for (const memory of allFindings) {
      const domain = memory.metadata?.domain as string | undefined;
      const severity = memory.metadata?.severity as string | undefined;
      const fixed = memory.metadata?.fixed as boolean | undefined;

      if (!domain) continue;

      let stats = domainStats.get(domain);
      if (!stats) {
        stats = {
          findings: 0,
          unfixed: 0,
          criticalCount: 0,
          highCount: 0,
        };
        domainStats.set(domain, stats);
      }

      stats.findings++;
      if (!fixed) stats.unfixed++;
      if (severity === 'critical') stats.criticalCount++;
      if (severity === 'high') stats.highCount++;

      if (fixed) {
        regressionCandidates.push({
          id: memory.metadata?.findingId as string,
          round: memory.metadata?.round as string,
          domain,
          severity: (severity as OrbitFinding['severity']) || 'medium',
          title: (memory.metadata?.title as string) || '',
          description: memory.content,
          fixed: true,
          fixedInRound: memory.metadata?.fixedInRound as string,
        });
      }
    }

    const domainWeights: DomainWeight[] = [];
    const recommendedPriorities: Array<{
      domain: string;
      priority: TaskPriority;
    }> = [];

    for (const [domain, stats] of domainStats) {
      const weight =
        stats.criticalCount * 4 + stats.highCount * 2 + stats.unfixed * 1.5 + stats.findings * 0.5;

      const hasRegression = regressionCandidates.some((r) => r.domain === domain);

      let reason = '';
      if (stats.criticalCount > 0) {
        reason = `${stats.criticalCount} critical findings in prior rounds`;
      } else if (stats.unfixed > 0) {
        reason = `${stats.unfixed} unfixed findings from prior rounds`;
      } else if (hasRegression) {
        reason = 'Previously fixed findings — regression risk';
      } else {
        reason = 'No prior findings — baseline priority';
      }

      domainWeights.push({
        domain,
        weight,
        reason,
        priorFindings: stats.findings,
        unfixedCount: stats.unfixed,
        regressionRisk: hasRegression,
      });

      let priority: TaskPriority = 'medium';
      if (stats.criticalCount > 0 || stats.unfixed > 2) {
        priority = 'high';
      } else if (stats.findings === 0) {
        priority = 'low';
      }
      recommendedPriorities.push({ domain, priority });
    }

    domainWeights.sort((a, b) => b.weight - a.weight);

    const totalFindings = allFindings.length;
    const totalUnfixed = Array.from(domainStats.values()).reduce((sum, s) => sum + s.unfixed, 0);

    const learningConfidence = Math.min(1.0, totalFindings / 20);

    return {
      round: newRound,
      priorRound,
      domainWeights,
      regressionCandidates: regressionCandidates.slice(0, 10),
      recommendedPriorities,
      totalPriorFindings: totalFindings,
      totalUnfixed,
      learningConfidence,
    };
  }

  /**
   * Find similar past findings using vector search.
   * Used during triage to compare new findings against historical patterns.
   */
  async findSimilarFindings(description: string, k: number = 5): Promise<MemorySearchResult[]> {
    const embedding = await this.embeddingProvider.embed(description);
    return this.memoryBackend.vectorSearch(embedding, k);
  }

  /**
   * Get summary statistics for a specific domain across all rounds.
   */
  async getDomainHistory(domain: string): Promise<{
    totalFindings: number;
    fixedCount: number;
    unfixedCount: number;
    rounds: string[];
  }> {
    const memories = await this.memoryBackend.query({
      agentId: 'self-learning-loop',
      metadata: { domain },
    });

    const rounds = new Set<string>();
    let fixedCount = 0;
    let unfixedCount = 0;

    for (const m of memories) {
      if (m.metadata?.round) rounds.add(m.metadata.round as string);
      if (m.metadata?.fixed) fixedCount++;
      else unfixedCount++;
    }

    return {
      totalFindings: memories.length,
      fixedCount,
      unfixedCount,
      rounds: Array.from(rounds).sort(),
    };
  }
}
