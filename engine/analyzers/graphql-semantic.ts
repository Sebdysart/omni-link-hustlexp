import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  Kind,
  parse,
  print,
  type DocumentNode,
  type FieldDefinitionNode,
  type FragmentDefinitionNode,
  type InterfaceTypeDefinitionNode,
  type InterfaceTypeExtensionNode,
  type InputObjectTypeDefinitionNode,
  type InputObjectTypeExtensionNode,
  type InputValueDefinitionNode,
  type ObjectTypeDefinitionNode,
  type OperationDefinitionNode,
  type TypeNode,
  type TypeSystemDefinitionNode,
  type TypeSystemExtensionNode,
} from 'graphql';

import type { ExportDef, InternalDep, RepoConfig, SourceKind, TypeDef } from '../types.js';
import type { RepoAnalyzer, RepoSemanticAnalysis, SemanticFileAnalysis } from './types.js';

interface ParsedGraphQlDocument {
  relPath: string;
  source: string;
  document: DocumentNode;
}

interface TypeOwner {
  file: string;
  kind: ExportDef['kind'];
}

function createMetadata(
  adapter: string,
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
    provenance: [{ sourceKind: 'semantic', adapter, detail, confidence }],
  };
}

function fileAnalysis(): SemanticFileAnalysis {
  return {
    exports: [],
    routes: [],
    procedures: [],
    types: [],
    schemas: [],
    imports: [],
    symbolReferences: [],
  };
}

function lineFor(source: string, offset: number | undefined): number {
  if (offset === undefined) {
    return 1;
  }
  return source.slice(0, offset).split('\n').length;
}

function namedTypeNames(typeNode: TypeNode): string[] {
  switch (typeNode.kind) {
    case Kind.NON_NULL_TYPE:
    case Kind.LIST_TYPE:
      return namedTypeNames(typeNode.type);
    case Kind.NAMED_TYPE:
      return [typeNode.name.value];
  }
}

function fieldTypeString(field: FieldDefinitionNode | InputValueDefinitionNode): string {
  return print(field.type).replace(/\s+/g, ' ').trim();
}

function optionalType(typeNode: TypeNode): boolean {
  return typeNode.kind !== Kind.NON_NULL_TYPE;
}

function exportKindForDefinition(
  definition: TypeSystemDefinitionNode | TypeSystemExtensionNode,
): ExportDef['kind'] | null {
  switch (definition.kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_EXTENSION:
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
    case Kind.UNION_TYPE_DEFINITION:
    case Kind.UNION_TYPE_EXTENSION:
    case Kind.SCALAR_TYPE_DEFINITION:
    case Kind.SCALAR_TYPE_EXTENSION:
      return 'type';
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_EXTENSION:
      return 'interface';
    case Kind.ENUM_TYPE_DEFINITION:
    case Kind.ENUM_TYPE_EXTENSION:
      return 'enum';
    default:
      return null;
  }
}

function addTypeReference(
  analysis: SemanticFileAnalysis,
  symbolTargets: Map<string, Set<string>>,
  refName: string,
  toFile: string | undefined,
  fromFile: string,
  line: number,
  detail: string,
): void {
  if (!toFile || toFile === fromFile) {
    return;
  }

  const targetNames = symbolTargets.get(toFile) ?? new Set<string>();
  targetNames.add(refName);
  symbolTargets.set(toFile, targetNames);
  analysis.symbolReferences.push({
    name: refName,
    kind: 'type',
    fromFile,
    toFile,
    line,
    ...createMetadata('graphql-ast', 0.92, detail),
  });
}

function addGraphQlImports(
  analysis: SemanticFileAnalysis,
  fromFile: string,
  symbolTargets: Map<string, Set<string>>,
): void {
  analysis.imports.push(
    ...[...symbolTargets.entries()]
      .filter(([toFile, names]) => toFile !== fromFile && names.size > 0)
      .map(
        ([toFile, names]) =>
          ({
            from: fromFile,
            to: toFile,
            imports: [...names].sort(),
            ...createMetadata('graphql-ast', 0.94, 'graphql local type dependency'),
          }) satisfies InternalDep,
      ),
  );
}

