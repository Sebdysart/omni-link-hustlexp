// engine/types.ts — Core type definitions for omni-link

// ─── Sentinel Constants ─────────────────────────────────────────────────────

/** Sentinel for source locations where the actual file is unknown */
export const UNKNOWN_FILE = '[unknown-source]';

/** Sentinel line number indicating unknown location within a file */
export const UNKNOWN_LINE = 0;

// --- Shared metadata ---

export type SourceKind = 'parser' | 'semantic' | 'runtime' | 'mixed';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ReviewProviderId = 'github' | 'gitlab';
export type ReviewPublishMode = 'dry-run' | 'replay' | 'github' | 'gitlab';
export type WorkflowProfile = 'hustlexp';

export interface ProvenanceEntry {
  sourceKind: SourceKind;
  adapter: string;
  detail?: string;
  confidence?: number;
}

export interface AnalysisMetadata {
  sourceKind?: SourceKind;
  confidence?: number;
  owner?: string;
  runtimeWeight?: number;
  riskScore?: number;
  provenance?: ProvenanceEntry[];
}

// --- Configuration ---

export interface RepoConfig {
  name: string;
  path: string;
  language: string;
  role: string;
  exclude?: string[];
}

export interface AuthorityFileMap {
  currentPhase: string;
  finishedState: string;
  featureFreeze: string;
  aiGuardrails: string;
  apiContract: string;
  schema: string;
}

export interface AuthorityConfig {
  enabled?: boolean;
  docsRepo?: string;
  phaseMode?: 'reconciliation' | 'strict';
  authorityFiles?: AuthorityFileMap;
}

export interface SwiftTrpcBridgeConfig {
  enabled?: boolean;
  iosRepo?: string;
  backendRepo?: string;
  clientCallPattern?: string;
  authoritativeBackendRoot?: string;
}

export interface BridgesConfig {
  swiftTrpc?: SwiftTrpcBridgeConfig;
}

export interface OwnershipRule {
  owner: string;
  kind: 'team' | 'person' | 'service';
  scope: 'repo' | 'path' | 'api' | 'package';
  repo?: string;
  pattern?: string;
}

export interface DaemonConfig {
  enabled?: boolean;
  statePath?: string;
  pollIntervalMs?: number;
  cacheRetentionDays?: number;
  workspaceGroups?: Record<string, string[]>;
  preferDaemon?: boolean;
}

export interface GitHubConfig {
  enabled?: boolean;
  owner?: string;
  repo?: string;
  defaultBaseBranch?: string;
  commentOnPr?: boolean;
  publishChecks?: boolean;
  artifactPath?: string;
  publishMode?: 'dry-run' | 'replay' | 'github';
  replayDirectory?: string;
  apiUrl?: string;
}

export interface GitLabConfig {
  enabled?: boolean;
  namespace?: string;
  project?: string;
  defaultBaseBranch?: string;
  commentOnMergeRequest?: boolean;
  publishChecks?: boolean;
  artifactPath?: string;
  publishMode?: 'dry-run' | 'replay' | 'gitlab';
  replayDirectory?: string;
  apiUrl?: string;
}

export interface AutomationConfig {
  enabled?: boolean;
  branchPrefix?: string;
  createPullRequest?: boolean;
  retryLimit?: number;
  allowedRiskTiers?: RiskLevel[];
  autoApplyRiskTiers?: RiskLevel[];
  dryRunByDefault?: boolean;
}

export interface OwnershipConfig {
  enabled?: boolean;
  defaultOwner?: string;
  rules?: OwnershipRule[];
}

export interface RuntimeConfig {
  enabled?: boolean;
  coverageSummaryPath?: string;
  testResultsPath?: string;
  openApiPath?: string;
  graphQlSchemaPath?: string;
  telemetrySummaryPath?: string;
  traceSummaryPath?: string;
}

export interface PolicyConfig {
  enabled?: boolean;
  protectedBranches?: string[];
  requiredChecks?: string[];
  requiredOwners?: string[];
  maxAllowedRisk?: RiskLevel;
  forbidDirectMainMutation?: boolean;
  forbidDestructiveChanges?: boolean;
}

export interface SemanticAnalysisConfig {
  enabled?: boolean;
  preferSemantic?: boolean;
  confidenceThreshold?: number;
  languages?: Array<
    'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'graphql' | 'java' | 'swift'
  >;
}

