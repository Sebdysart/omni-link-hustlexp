// engine/evolution/upgrade-proposer.ts — Generate ranked EvolutionSuggestions from gap + bottleneck findings

import {
  UNKNOWN_FILE,
  UNKNOWN_LINE,
  type RepoManifest,
  type EvolutionSuggestion,
} from '../types.js';
import type { GapFinding } from './gap-analyzer.js';
import type { BottleneckFinding } from './bottleneck-finder.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

const IMPACT_ORDER: Record<EvolutionSuggestion['estimatedImpact'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const EFFORT_ORDER: Record<EvolutionSuggestion['estimatedEffort'], number> = {
  small: 0,
  medium: 1,
  large: 2,
};

function sortSuggestions(suggestions: EvolutionSuggestion[]): EvolutionSuggestion[] {
  return suggestions.sort((a, b) => {
    const impactDiff = IMPACT_ORDER[a.estimatedImpact] - IMPACT_ORDER[b.estimatedImpact];
    if (impactDiff !== 0) return impactDiff;
    return EFFORT_ORDER[a.estimatedEffort] - EFFORT_ORDER[b.estimatedEffort];
  });
}

/**
 * Deduplicate suggestions that represent the same best practice across multiple repos.
 *
 * Dedup key: `${category}:${title-without-" in <repo>"-suffix}`.
 * Matching suggestions are merged:
 *   - affectedRepos: union of all repos
 *   - evidence: concatenated
 *   - title: repo-specific suffix stripped when > 1 repo
 *   - all other fields from the first (highest-ranked) occurrence
 */
function deduplicateSuggestions(suggestions: EvolutionSuggestion[]): EvolutionSuggestion[] {
  const deduped = new Map<string, EvolutionSuggestion>();

  for (const s of suggestions) {
    // Strip " in <repoName>" suffix to produce a canonical title
    // Pattern: " in " followed by one non-whitespace token at end of string
    const titleBase = s.title.replace(/ in \S+$/, '').trim();
    // Normalize case and common synonyms to catch "Add pagination" vs "Implement Pagination"
    const normalized = titleBase
      .toLowerCase()
      .replace(/\bimplement\b/g, 'add')
      .replace(/\bon\b/g, 'to')
      .replace(/\s+/g, ' ');
    const key = `${s.category}:${normalized}`;

    const existing = deduped.get(key);
    if (!existing) {
      // First occurrence: clone to avoid mutating original
      deduped.set(key, {
        ...s,
        affectedRepos: [...s.affectedRepos],
        evidence: [...s.evidence],
      });
    } else {
      // Merge: add any new repos
      for (const repo of s.affectedRepos) {
        if (!existing.affectedRepos.includes(repo)) {
          existing.affectedRepos.push(repo);
        }
      }
      // Merge evidence items (all unique per their source location)
      existing.evidence.push(...s.evidence);
    }
  }

  // Strip " in <repo>" suffix from merged (multi-repo) suggestion titles
  const result = [...deduped.values()];
  for (const s of result) {
    if (s.affectedRepos.length > 1) {
      s.title = s.title.replace(/ in \S+$/, '').trim();
    }
  }

  return result;
}

// ─── Gap → Suggestion Mapping ───────────────────────────────────────────────

function gapToCategory(gap: GapFinding): EvolutionSuggestion['category'] {
  switch (gap.kind) {
    case 'incomplete-crud':
      return 'feature';
    case 'dead-route':
      return 'feature';
    case 'dead-export':
      return 'feature';
    case 'orphaned-schema':
      return 'feature';
    default:
      return 'feature';
  }
}

function gapToImpact(gap: GapFinding): EvolutionSuggestion['estimatedImpact'] {
  switch (gap.kind) {
    case 'incomplete-crud':
      return 'medium';
    case 'dead-route':
      return 'low';
    case 'dead-export':
      return 'low';
    case 'orphaned-schema':
      return 'low';
    default:
      return 'low';
  }
}

function gapToEffort(gap: GapFinding): EvolutionSuggestion['estimatedEffort'] {
  switch (gap.kind) {
    case 'incomplete-crud':
      return 'medium';
    case 'dead-route':
      return 'small';
    case 'dead-export':
      return 'small';
    case 'orphaned-schema':
      return 'small';
    default:
      return 'small';
  }
}

function gapToTitle(gap: GapFinding): string {
  switch (gap.kind) {
    case 'incomplete-crud':
      return `Complete CRUD operations for resource in ${gap.repo}`;
    case 'dead-route':
      return `Remove or wire dead route in ${gap.repo}`;
    case 'dead-export':
      return `Clean up unused export in ${gap.repo}`;
    case 'orphaned-schema':
      return `Wire or remove orphaned schema in ${gap.repo}`;
    default:
      return `Address gap in ${gap.repo}`;
  }
}

function gapToDescription(gap: GapFinding): string {
  switch (gap.kind) {
    case 'incomplete-crud':
      return `${gap.description}. Adding the missing operations will provide a complete API for consumers and follow REST best practices.`;
    case 'dead-route':
      return `${gap.description}. Dead routes add confusion and may indicate incomplete feature implementation.`;
    case 'dead-export':
      return `${gap.description}. Dead exports increase bundle size and cognitive load. Remove or integrate into the codebase.`;
    case 'orphaned-schema':
      return `${gap.description}. Orphaned schemas suggest incomplete validation coverage or leftover refactoring artifacts.`;
    default:
      return gap.description;
  }
}

function gapToSuggestion(gap: GapFinding): EvolutionSuggestion {
  return {
    id: nextId('gap'),
    category: gapToCategory(gap),
    title: gapToTitle(gap),
    description: gapToDescription(gap),
    evidence: [
      {
        repo: gap.repo,
        file: gap.file,
        line: gap.line,
        finding: gap.description,
      },
    ],
    estimatedEffort: gapToEffort(gap),
    estimatedImpact: gapToImpact(gap),
    affectedRepos: [gap.repo],
  };
}

// ─── Bottleneck → Suggestion Mapping ────────────────────────────────────────

function bottleneckToCategory(bn: BottleneckFinding): EvolutionSuggestion['category'] {
  // Benchmark-derived findings encode their origin in the description prefix.
  // The kind mapping used by benchmarkToBottleneckFindings() is lossy, so we
  // infer the correct category from the benchmark category that was encoded into
  // the kind:
  //   security  → unbounded-query (should stay 'security')
  //   performance → missing-pagination (should be 'performance', not 'scale')
  if (bn.description.startsWith('[Best Practice]')) {
    if (bn.kind === 'unbounded-query') return 'security';
    if (bn.kind === 'missing-pagination') return 'performance';
    // reliability → sync-in-async, observability/default → no-caching
    return 'performance';
  }

  switch (bn.kind) {
    case 'missing-pagination':
      return 'scale';
    case 'unbounded-query':
      // Rate-limiting is a security concern
      if (bn.description.toLowerCase().includes('rate')) return 'security';
      return 'performance';
    case 'no-caching':
      return 'performance';
    case 'sync-in-async':
      return 'performance';
    default:
      return 'performance';
  }
}

function bottleneckToImpact(bn: BottleneckFinding): EvolutionSuggestion['estimatedImpact'] {
  switch (bn.severity) {
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'medium';
  }
}

function bottleneckToEffort(bn: BottleneckFinding): EvolutionSuggestion['estimatedEffort'] {
  switch (bn.kind) {
    case 'missing-pagination':
      return 'medium';
    case 'unbounded-query':
      return 'small';
    case 'no-caching':
      return 'medium';
    case 'sync-in-async':
      return 'medium';
    default:
      return 'medium';
  }
}

function bottleneckToTitle(bn: BottleneckFinding): string {
  // Benchmark-derived findings encode the practice name as "[Best Practice] Name: suggestion".
  // Extract it and use it directly so the title matches the actual recommendation.
  const bpMatch = bn.description.match(/^\[Best Practice\] ([^:]+):/);
  if (bpMatch) {
    return `Implement ${bpMatch[1].trim()} in ${bn.repo}`;
  }

  switch (bn.kind) {
    case 'missing-pagination':
      return `Add pagination to list endpoints in ${bn.repo}`;
    case 'unbounded-query':
      if (bn.description.toLowerCase().includes('rate')) {
        return `Add rate-limiting middleware in ${bn.repo}`;
      }
      return `Add query bounds to prevent unbounded results in ${bn.repo}`;
    case 'no-caching':
      return `Implement caching strategy for ${bn.repo}`;
    case 'sync-in-async':
      return `Replace synchronous operations in async context in ${bn.repo}`;
    default:
      return `Address performance bottleneck in ${bn.repo}`;
  }
}

function bottleneckToDescription(bn: BottleneckFinding): string {
  // Benchmark-derived findings: "[Best Practice] Name: suggestion-text"
  // Strip the prefix and return the suggestion text as a clean description.
  const bpMatch = bn.description.match(/^\[Best Practice\] [^:]+: (.+)/);
  if (bpMatch) {
    return `${bpMatch[1].replace(/\.$/, '')}. Apply this best practice to improve ecosystem quality and match industry standards.`;
  }

  switch (bn.kind) {
    case 'missing-pagination':
      return `${bn.description}. Without pagination, list endpoints can return unbounded data, causing memory pressure and slow response times at scale.`;
    case 'unbounded-query':
      if (bn.description.toLowerCase().includes('rate')) {
        return `${bn.description}. Without rate limiting, mutation endpoints are vulnerable to abuse and can overwhelm the database.`;
      }
      return `${bn.description}. Unbounded queries can cause memory exhaustion and slow response times under load.`;
    case 'no-caching':
      return `${bn.description}. Adding caching (in-memory, Redis, or CDN) can dramatically reduce latency and database load for read-heavy resources.`;
    case 'sync-in-async':
      return `${bn.description}. Synchronous operations in async contexts block the event loop and degrade throughput.`;
    default:
      return bn.description;
  }
}

function bottleneckToSuggestion(bn: BottleneckFinding): EvolutionSuggestion {
  return {
    id: nextId('perf'),
    category: bottleneckToCategory(bn),
    title: bottleneckToTitle(bn),
    description: bottleneckToDescription(bn),
    evidence: [
      {
        repo: bn.repo,
        file: bn.file,
        line: bn.line,
        finding: bn.description,
      },
    ],
    estimatedEffort: bottleneckToEffort(bn),
    estimatedImpact: bottleneckToImpact(bn),
    affectedRepos: [bn.repo],
  };
}

// ─── Evidence Validation ─────────────────────────────────────────────────────

/**
 * Returns true if an evidence item has meaningful file/line evidence
 * (not empty, not sentinel values).
 */
function hasValidEvidence(evidence: { file: string; line: number }): boolean {
  return Boolean(evidence.file) && evidence.file !== UNKNOWN_FILE && evidence.line !== UNKNOWN_LINE;
}

/**
 * Strip evidence items that have empty/sentinel file or line values from
 * a suggestion. Returns the suggestion with cleaned evidence array.
 */
function cleanSuggestionEvidence(suggestion: EvolutionSuggestion): EvolutionSuggestion {
  return {
    ...suggestion,
    evidence: suggestion.evidence.filter(hasValidEvidence),
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Generate ranked EvolutionSuggestions from gap and bottleneck findings.
 */
export function proposeUpgrades(
  gaps: GapFinding[],
  bottlenecks: BottleneckFinding[],
  _manifests: RepoManifest[],
): EvolutionSuggestion[] {
  // Reset counter for deterministic IDs within a single call
  idCounter = 0;

  const suggestions: EvolutionSuggestion[] = [];

  for (const gap of gaps) {
    suggestions.push(gapToSuggestion(gap));
  }

  for (const bn of bottlenecks) {
    suggestions.push(bottleneckToSuggestion(bn));
  }

  // Clean evidence: strip items with empty/sentinel file:line, then drop
  // suggestions that have zero evidence remaining (pure best-practice notes
  // with no concrete codebase anchor).
  const cleaned = deduplicateSuggestions(sortSuggestions(suggestions))
    .map(cleanSuggestionEvidence)
    .filter((s) => s.evidence.length > 0);

  return cleaned;
}
