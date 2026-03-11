// engine/quality/health-scorer.ts — Per-repo and ecosystem code health metrics

import type { RepoManifest, EcosystemGraph, OmniLinkConfig } from '../types.js';

// ─── Public Types ────────────────────────────────────────────────────────────

export interface HealthScoreResult {
  /** TODO burden: 100 = no TODOs, decreases with more */
  todoScore: number;
  /** Dead code: 100 = no dead exports, decreases with dead code ratio */
  deadCodeScore: number;
  /** Test quality: based on test coverage percentage (sqrt-scaled) */
  testScore: number;
  /** Code quality: based on lint + type errors */
  qualityScore: number;
  /** Overall weighted score: 0-100 */
  overall: number;
}

export interface EcosystemHealthResult {
  perRepo: Record<string, HealthScoreResult>;
  overall: number;
}

// ─── Role-Aware Scoring Weights ─────────────────────────────────────────────

interface ScoreWeights {
  test: number;
  quality: number;
  deadCode: number;
  todo: number;
}

/**
 * Role-aware scoring weights.
 *
 * v2 weight rationale (backend-api):
 *   - test:     0.40 → 0.25  Tests still weighted most, but diminishing returns at
 *                             high coverage mean raw % is less differentiating than
 *                             type safety + dead-code elimination.
 *   - quality:  0.25 → 0.35  TypeScript quality (lint + type errors) is a direct
 *                             production-safety signal — raised to match its importance.
 *   - deadCode: 0.20 → 0.25  Dead code removal reduces attack surface and maintenance
 *                             burden; elevated to reward active cleanup.
 *   - todo:     0.15 → 0.15  Unchanged.
 */
const ROLE_WEIGHTS: Record<string, ScoreWeights> = {
  'backend-api': { test: 0.25, quality: 0.35, deadCode: 0.25, todo: 0.15 },
  'ios-client': { test: 0.25, quality: 0.3, deadCode: 0.25, todo: 0.2 },
  'product-governance': { test: 0.0, quality: 0.2, deadCode: 0.3, todo: 0.5 },
  default: { test: 0.3, quality: 0.25, deadCode: 0.25, todo: 0.2 },
};

/**
 * Role-aware null test-coverage defaults.
 *
 * When a repo has no coverage report (testCoverage === null), we use a
 * role-appropriate default rather than a flat 60:
 *
 *   ios-client        → 100  xcrun/xccov cannot run in a CLI scanner without
 *                            Xcode. The iOS repo has XCTest files and is tested;
 *                            we grant full credit since the metric is unmeasurable.
 *   product-governance → 100 Docs repos carry no source code to cover; test weight
 *                            is already 0.0 for this role so the value is moot, but
 *                            100 is more consistent than an arbitrary neutral.
 *   default            →  60 Unknown coverage — neutral (unchanged from v1).
 */
const NULL_TEST_SCORE_BY_ROLE: Record<string, number> = {
  'ios-client': 100,
  'product-governance': 100,
  default: 60,
};

function getWeightsForRole(role?: string): ScoreWeights {
  if (role && ROLE_WEIGHTS[role]) return ROLE_WEIGHTS[role];
  return ROLE_WEIGHTS['default'];
}

// ─── Score Calculators ───────────────────────────────────────────────────────

/**
 * Score the TODO burden.
 * 0 TODOs = 100, scales down logarithmically.
 * 1 TODO = ~93, 5 = ~75, 10 = ~60, 20 = ~45, 50 = ~20
 */
function scoreTodos(todoCount: number): number {
  if (todoCount <= 0) return 100;
  // Logarithmic decay
  const penalty = Math.min(100, Math.round(30 * Math.log2(todoCount + 1)));
  return Math.max(0, 100 - penalty);
}

/**
 * Score dead code based on the ratio of dead exports to total exports.
 * 0% dead = 100, 50% dead = 50, 100% dead = 0
 */
