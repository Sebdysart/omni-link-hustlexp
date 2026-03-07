import * as path from 'node:path';

import ts from 'typescript';

import type {
  ExportDef,
  InternalDep,
  ProcedureDef,
  RepoConfig,
  RouteDefinition,
  SourceKind,
  SymbolReference,
  TypeDef,
  TypeField,
} from '../types.js';
import type { RepoAnalyzer, RepoSemanticAnalysis, SemanticFileAnalysis } from './types.js';

const SUPPORTED_LANGUAGES = new Set(['typescript', 'tsx', 'javascript']);
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const PROCEDURE_KINDS = new Set(['query', 'mutation', 'subscription']);

function createMetadata(
  confidence: number,
  detail: string,
): {
  sourceKind: SourceKind;
  confidence: number;
  provenance: Array<{
    sourceKind: SourceKind;
    adapter: string;
    detail: string;
    confidence: number;
  }>;
} {
  return {
    sourceKind: 'semantic',
    confidence,
    provenance: [{ sourceKind: 'semantic', adapter: 'typescript-compiler', detail, confidence }],
  };
}

function ensureFileAnalysis(
  analysisByFile: Map<string, SemanticFileAnalysis>,
  filePath: string,
): SemanticFileAnalysis {
  const existing = analysisByFile.get(filePath);
  if (existing) {
    return existing;
  }

  const next: SemanticFileAnalysis = {
    exports: [],
    routes: [],
    procedures: [],
    types: [],
    schemas: [],
    imports: [],
    symbolReferences: [],
  };
  analysisByFile.set(filePath, next);
  return next;
}

function nodeLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function safeTypeString(checker: ts.TypeChecker, type: ts.Type | undefined): string {
  if (!type) return 'unknown';
  try {
    return checker.typeToString(type);
  } catch {
    return 'unknown';
  }
}

function extractFieldsFromType(checker: ts.TypeChecker, type: ts.Type | undefined): TypeField[] {
  if (!type) return [];

  const fields: TypeField[] = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    const propertyType = declaration
      ? checker.getTypeOfSymbolAtLocation(property, declaration)
      : undefined;
    fields.push({
      name: property.getName(),
      type: safeTypeString(checker, propertyType),
      optional: Boolean(property.flags & ts.SymbolFlags.Optional),
    });
  }

  return fields;
}

function pushUniqueExport(entries: ExportDef[], entry: ExportDef): void {
  const key = `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`;
  if (
    !entries.some(
      (candidate) =>
        `${candidate.kind}:${candidate.name}:${candidate.file}:${candidate.line}` === key,
    )
  ) {
    entries.push(entry);
  }
}

function pushUniqueType(entries: TypeDef[], entry: TypeDef): void {
  const key = `${entry.name}:${entry.source.file}:${entry.source.line}`;
  if (
    !entries.some(
      (candidate) => `${candidate.name}:${candidate.source.file}:${candidate.source.line}` === key,
    )
  ) {
    entries.push(entry);
  }
}

function pushUniqueRoute(entries: RouteDefinition[], entry: RouteDefinition): void {
  const key = `${entry.method}:${entry.path}:${entry.file}:${entry.line}`;
  if (
    !entries.some(
      (candidate) =>
        `${candidate.method}:${candidate.path}:${candidate.file}:${candidate.line}` === key,
    )
  ) {
    entries.push(entry);
  }
}

function pushUniqueProcedure(entries: ProcedureDef[], entry: ProcedureDef): void {
  const key = `${entry.kind}:${entry.name}:${entry.file}:${entry.line}`;
  if (
    !entries.some(
      (candidate) =>
        `${candidate.kind}:${candidate.name}:${candidate.file}:${candidate.line}` === key,
    )
  ) {
    entries.push(entry);
  }
}

