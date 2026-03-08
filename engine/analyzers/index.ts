import type { OmniLinkConfig, RepoConfig } from '../types.js';
import { graphQlSemanticAnalyzer } from './graphql-semantic.js';
import type { RepoAnalyzer, RepoSemanticAnalysis } from './types.js';
import { sourceSemanticAnalyzer } from './source-semantic.js';
import { toolchainSemanticAnalyzer } from './toolchain-semantic.js';
import { typeScriptSemanticAnalyzer } from './typescript-semantic.js';

const ANALYZERS: RepoAnalyzer[] = [
  typeScriptSemanticAnalyzer,
  toolchainSemanticAnalyzer,
  graphQlSemanticAnalyzer,
  sourceSemanticAnalyzer,
];

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

  if (semanticConfig.languages && !semanticConfig.languages.includes(repo.language as never)) {
    return { analysis: null, preferSemantic: false };
  }

  for (const analyzer of ANALYZERS) {
    if (!analyzer.supports(repo)) continue;
    const analysis = await analyzer.analyzeRepo(repo, filePaths);
    if (analysis) {
      return {
        analysis,
        preferSemantic: semanticConfig.preferSemantic ?? false,
      };
    }
  }

  return { analysis: null, preferSemantic: false };
}