function typeFields(
  definition:
    | InterfaceTypeDefinitionNode
    | InterfaceTypeExtensionNode
    | InputObjectTypeDefinitionNode
    | InputObjectTypeExtensionNode
    | ObjectTypeDefinitionNode,
): TypeDef['fields'] {
  const fields = definition.fields ?? [];
  return fields.map((field) => ({
    name: field.name.value,
    type: fieldTypeString(field),
    optional: optionalType(field.type),
  }));
}

function rootMethodFor(typeName: string): string | null {
  switch (typeName) {
    case 'Query':
      return 'QUERY';
    case 'Mutation':
      return 'MUTATION';
    case 'Subscription':
      return 'SUBSCRIPTION';
    default:
      return null;
  }
}

function rootTypeNameForOperation(operation: OperationDefinitionNode['operation']): string {
  switch (operation) {
    case 'mutation':
      return 'Mutation';
    case 'subscription':
      return 'Subscription';
    case 'query':
    default:
      return 'Query';
  }
}

function selectionFieldNames(operation: OperationDefinitionNode): string[] {
  return operation.selectionSet.selections
    .filter((selection) => selection.kind === Kind.FIELD)
    .map((selection) => selection.name.value);
}

function fragmentRefs(definition: FragmentDefinitionNode): string[] {
  const refs = new Set<string>();
  for (const selection of definition.selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      refs.add(selection.name.value);
    }
  }
  return [...refs];
}

function parseDocument(source: string): DocumentNode | null {
  try {
    return parse(source, { noLocation: false });
  } catch {
    return null;
  }
}

function buildTypeIndex(documents: ParsedGraphQlDocument[]): Map<string, TypeOwner> {
  const index = new Map<string, TypeOwner>();
  for (const { relPath, document } of documents) {
    for (const definition of document.definitions) {
      if (!('name' in definition) || !definition.name) {
        continue;
      }
      const exportKind = exportKindForDefinition(definition as TypeSystemDefinitionNode);
      if (!exportKind) {
        continue;
      }
      index.set(definition.name.value, { file: relPath, kind: exportKind });
    }
  }
  return index;
}

function buildFragmentIndex(documents: ParsedGraphQlDocument[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const { relPath, document } of documents) {
    for (const definition of document.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        index.set(definition.name.value, relPath);
      }
    }
  }
  return index;
}

class GraphQlSemanticAnalyzer implements RepoAnalyzer {
  readonly id = 'graphql-ast';

  supports(config: RepoConfig): boolean {
    return config.language === 'graphql';
  }