export interface MaxTierConfig {
  enabled?: boolean;
  semanticAnalysis?: SemanticAnalysisConfig;
  runtimeIngestion?: { enabled?: boolean };
  execution?: { enabled?: boolean };
}

export interface OmniLinkConfig {
  repos: RepoConfig[];
  workflowProfile?: WorkflowProfile;
  reviewProvider?: ReviewProviderId;
  evolution: {
    aggressiveness: 'aggressive' | 'moderate' | 'on-demand';
    maxSuggestionsPerSession: number;
    categories: string[];
  };
  quality: {
    blockOnFailure: boolean;
    requireTestsForNewCode: boolean;
    conventionStrictness: 'strict' | 'moderate' | 'relaxed';
  };
  context: {
    tokenBudget: number;
    prioritize: 'changed-files-first' | 'api-surface-first';
    includeRecentCommits: number;
    focus?: 'commits' | 'types' | 'api-surface' | 'mismatches' | 'auto';
  };
  cache: {
    directory: string;
    maxAgeDays: number;
  };
  daemon?: DaemonConfig;
  github?: GitHubConfig;
  gitlab?: GitLabConfig;
  authority?: AuthorityConfig;
  bridges?: BridgesConfig;
  automation?: AutomationConfig;
  ownership?: OwnershipConfig;
  runtime?: RuntimeConfig;
  policies?: PolicyConfig;
  maxTier?: MaxTierConfig;
  simulateOnly?: boolean;
}

// --- Scanner Output ---

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: string[];
}

export interface ExportDef extends AnalysisMetadata {
  name: string;
  kind: 'function' | 'class' | 'constant' | 'type' | 'interface' | 'enum';
  signature: string;
  file: string;
  line: number;
}

export interface RouteDefinition extends AnalysisMetadata {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
  inputType?: string;
  outputType?: string;
}

export interface ProcedureDef extends AnalysisMetadata {
  name: string;
  kind: 'query' | 'mutation' | 'subscription';
  file: string;
  line: number;
  inputType?: string;
  outputType?: string;
}

export interface TypeField {
  name: string;
  type: string;
  optional?: boolean;
}

export interface TypeDef extends AnalysisMetadata {
  name: string;
  fields: TypeField[];
  extends?: string[];
  source: { repo: string; file: string; line: number };
}

export interface SchemaDef extends AnalysisMetadata {
  name: string;
  kind: 'zod' | 'joi' | 'yup' | 'codable' | 'pydantic' | 'other';
  fields: TypeField[];
  source: { repo: string; file: string; line: number };
}

export interface ModelDef extends AnalysisMetadata {
  name: string;
  tableName?: string;
  fields: TypeField[];
  source: { repo: string; file: string; line: number };
}

export type NamingConvention = 'camelCase' | 'snake_case' | 'PascalCase' | 'kebab-case' | 'mixed';

export interface SymbolReference extends AnalysisMetadata {
  name: string;
  kind: 'import' | 'call' | 'type' | 'route' | 'procedure';
  fromFile: string;
  toFile?: string;
  line: number;
}

export interface InternalDep extends AnalysisMetadata {
  from: string;
  to: string;
  imports: string[];
}

export interface PackageDep extends AnalysisMetadata {
  name: string;
  version: string;
  dev: boolean;
}

export interface RuntimeSignal extends AnalysisMetadata {
  kind: 'coverage' | 'tests' | 'telemetry' | 'trace' | 'openapi' | 'graphql';
  source: string;
  weight: number;
  value?: number;
  detail?: string;
}

export interface HealthScore {
  testCoverage: number | null;
  lintErrors: number;
  typeErrors: number;
  todoCount: number;
  deadCode: string[];
}

export interface OwnerAssignment {
  owner: string;
  kind: 'team' | 'person' | 'service';
  scope: 'repo' | 'path' | 'api' | 'package';
  repoId?: string;
  pattern?: string;
  matchedBy?: string;
}

export interface RepoManifest extends AnalysisMetadata {
  repoId: string;
  path: string;
  language: string;
  gitState: {
    branch: string;
    headSha: string;
    uncommittedChanges: string[];
    recentCommits: CommitSummary[];
  };
  apiSurface: {
    routes: RouteDefinition[];
    procedures: ProcedureDef[];
    exports: ExportDef[];
  };
  typeRegistry: {
    types: TypeDef[];
    schemas: SchemaDef[];
    models: ModelDef[];
  };
  conventions: {
    naming: NamingConvention;
    fileOrganization: string;
    errorHandling: string;
    patterns: string[];
    testingPatterns: string;
  };
  dependencies: {
    internal: InternalDep[];
    external: PackageDep[];
  };
  symbolReferences?: SymbolReference[];
  runtimeSignals?: RuntimeSignal[];
  owners?: OwnerAssignment[];
  health: HealthScore;
}

