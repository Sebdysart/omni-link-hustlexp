import type {
  ExportDef,
  InternalDep,
  ProcedureDef,
  RepoConfig,
  RouteDefinition,
  SchemaDef,
  SymbolReference,
  TypeDef,
} from '../types.js';

export interface SemanticFileAnalysis {
  exports: ExportDef[];
  routes: RouteDefinition[];
  procedures: ProcedureDef[];
  types: TypeDef[];
  schemas: SchemaDef[];
  imports: InternalDep[];
  symbolReferences: SymbolReference[];
}

export interface RepoSemanticAnalysis {
  adapter: string;
  files: Map<string, SemanticFileAnalysis>;
}

export interface RepoAnalyzer {
  readonly id: string;
  supports(config: RepoConfig): boolean;
  analyzeRepo(config: RepoConfig, filePaths: string[]): Promise<RepoSemanticAnalysis | null>;
}
