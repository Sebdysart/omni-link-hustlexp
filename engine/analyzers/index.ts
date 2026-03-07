import type { OmniLinkConfig, RepoConfig } from '../types.js';
import type { RepoAnalyzer, RepoSemanticAnalysis } from './types.js';
import { typeScriptSemanticAnalyzer } from './typescript-semantic.js';

const ANALYZERS: RepoAnalyzer[] = [typeScriptSemanticAnalyzer];

export interface AnalyzerSelection {
  analysis: RepoSemanticAnalysis | null;
  preferSemantic: boolean;
}

export async function analyzeRepoSemantics(
  repo: RepoConfig,
  filePaths: string[],
  config?: OmniLinkConfig,
): Promise<AnalyzerSelection> {
  const semanticConfig = config?.maxTier?.semanticAnalysis;
  if (!semanticConfig?.enabled) {
    return { analysis: null, preferSemantic: false };
  }

  const analyzer = ANALYZERS.find((candidate) => candidate.supports(repo));
  if (!analyzer) {
    return { analysis: null, preferSemantic: false };
  }

  const analysis = await analyzer.analyzeRepo(repo, filePaths);
  return {
    analysis,
    preferSemantic: semanticConfig.preferSemantic ?? false,
  };
}