function pushUniqueImport(entries: InternalDep[], entry: InternalDep): void {
  const existing = entries.find(
    (candidate) => candidate.from === entry.from && candidate.to === entry.to,
  );
  if (existing) {
    for (const imported of entry.imports) {
      if (!existing.imports.includes(imported)) {
        existing.imports.push(imported);
      }
    }
    return;
  }

  entries.push(entry);
}

function pushUniqueSymbolReference(entries: SymbolReference[], entry: SymbolReference): void {
  const key = `${entry.kind}:${entry.name}:${entry.fromFile}:${entry.toFile ?? ''}:${entry.line}`;
  if (
    !entries.some(
      (candidate) =>
        `${candidate.kind}:${candidate.name}:${candidate.fromFile}:${candidate.toFile ?? ''}:${candidate.line}` ===
        key,
    )
  ) {
    entries.push(entry);
  }
}

function addDeclarationExports(
  checker: ts.TypeChecker,
  repoId: string,
  relPath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  fileAnalysis: SemanticFileAnalysis,
): void {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    const nameNode = node.name;
    if (!nameNode) return;

    const declarationSignature = ts.isFunctionDeclaration(node)
      ? checker.getSignatureFromDeclaration(node)
      : undefined;
    const type =
      ts.isFunctionDeclaration(node) && node.type
        ? checker.getTypeFromTypeNode(node.type)
        : checker.getTypeAtLocation(node);
    const signature =
      ts.isFunctionDeclaration(node) && declarationSignature
        ? checker.signatureToString(declarationSignature)
        : safeTypeString(checker, type);

    pushUniqueExport(fileAnalysis.exports, {
      name: nameNode.text,
      kind: ts.isFunctionDeclaration(node)
        ? 'function'
        : ts.isClassDeclaration(node)
          ? 'class'
          : ts.isInterfaceDeclaration(node)
            ? 'interface'
            : ts.isEnumDeclaration(node)
              ? 'enum'
              : 'type',
      signature,
      file: relPath,
      line: nodeLine(sourceFile, node),
      ...createMetadata(0.96, 'typescript semantic export'),
    });

    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      const nodeType = checker.getTypeAtLocation(node);
      pushUniqueType(fileAnalysis.types, {
        name: nameNode.text,
        fields: extractFieldsFromType(checker, nodeType),
        extends:
          ts.isInterfaceDeclaration(node) && node.heritageClauses
            ? node.heritageClauses.flatMap((clause) =>
                clause.types.map((heritageType) => heritageType.expression.getText(sourceFile)),
              )
            : undefined,
        source: {
          repo: repoId,
          file: relPath,
          line: nodeLine(sourceFile, node),
        },
        ...createMetadata(0.94, 'typescript semantic type'),
      });
    }
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const declarationType = checker.getTypeAtLocation(declaration);
      pushUniqueExport(fileAnalysis.exports, {
        name: declaration.name.text,
        kind: 'constant',
        signature: safeTypeString(checker, declarationType),
        file: relPath,
        line: nodeLine(sourceFile, declaration),
        ...createMetadata(0.9, 'typescript semantic variable export'),
      });
    }
  }
}

function addImportDependencies(
  checker: ts.TypeChecker,
  repoPath: string,
  relPath: string,
  sourceFile: ts.SourceFile,
  fileAnalysis: SemanticFileAnalysis,
): void {
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!node.importClause || !ts.isStringLiteral(node.moduleSpecifier)) return;

    const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
    const declaration = symbol?.declarations?.[0];
    const targetFile = declaration?.getSourceFile().fileName;
    if (!targetFile) return;
    if (!targetFile.startsWith(repoPath)) return;
    if (targetFile === sourceFile.fileName) return;

    const importedNames: string[] = [];
    if (node.importClause.name) {
      importedNames.push(node.importClause.name.text);
    }

    const namedBindings = node.importClause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        importedNames.push(element.name.text);
      }
    }

    const toFile = path.relative(repoPath, targetFile).replace(/\\/g, '/');
    pushUniqueImport(fileAnalysis.imports, {
      from: relPath,
      to: toFile,
      imports: importedNames,
      ...createMetadata(0.98, 'typescript semantic import'),
    });

    for (const imported of importedNames) {
      pushUniqueSymbolReference(fileAnalysis.symbolReferences, {
        name: imported,
        kind: 'import',
        fromFile: relPath,
        toFile,
        line: nodeLine(sourceFile, node),
        ...createMetadata(0.95, 'typescript semantic symbol reference'),
      });
    }
  });
}