// --- Grapher Output ---

export interface ApiBridge extends AnalysisMetadata {
  consumer: { repo: string; file: string; line: number };
  provider: { repo: string; route: string; handler: string };
  contract: {
    inputType: TypeDef;
    outputType: TypeDef;
    matchStatus: 'exact' | 'compatible' | 'mismatch';
  };
}

export interface TypeLineage extends AnalysisMetadata {
  concept: string;
  instances: Array<{ repo: string; type: TypeDef }>;
  alignment: 'aligned' | 'diverged' | 'subset';
}

export interface Mismatch extends AnalysisMetadata {
  kind:
    | 'missing-field'
    | 'type-mismatch'
    | 'extra-field'
    | 'renamed-field'
    | 'missing-procedure'
    | 'obsolete-call'
    | 'authority-drift';
  description: string;
  provider: { repo: string; file: string; line: number; field: string };
  consumer: { repo: string; file: string; line: number; field?: string };
  severity: 'breaking' | 'warning' | 'info';
}

export interface ImpactPath extends AnalysisMetadata {
  trigger: { repo: string; file: string; change: string };
  affected: Array<{
    repo: string;
    file: string;
    line: number;
    reason: string;
    severity: 'breaking' | 'warning' | 'info';
  }>;
}

export interface AuthoritativeApiSurface extends AnalysisMetadata {
  sourceFile: string;
  procedures: string[];
  procedureContracts: AuthorityProcedureContract[];
  errorCodes: string[];
  baseUrls: string[];
}

export interface AuthoritativeSchemaSurface extends AnalysisMetadata {
  sourceFile: string;
  tables: string[];
  views: string[];
}

export interface AuthorityProcedureContract extends AnalysisMetadata {
  procedure: string;
  inputType: TypeDef;
  outputType: TypeDef;
}

export interface AuthorityState extends AnalysisMetadata {
  docsRepo: string;
  phaseMode: 'reconciliation' | 'strict';
  currentPhase: string;
  blockedWorkClasses: string[];
  frozenFeatures: string[];
  authoritativeApiSurface: AuthoritativeApiSurface;
  authoritativeSchemaSurface: AuthoritativeSchemaSurface;
}

export interface ReviewFinding extends AnalysisMetadata {
  kind: 'authority_drift' | 'bridge_mismatch' | 'bridge_obsolete_call';
  severity: 'breaking' | 'warning' | 'info';
  title: string;
  description: string;
  repo: string;
  file: string;
  line: number;
}

export interface EcosystemGraph extends AnalysisMetadata {
  repos: RepoManifest[];
  bridges: ApiBridge[];
  sharedTypes: TypeLineage[];
  contractMismatches: Mismatch[];
  impactPaths: ImpactPath[];
  semanticReferences?: SymbolReference[];
  owners?: OwnerAssignment[];
  runtimeSignals?: RuntimeSignal[];
  authority?: AuthorityState;
  findings?: ReviewFinding[];
}

// --- Context Output ---

export interface EcosystemDigest {
  generatedAt: string;
  configSha: string;
  repos: Array<{
    name: string;
    language: string;
    branch: string;
    uncommittedCount: number;
    commitsBehind: number;
  }>;
  contractStatus: {
    total: number;
    exact: number;
    compatible: number;
    docCoverageGaps: number;
    mismatches: Mismatch[];
  };
  evolutionOpportunities: EvolutionSuggestion[];
  conventionSummary: Record<string, string>;
  apiSurfaceSummary: string;
  recentChangesSummary: string;
  architectureDiagram?: string;
  authorityStatus?: {
    currentPhase: string;
    phaseMode: 'reconciliation' | 'strict';
    blockedWorkClasses: string[];
    findingCount: number;
  };
  reviewFindingSummary?: Record<string, number>;
  tokenCount: number;
}