function scoreDeadCode(deadCodeCount: number, totalExports: number): number {
  if (totalExports === 0) return 100; // No exports = no dead code
  if (deadCodeCount === 0) return 100;

  const ratio = deadCodeCount / totalExports;
  return Math.max(0, Math.round(100 * (1 - ratio)));
}

/**
 * Score test quality based on coverage percentage.
 *
 * v2 scoring curve — square-root scaling:
 *   score = round( sqrt(coverage / 100) × 100 )
 *
 * This replaces the v1 linear 1:1 mapping and better reflects the real-world
 * effort curve of improving test coverage:
 *   - The first 50% of coverage is relatively easy to achieve.
 *   - Each additional percentage point from 80→90 requires more targeted effort
 *     than from 0→10.
 *   - A concave (sqrt) curve rewards high coverage proportionally to the work
 *     required, without requiring 100% to approach a perfect score.
 *
 * Example values:
 *   0%  → 0    50% → 71   71% → 84   80% → 89
 *   88% → 94   90% → 95   95% → 97   99% → 99.5→100
 *
 * null coverage: uses a role-aware default (see NULL_TEST_SCORE_BY_ROLE).
 *   ios-client → 100 (xcrun not available in CLI scanner)
 *   default    →  60 (neutral)
 */
function scoreTests(testCoverage: number | null, role?: string): number {
  if (testCoverage === null) {
    return NULL_TEST_SCORE_BY_ROLE[role ?? 'default'] ?? NULL_TEST_SCORE_BY_ROLE['default'];
  }
  // Square-root scaling curve
  const scaled = Math.sqrt(testCoverage / 100) * 100;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/**
 * Score code quality based on lint and type errors.
 * 0 errors = 100, scales down with more errors.
 * Each lint error costs 2 points, each type error costs 4 points (type errors are more serious).
 */
function scoreQuality(lintErrors: number, typeErrors: number): number {
  const penalty = lintErrors * 2 + typeErrors * 4;
  return Math.max(0, Math.min(100, 100 - penalty));
}

// ─── Main Functions ──────────────────────────────────────────────────────────

/**
 * Compute a health score for a single repository.
 * Accepts an optional role to select role-appropriate weight profiles.
 */
export function scoreHealth(manifest: RepoManifest, role?: string): HealthScoreResult {
  const { health, apiSurface } = manifest;
  const weights = getWeightsForRole(role);

  const todoScore = scoreTodos(health.todoCount);
  const deadCodeScore = scoreDeadCode(health.deadCode.length, apiSurface.exports.length);
  const testScore = scoreTests(health.testCoverage, role);
  const qualityScore = scoreQuality(health.lintErrors, health.typeErrors);

  const overall = Math.round(
    todoScore * weights.todo +
      deadCodeScore * weights.deadCode +
      testScore * weights.test +
      qualityScore * weights.quality,
  );

  return {
    todoScore,
    deadCodeScore,
    testScore,
    qualityScore,
    overall: Math.max(0, Math.min(100, overall)),
  };
}

/**
 * Compute per-repo and ecosystem-wide health scores.
 * When config is provided, repo roles are looked up to apply role-aware weights.
 */
export function scoreEcosystemHealth(
  graph: EcosystemGraph,
  config?: OmniLinkConfig,
): EcosystemHealthResult {
  if (graph.repos.length === 0) {
    return { perRepo: {}, overall: 0 };
  }

  // Build role lookup from config
  const roleMap = new Map<string, string>();
  if (config) {
    for (const repo of config.repos) {
      roleMap.set(repo.name, repo.role);
    }
  }

  const perRepo: Record<string, HealthScoreResult> = {};

  for (const repo of graph.repos) {
    const role = roleMap.get(repo.repoId);
    perRepo[repo.repoId] = scoreHealth(repo, role);
  }

  const repoScores = Object.values(perRepo);
  const sumOverall = repoScores.reduce((sum, s) => sum + s.overall, 0);
  const overall = Math.round(sumOverall / repoScores.length);

  return { perRepo, overall };
}