function addCallBasedArtifacts(
  checker: ts.TypeChecker,
  repoPath: string,
  relPath: string,
  sourceFile: ts.SourceFile,
  fileAnalysis: SemanticFileAnalysis,
): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const propertyName = node.expression.name.text;
      const receiver = node.expression.expression.getText(sourceFile);
      const firstArg = node.arguments[0];

      if (ROUTE_METHODS.has(propertyName) && firstArg && ts.isStringLiteralLike(firstArg)) {
        const signature = checker.getResolvedSignature(node);
        const returnType = signature ? checker.getReturnTypeOfSignature(signature) : undefined;
        pushUniqueRoute(fileAnalysis.routes, {
          method: propertyName.toUpperCase(),
          path: firstArg.text,
          handler: receiver,
          file: relPath,
          line: nodeLine(sourceFile, node),
          outputType: safeTypeString(checker, returnType),
          ...createMetadata(0.88, 'typescript semantic route'),
        });
      }

      if (PROCEDURE_KINDS.has(propertyName) && firstArg && ts.isStringLiteralLike(firstArg)) {
        pushUniqueProcedure(fileAnalysis.procedures, {
          name: firstArg.text,
          kind: propertyName as ProcedureDef['kind'],
          file: relPath,
          line: nodeLine(sourceFile, node),
          ...createMetadata(0.86, 'typescript semantic procedure'),
        });
      }
    }

    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declaration = symbol?.declarations?.[0];
      const targetFile = declaration?.getSourceFile().fileName;
      if (targetFile && targetFile.startsWith(repoPath) && targetFile !== sourceFile.fileName) {
        pushUniqueSymbolReference(fileAnalysis.symbolReferences, {
          name: node.text,
          kind: 'call',
          fromFile: relPath,
          toFile: path.relative(repoPath, targetFile).replace(/\\/g, '/'),
          line: nodeLine(sourceFile, node),
          ...createMetadata(0.8, 'typescript semantic identifier reference'),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

class TypeScriptSemanticAnalyzer implements RepoAnalyzer {
  readonly id = 'typescript-compiler';

  supports(config: RepoConfig): boolean {
    return SUPPORTED_LANGUAGES.has(config.language);
  }

  async analyzeRepo(config: RepoConfig, filePaths: string[]): Promise<RepoSemanticAnalysis | null> {
    if (!this.supports(config) || filePaths.length === 0) {
      return null;
    }

    const program = ts.createProgram(filePaths, {
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const analysisByFile = new Map<string, SemanticFileAnalysis>();

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      if (!sourceFile.fileName.startsWith(config.path)) continue;

      const relPath = path.relative(config.path, sourceFile.fileName).replace(/\\/g, '/');
      if (!filePaths.includes(sourceFile.fileName)) continue;

      const fileAnalysis = ensureFileAnalysis(analysisByFile, relPath);
      addImportDependencies(checker, config.path, relPath, sourceFile, fileAnalysis);
      addCallBasedArtifacts(checker, config.path, relPath, sourceFile, fileAnalysis);

      sourceFile.forEachChild((node) =>
        addDeclarationExports(checker, config.name, relPath, sourceFile, node, fileAnalysis),
      );
    }

    return {
      adapter: this.id,
      files: analysisByFile,
    };
  }
}

export const typeScriptSemanticAnalyzer = new TypeScriptSemanticAnalyzer();