export interface AuthorityStatusResult {
  authority: AuthorityState | null;
  findings: ReviewFinding[];
  blockedApply: boolean;
  procedureCoverage: {
    docs: number;
    backend: number;
    iosCalls: number;
    bridges: number;
    docsOnly: string[];
    backendOnly: string[];
    obsoleteCalls: string[];
    payloadDrift: string[];
  };
  recommendations: string[];
}

// --- Evolution Output ---

export interface EvolutionSuggestion extends AnalysisMetadata {
  id: string;
  category: 'feature' | 'performance' | 'monetization' | 'scale' | 'security';
  title: string;
  description: string;
  evidence: Array<{ repo: string; file: string; line: number; finding: string }>;
  estimatedEffort: 'small' | 'medium' | 'large';
  estimatedImpact: 'low' | 'medium' | 'high' | 'critical';
  affectedRepos: string[];
  queue?: 'engineering-debt' | 'business-opportunity' | 'risk-reduction';
}

// --- Policy / execution / review ---

export interface PolicyDecision {
  policyId: string;
  status: 'passed' | 'warning' | 'blocked';
  message: string;
}

export interface RiskReport {
  overallRisk: RiskLevel;
  score: number;
  reasons: string[];
  affectedRepos: string[];
  blockedByPolicy: boolean;
}

export interface ChangePlan {
  id: string;
  kind:
    | 'provider-migration'
    | 'consumer-update'
    | 'schema-sync'
    | 'test-scaffold'
    | 'docs-update'
    | 'config-update';
  title: string;
  description: string;
  repo: string;
  files: string[];
  confidence: number;
  risk: RiskLevel;
  dependsOn: string[];
  preconditions: string[];
  validationSteps: string[];
  rollbackSteps: string[];
}

export interface RollbackPlan {
  steps: string[];
  restoreTargets: string[];
  branchName?: string;
}

export interface ExecutionPlan {
  planId: string;
  mode: 'dry-run' | 'branch-pr';
  branchName: string;
  baseBranch: string;
  changes: ChangePlan[];
  risk: RiskReport;
  approvals: string[];
  blocked: boolean;
  policyDecisions: PolicyDecision[];
  rollback: RollbackPlan;
  pullRequest?: {
    title: string;
    body: string;
  };
}

export interface ReviewArtifact {
  generatedAt: string;
  baseRef: string;
  headRef: string;
  affectedRepos: string[];
  impact: ImpactPath[];
  contractMismatches: Mismatch[];
  findings: ReviewFinding[];
  owners: OwnerAssignment[];
  risk: RiskReport;
  policyDecisions: PolicyDecision[];
  authority?: AuthorityState;
  executionPlan?: ExecutionPlan;
}

export interface ReviewPublishTarget {
  owner: string;
  repo: string;
  pullRequestNumber: number;
  headSha?: string;
}

export interface ReviewProviderCapabilities {
  supportsComments: boolean;
  supportsChecks: boolean;
  supportsMetadata: boolean;
  maxAnnotationsPerCheck: number;
  maxCommentBytes: number;
}

export interface ReviewProviderMetadata {
  provider: ReviewProviderId;
  state: 'open' | 'closed' | 'merged' | 'locked' | 'unknown';
  title?: string;
  url?: string;
  headSha?: string;
  sourceBranch?: string;
  targetBranch?: string;
  isDraft?: boolean;
}

export interface ReviewPublishRecord {
  kind: 'comment' | 'check-run';
  status: 'published' | 'skipped' | 'dry-run' | 'replayed';
  id?: string;
  url?: string;
  path?: string;
  reason?: string;
}

export interface ReviewPublishResult {
  provider: string;
  mode: ReviewPublishMode;
  target: ReviewPublishTarget;
  summary: string;
  capabilities: ReviewProviderCapabilities;
  metadata: ReviewProviderMetadata | null;
  comment: ReviewPublishRecord;
  checkRun: ReviewPublishRecord;
}

export interface DaemonStatus {
  running: boolean;
  updatedAt: string;
  repoCount: number;
  dirtyRepos: string[];
  statePath: string;
}

// --- Scan Cache ---

export interface FileScanResult {
  filePath: string;
  sha: string;
  scannedAt: string;
  exports: ExportDef[];
  imports: InternalDep[];
  types: TypeDef[];
  schemas: SchemaDef[];
  routes: RouteDefinition[];
  procedures: ProcedureDef[];
  symbolReferences?: SymbolReference[];
}

export interface RepoMeta {
  repoId: string;
  lastScanAt: string;
  headSha: string;
  fileCount: number;
}