  async analyzeRepo(config: RepoConfig, filePaths: string[]): Promise<RepoSemanticAnalysis | null> {
    if (!this.supports(config) || filePaths.length === 0) {
      return null;
    }

    const documents: ParsedGraphQlDocument[] = [];
    for (const filePath of filePaths) {
      const relPath = path.relative(config.path, filePath).replace(/\\/g, '/');
      const source = await fs.readFile(filePath, 'utf-8');
      const document = parseDocument(source);
      if (!document) {
        return null;
      }
      documents.push({ relPath, source, document });
    }

    const typeIndex = buildTypeIndex(documents);
    const fragmentIndex = buildFragmentIndex(documents);
    const files = new Map<string, SemanticFileAnalysis>();

    for (const { relPath, source, document } of documents) {
      const analysis = fileAnalysis();
      const symbolTargets = new Map<string, Set<string>>();

      for (const definition of document.definitions) {
        if ('name' in definition && definition.name) {
          const exportKind = exportKindForDefinition(definition as TypeSystemDefinitionNode);
          if (exportKind) {
            analysis.exports.push({
              name: definition.name.value,
              kind: exportKind,
              signature: `${definition.kind} ${definition.name.value}`,
              file: relPath,
              line: lineFor(source, definition.loc?.start),
              ...createMetadata('graphql-ast', 0.94, 'graphql definition export'),
            });
          }
        }

        switch (definition.kind) {
          case Kind.OBJECT_TYPE_DEFINITION:
          case Kind.OBJECT_TYPE_EXTENSION: {
            const typeName = definition.name.value;
            const fields = definition.fields ?? [];
            const method = rootMethodFor(typeName);
            if (method) {
              for (const field of fields) {
                analysis.routes.push({
                  method,
                  path: `${method.toLowerCase()}.${field.name.value}`,
                  handler: field.name.value,
                  file: relPath,
                  line: lineFor(source, field.loc?.start),
                  inputType:
                    field.arguments && field.arguments.length > 0
                      ? field.arguments
                          .map((argument) => `${argument.name.value}: ${fieldTypeString(argument)}`)
                          .join(', ')
                      : undefined,
                  outputType: fieldTypeString(field),
                  ...createMetadata('graphql-ast', 0.94, 'graphql root field'),
                });
              }
            }

            analysis.types.push({
              name: typeName,
              fields: fields.map((field) => ({
                name: field.name.value,
                type: fieldTypeString(field),
                optional: optionalType(field.type),
              })),
              source: {
                repo: config.name,
                file: relPath,
                line: lineFor(source, definition.loc?.start),
              },
              ...createMetadata('graphql-ast', 0.93, 'graphql object type'),
            });

            for (const field of fields) {
              for (const refName of namedTypeNames(field.type)) {
                addTypeReference(
                  analysis,
                  symbolTargets,
                  refName,
                  typeIndex.get(refName)?.file,
                  relPath,
                  lineFor(source, field.loc?.start),
                  'graphql field return type',
                );
              }
              for (const argument of field.arguments ?? []) {
                for (const refName of namedTypeNames(argument.type)) {
                  addTypeReference(
                    analysis,
                    symbolTargets,
                    refName,
                    typeIndex.get(refName)?.file,
                    relPath,
                    lineFor(source, argument.loc?.start),
                    'graphql field argument type',
                  );
                }
              }
            }
            break;
          }
          case Kind.INTERFACE_TYPE_DEFINITION:
          case Kind.INTERFACE_TYPE_EXTENSION:
          case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          case Kind.INPUT_OBJECT_TYPE_EXTENSION: {
            analysis.types.push({
              name: definition.name.value,
              fields: typeFields(definition),
              source: {
                repo: config.name,
                file: relPath,
                line: lineFor(source, definition.loc?.start),
              },
              ...createMetadata(
                'graphql-ast',
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ? 0.92 : 0.91,
                definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION
                  ? 'graphql input type'
                  : 'graphql interface type',
              ),
            });

            if (definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
              analysis.schemas.push({
                name: definition.name.value,
                kind: 'other',
                fields: typeFields(definition),
                source: {
                  repo: config.name,
                  file: relPath,
                  line: lineFor(source, definition.loc?.start),
                },
                ...createMetadata('graphql-ast', 0.93, 'graphql input schema'),
              });
            }

            for (const field of definition.fields ?? []) {
              for (const refName of namedTypeNames(field.type)) {
                addTypeReference(
                  analysis,
                  symbolTargets,
                  refName,
                  typeIndex.get(refName)?.file,
                  relPath,
                  lineFor(source, field.loc?.start),
                  'graphql field type reference',
                );
              }
            }
            break;
          }
          case Kind.UNION_TYPE_DEFINITION:
          case Kind.UNION_TYPE_EXTENSION: {
            analysis.types.push({
              name: definition.name.value,
              fields: (definition.types ?? []).map((member) => ({
                name: member.name.value,
                type: member.name.value,
                optional: false,
              })),
              source: {
                repo: config.name,
                file: relPath,
                line: lineFor(source, definition.loc?.start),
              },
              ...createMetadata('graphql-ast', 0.9, 'graphql union type'),
            });
            for (const member of definition.types ?? []) {
              addTypeReference(
                analysis,
                symbolTargets,
                member.name.value,
                typeIndex.get(member.name.value)?.file,
                relPath,
                lineFor(source, member.loc?.start),
                'graphql union member',
              );
            }
            break;
          }
          case Kind.ENUM_TYPE_DEFINITION:
          case Kind.ENUM_TYPE_EXTENSION:
          case Kind.SCALAR_TYPE_DEFINITION:
          case Kind.SCALAR_TYPE_EXTENSION:
            analysis.types.push({
              name: definition.name.value,
              fields: [],
              source: {
                repo: config.name,
                file: relPath,
                line: lineFor(source, definition.loc?.start),
              },
              ...createMetadata('graphql-ast', 0.88, 'graphql enum or scalar'),
            });
            break;
          case Kind.OPERATION_DEFINITION: {
            const operationName = definition.name?.value ?? 'anonymous';
            analysis.procedures.push({
              name: operationName,
              kind: definition.operation,
              file: relPath,
              line: lineFor(source, definition.loc?.start),
              ...createMetadata('graphql-ast', 0.94, 'graphql operation'),
            });
            const rootTypeName = rootTypeNameForOperation(definition.operation);
            const rootType = typeIndex.get(rootTypeName);
            for (const selectedField of selectionFieldNames(definition)) {
              if (rootType?.file && rootType.file !== relPath) {
                const targetNames = symbolTargets.get(rootType.file) ?? new Set<string>();
                targetNames.add(selectedField);
                symbolTargets.set(rootType.file, targetNames);
                analysis.symbolReferences.push({
                  name: selectedField,
                  kind: 'route',
                  fromFile: relPath,
                  toFile: rootType.file,
                  line: lineFor(source, definition.loc?.start),
                  ...createMetadata('graphql-ast', 0.92, 'graphql operation root field'),
                });
              }
            }
            for (const variable of definition.variableDefinitions ?? []) {
              for (const refName of namedTypeNames(variable.type)) {
                addTypeReference(
                  analysis,
                  symbolTargets,
                  refName,
                  typeIndex.get(refName)?.file,
                  relPath,
                  lineFor(source, variable.loc?.start),
                  'graphql variable type',
                );
              }
            }
            break;
          }
          case Kind.FRAGMENT_DEFINITION: {
            analysis.exports.push({
              name: definition.name.value,
              kind: 'constant',
              signature: `fragment ${definition.name.value} on ${definition.typeCondition.name.value}`,
              file: relPath,
              line: lineFor(source, definition.loc?.start),
              ...createMetadata('graphql-ast', 0.91, 'graphql fragment export'),
            });
            addTypeReference(
              analysis,
              symbolTargets,
              definition.typeCondition.name.value,
              typeIndex.get(definition.typeCondition.name.value)?.file,
              relPath,
              lineFor(source, definition.typeCondition.loc?.start),
              'graphql fragment type condition',
            );
            for (const fragmentRef of fragmentRefs(definition)) {
              const toFile = fragmentIndex.get(fragmentRef);
              if (toFile && toFile !== relPath) {
                const targetNames = symbolTargets.get(toFile) ?? new Set<string>();
                targetNames.add(fragmentRef);
                symbolTargets.set(toFile, targetNames);
                analysis.symbolReferences.push({
                  name: fragmentRef,
                  kind: 'procedure',
                  fromFile: relPath,
                  toFile,
                  line: lineFor(source, definition.loc?.start),
                  ...createMetadata('graphql-ast', 0.89, 'graphql fragment spread'),
                });
              }
            }
            break;
          }
          default:
            break;
        }
      }

      addGraphQlImports(analysis, relPath, symbolTargets);
      files.set(relPath, analysis);
    }

    return {
      adapter: this.id,
      files,
    };
  }
}

export const graphQlSemanticAnalyzer = new GraphQlSemanticAnalyzer();
