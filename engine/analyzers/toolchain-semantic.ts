import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ExportDef,
  InternalDep,
  ProcedureDef,
  RepoConfig,
  RouteDefinition,
  SchemaDef,
  SourceKind,
  SymbolReference,
  TypeDef,
} from '../types.js';
import type { RepoAnalyzer, RepoSemanticAnalysis, SemanticFileAnalysis } from './types.js';

const execFileAsync = promisify(execFile);
const SUPPORTED_LANGUAGES = new Set(['python', 'go', 'swift', 'java']);

interface RawSemanticFileAnalysis {
  exports?: ExportDef[];
  routes?: RouteDefinition[];
  procedures?: ProcedureDef[];
  types?: TypeDef[];
  schemas?: SchemaDef[];
  imports?: InternalDep[];
  symbolReferences?: SymbolReference[];
}

interface RawSemanticResult {
  adapter: string;
  files: Record<string, RawSemanticFileAnalysis>;
}

function readArray<T>(
  analysis: RawSemanticFileAnalysis,
  lowerKey: keyof RawSemanticFileAnalysis,
  upperKey: string,
): T[] | undefined {
  const lower = analysis[lowerKey] as T[] | undefined;
  if (lower) {
    return lower;
  }

  const upper = (analysis as Record<string, unknown>)[upperKey];
  return Array.isArray(upper) ? (upper as T[]) : undefined;
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

function addMetadata<T extends object>(
  entries: T[] | undefined,
  adapter: string,
  confidence: number,
  detail: string,
): T[] {
  return (entries ?? []).map((entry) => ({
    ...entry,
    ...createMetadata(adapter, confidence, detail),
  }));
}

function normalizeResult(raw: RawSemanticResult): RepoSemanticAnalysis {
  return {
    adapter: raw.adapter,
    files: new Map(
      Object.entries(raw.files).map(([file, analysis]) => [
        file,
        {
          exports: addMetadata(
            readArray<ExportDef>(analysis, 'exports', 'Exports'),
            raw.adapter,
            0.93,
            `${raw.adapter} export`,
          ),
          routes: addMetadata(
            readArray<RouteDefinition>(analysis, 'routes', 'Routes'),
            raw.adapter,
            0.91,
            `${raw.adapter} route`,
          ),
          procedures: addMetadata(
            readArray<ProcedureDef>(analysis, 'procedures', 'Procedures'),
            raw.adapter,
            0.89,
            `${raw.adapter} procedure`,
          ),
          types: addMetadata(
            readArray<TypeDef>(analysis, 'types', 'Types'),
            raw.adapter,
            0.92,
            `${raw.adapter} type`,
          ),
          schemas: addMetadata(
            readArray<SchemaDef>(analysis, 'schemas', 'Schemas'),
            raw.adapter,
            0.9,
            `${raw.adapter} schema`,
          ),
          imports: addMetadata(
            readArray<InternalDep>(analysis, 'imports', 'Imports'),
            raw.adapter,
            0.95,
            `${raw.adapter} import`,
          ),
          symbolReferences: addMetadata(
            readArray<SymbolReference>(analysis, 'symbolReferences', 'SymbolReferences'),
            raw.adapter,
            0.91,
            `${raw.adapter} symbol reference`,
          ),
        } satisfies SemanticFileAnalysis,
      ]),
    ),
  };
}

const PYTHON_HELPER = String.raw`
import ast
import json
import os
import sys
import symtable

repo_path = sys.argv[1]
file_paths = json.loads(sys.argv[2])

module_index = {}
for file_path in file_paths:
    rel_path = os.path.relpath(file_path, repo_path).replace(os.sep, "/")
    if not rel_path.endswith(".py"):
        continue
    module_name = rel_path[:-3].replace("/", ".")
    if module_name.endswith(".__init__"):
        module_name = module_name[:-9]
    if module_name:
        module_index[module_name] = rel_path

def resolve_module(current_rel_path, raw_module, level=0):
    if level > 0:
        base_parts = os.path.dirname(current_rel_path).replace(os.sep, "/").split("/")
        parent_depth = max(0, level - 1)
        base_parts = base_parts[: max(0, len(base_parts) - parent_depth)]
        module_parts = raw_module.split(".") if raw_module else []
        candidate = ".".join([part for part in base_parts + module_parts if part])
        return module_index.get(candidate)
    if raw_module in module_index:
        return module_index[raw_module]
    parts = raw_module.split(".") if raw_module else []
    for index in range(1, len(parts)):
        candidate = ".".join(parts[index:])
        if candidate in module_index:
            return module_index[candidate]
    return None

def annotation_to_string(node):
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None

def function_signature(node):
    params = []
    positional = list(getattr(node.args, "posonlyargs", [])) + list(node.args.args)
    positional_defaults = [None] * (len(positional) - len(node.args.defaults)) + list(node.args.defaults)
    for arg, default in zip(positional, positional_defaults):
        segment = arg.arg
        annotation = annotation_to_string(arg.annotation)
        if annotation:
            segment += f": {annotation}"
        if default is not None:
            segment += " = ..."
        params.append(segment)
    if node.args.vararg is not None:
        segment = f"*{node.args.vararg.arg}"
        annotation = annotation_to_string(node.args.vararg.annotation)
        if annotation:
            segment += f": {annotation}"
        params.append(segment)
    elif node.args.kwonlyargs:
        params.append("*")
    for arg, default in zip(node.args.kwonlyargs, node.args.kw_defaults):
        segment = arg.arg
        annotation = annotation_to_string(arg.annotation)
        if annotation:
            segment += f": {annotation}"
        if default is not None:
            segment += " = ..."
        params.append(segment)
    if node.args.kwarg is not None:
        segment = f"**{node.args.kwarg.arg}"
        annotation = annotation_to_string(node.args.kwarg.annotation)
        if annotation:
            segment += f": {annotation}"
        params.append(segment)
    signature = f"def {node.name}({', '.join(params)})"
    returns = annotation_to_string(node.returns)
    if returns:
        signature += f" -> {returns}"
    return signature

def extract_fields(class_node):
    fields = []
    for child in class_node.body:
        if isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            field_type = annotation_to_string(child.annotation) or "unknown"
            fields.append(
                {
                    "name": child.target.id,
                    "type": field_type,
                    "optional": "None" in field_type or "Optional" in field_type,
                }
            )
    return fields

def class_base_names(class_node):
    names = []
    for base in class_node.bases:
        base_name = annotation_to_string(base)
        if base_name:
            names.append(base_name)
    return names

results = {}
for file_path in file_paths:
    rel_path = os.path.relpath(file_path, repo_path).replace(os.sep, "/")
    with open(file_path, "r", encoding="utf-8") as handle:
        source = handle.read()
    tree = ast.parse(source, filename=rel_path)
    compile(source, rel_path, "exec")
    symbol_table = symtable.symtable(source, rel_path, "exec")
    imported_symbols = {
        symbol.get_name()
        for symbol in symbol_table.get_symbols()
        if symbol.is_imported()
    }
    local_exports = {}
    import_targets = {}
    seen_refs = set()
    analysis = {
        "exports": [],
        "routes": [],
        "procedures": [],
        "types": [],
        "schemas": [],
        "imports": [],
        "symbolReferences": [],
    }

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith("_"):
            signature = function_signature(node)
            local_exports[node.name] = rel_path
            analysis["exports"].append(
                {
                    "name": node.name,
                    "kind": "function",
                    "signature": signature,
                    "file": rel_path,
                    "line": node.lineno,
                }
            )
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                    method = decorator.func.attr.lower()
                    if method in {"get", "post", "put", "patch", "delete", "options", "head"}:
                        if decorator.args and isinstance(decorator.args[0], ast.Constant) and isinstance(decorator.args[0].value, str):
                            analysis["routes"].append(
                                {
                                    "method": method.upper(),
                                    "path": decorator.args[0].value,
                                    "handler": node.name,
                                    "file": rel_path,
                                    "line": decorator.lineno,
                                }
                            )

        elif isinstance(node, ast.ClassDef) and not node.name.startswith("_"):
            local_exports[node.name] = rel_path
            fields = extract_fields(node)
            signature = f"class {node.name}"
            analysis["exports"].append(
                {
                    "name": node.name,
                    "kind": "class",
                    "signature": signature,
                    "file": rel_path,
                    "line": node.lineno,
                }
            )
            analysis["types"].append(
                {
                    "name": node.name,
                    "fields": fields,
                    "source": {"repo": "", "file": rel_path, "line": node.lineno},
                }
            )
            base_names = class_base_names(node)
            if any(base.endswith("BaseModel") or base == "BaseModel" for base in base_names):
                analysis["schemas"].append(
                    {
                        "name": node.name,
                        "kind": "pydantic",
                        "fields": fields,
                        "source": {"repo": "", "file": rel_path, "line": node.lineno},
                    }
                )

        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id.isupper():
                    local_exports[target.id] = rel_path
                    analysis["exports"].append(
                        {
                            "name": target.id,
                            "kind": "constant",
                            "signature": target.id,
                            "file": rel_path,
                            "line": node.lineno,
                        }
                    )

        if isinstance(node, ast.Import):
            for alias in node.names:
                target_file = resolve_module(rel_path, alias.name, 0)
                if not target_file or target_file == rel_path:
                    continue
                imported_name = alias.asname or alias.name.split(".")[-1]
                import_targets[imported_name] = target_file
                analysis["imports"].append(
                    {
                        "from": rel_path,
                        "to": target_file,
                        "imports": [imported_name],
                    }
                )
                analysis["symbolReferences"].append(
                    {
                        "name": imported_name,
                        "kind": "import",
                        "fromFile": rel_path,
                        "toFile": target_file,
                        "line": node.lineno,
                    }
                )

        if isinstance(node, ast.ImportFrom):
            target_file = resolve_module(rel_path, node.module or "", node.level)
            if not target_file or target_file == rel_path:
                continue
            imported = []
            for alias in node.names:
                if alias.name == "*":
                    continue
                imported_name = alias.asname or alias.name
                imported.append(imported_name)
                import_targets[imported_name] = target_file
                analysis["symbolReferences"].append(
                    {
                        "name": imported_name,
                        "kind": "import",
                        "fromFile": rel_path,
                        "toFile": target_file,
                        "line": node.lineno,
                    }
                )
            if imported:
                analysis["imports"].append(
                    {
                        "from": rel_path,
                        "to": target_file,
                        "imports": imported,
                    }
                )

    class CallCollector(ast.NodeVisitor):
        def visit_Call(self, node):
            name = None
            target_file = None
            if isinstance(node.func, ast.Name):
                name = node.func.id
                target_file = import_targets.get(name) or local_exports.get(name)
            elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                owner = node.func.value.id
                if owner in import_targets:
                    name = node.func.attr
                    target_file = import_targets.get(owner)
            if name and target_file:
                key = (name, target_file, node.lineno)
                if key not in seen_refs:
                    seen_refs.add(key)
                    analysis["symbolReferences"].append(
                        {
                            "name": name,
                            "kind": "call",
                            "fromFile": rel_path,
                            "toFile": target_file,
                            "line": node.lineno,
                        }
                    )
            self.generic_visit(node)

    CallCollector().visit(tree)

    for symbol_name in imported_symbols:
        target_file = import_targets.get(symbol_name)
        if not target_file:
            continue
        key = (symbol_name, target_file, 1)
        if key in seen_refs:
            continue
        seen_refs.add(key)
        analysis["symbolReferences"].append(
            {
                "name": symbol_name,
                "kind": "import",
                "fromFile": rel_path,
                "toFile": target_file,
                "line": 1,
            }
        )

    for type_entry in analysis["types"]:
        type_entry["source"]["repo"] = os.path.basename(repo_path)
    for schema_entry in analysis["schemas"]:
        schema_entry["source"]["repo"] = os.path.basename(repo_path)
    results[rel_path] = analysis

print(json.dumps({"adapter": "python-compiler", "files": results}))
`;

const GO_HELPER = String.raw`
package main

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/format"
	"go/importer"
	"go/parser"
	"go/printer"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type payload struct {
	RepoPath string
	Files    []string
}

type analysis struct {
	Exports          []map[string]any
	Routes           []map[string]any
	Procedures       []map[string]any
	Types            []map[string]any
	Schemas          []map[string]any
	Imports          []map[string]any
	SymbolReferences []map[string]any
}

type packageContext struct {
	RepoPath   string
	Dir        string
	RelDir     string
	ImportPath string
	FilePaths  []string
	FileNodes  map[string]*ast.File
	Fset       *token.FileSet
	Info       *types.Info
	Package    *types.Package
	LocalNames map[string]string
}

type localImporter struct {
	contexts        map[string]*packageContext
	defaultImporter types.Importer
	loading         map[string]bool
}

func exprString(expr ast.Expr) string {
	if expr == nil {
		return "unknown"
	}
	var buf bytes.Buffer
	if err := format.Node(&buf, token.NewFileSet(), expr); err == nil {
		return buf.String()
	}
	buf.Reset()
	_ = printer.Fprint(&buf, token.NewFileSet(), expr)
	return buf.String()
}

func typeString(value types.Type) string {
	if value == nil {
		return "unknown"
	}
	return types.TypeString(value, func(pkg *types.Package) string {
		if pkg == nil {
			return ""
		}
		return pkg.Name()
	})
}

func resolveImport(relPath string, importPath string, directoryIndex map[string][]string) string {
	if strings.HasPrefix(importPath, "./") || strings.HasPrefix(importPath, "../") {
		resolvedDir := filepath.Clean(filepath.Join(filepath.Dir(relPath), importPath))
		if files, ok := directoryIndex[filepath.ToSlash(resolvedDir)]; ok && len(files) > 0 {
			return files[0]
		}
	}
	segments := strings.Split(importPath, "/")
	for index := 0; index < len(segments); index++ {
		suffix := strings.Join(segments[index:], "/")
		if files, ok := directoryIndex[suffix]; ok && len(files) > 0 {
			return files[0]
		}
	}
	return ""
}

func lineFor(fset *token.FileSet, node ast.Node) int {
	if node == nil {
		return 1
	}
	return fset.Position(node.Pos()).Line
}

func relativePath(repoPath string, filePath string) string {
	relPath, _ := filepath.Rel(repoPath, filePath)
	return filepath.ToSlash(relPath)
}

func readModulePath(repoPath string) string {
	goModPath := filepath.Join(repoPath, "go.mod")
	contents, err := os.ReadFile(goModPath)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(contents), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "module ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "module "))
		}
	}
	return ""
}

func buildPackageContexts(repoPath string, modulePath string, filePaths []string) []*packageContext {
	grouped := map[string][]string{}
	for _, filePath := range filePaths {
		dir := filepath.Dir(filePath)
		grouped[dir] = append(grouped[dir], filePath)
	}

	contexts := make([]*packageContext, 0, len(grouped))
	dirs := make([]string, 0, len(grouped))
	for dir := range grouped {
		dirs = append(dirs, dir)
	}
	sort.Strings(dirs)

	for _, dir := range dirs {
		paths := grouped[dir]
		sort.Strings(paths)
		ctx := &packageContext{
			RepoPath:   repoPath,
			Dir:        dir,
			RelDir:     filepath.ToSlash(strings.TrimPrefix(relativePath(repoPath, dir), "./")),
			FilePaths:  paths,
			FileNodes:  map[string]*ast.File{},
			Fset:       token.NewFileSet(),
			LocalNames: map[string]string{},
		}
		if ctx.RelDir == "." {
			ctx.RelDir = ""
		}
		switch {
		case modulePath != "" && ctx.RelDir == "":
			ctx.ImportPath = modulePath
		case modulePath != "":
			ctx.ImportPath = modulePath + "/" + ctx.RelDir
		case ctx.RelDir != "":
			ctx.ImportPath = ctx.RelDir
		default:
			ctx.ImportPath = filepath.Base(repoPath)
		}
		for _, filePath := range paths {
			fileNode, err := parser.ParseFile(ctx.Fset, filePath, nil, parser.ParseComments)
			if err != nil {
				continue
			}
			ctx.FileNodes[relativePath(repoPath, filePath)] = fileNode
		}
		contexts = append(contexts, ctx)
	}
	return contexts
}

func (li *localImporter) Import(importPath string) (*types.Package, error) {
	if ctx, ok := li.contexts[importPath]; ok {
		if ctx.Package != nil {
			return ctx.Package, nil
		}
		if li.loading[importPath] {
			return types.NewPackage(importPath, filepath.Base(importPath)), nil
		}
		li.loading[importPath] = true
		defer delete(li.loading, importPath)
		typeCheckPackage(ctx, li)
		if ctx.Package != nil {
			return ctx.Package, nil
		}
	}
	return li.defaultImporter.Import(importPath)
}

func typeCheckPackage(ctx *packageContext, pkgImporter types.Importer) {
	if ctx.Info != nil && ctx.Package != nil {
		return
	}
	files := make([]*ast.File, 0, len(ctx.FileNodes))
	relPaths := make([]string, 0, len(ctx.FileNodes))
	for relPath := range ctx.FileNodes {
		relPaths = append(relPaths, relPath)
	}
	sort.Strings(relPaths)
	for _, relPath := range relPaths {
		files = append(files, ctx.FileNodes[relPath])
	}
	ctx.Info = &types.Info{
		Types:      map[ast.Expr]types.TypeAndValue{},
		Defs:       map[*ast.Ident]types.Object{},
		Uses:       map[*ast.Ident]types.Object{},
		Selections: map[*ast.SelectorExpr]*types.Selection{},
	}
	config := types.Config{
		Importer: pkgImporter,
		Error:    func(error) {},
	}
	pkg, _ := config.Check(ctx.ImportPath, ctx.Fset, files, ctx.Info)
	if pkg == nil {
		packageName := filepath.Base(ctx.Dir)
		if len(files) > 0 && files[0] != nil && files[0].Name != nil {
			packageName = files[0].Name.Name
		}
		pkg = types.NewPackage(ctx.ImportPath, packageName)
	}
	ctx.Package = pkg
}

func findObjectFile(repoPath string, fset *token.FileSet, obj types.Object) string {
	if obj == nil || !obj.Pos().IsValid() {
		return ""
	}
	fileName := fset.Position(obj.Pos()).Filename
	if fileName == "" {
		return ""
	}
	return relativePath(repoPath, fileName)
}

func objectKindAndFields(obj types.Object) (string, []map[string]any, string) {
	typeName, ok := obj.(*types.TypeName)
	if !ok {
		return "type", []map[string]any{}, typeString(obj.Type())
	}
	underlying := typeName.Type().Underlying()
	switch concrete := underlying.(type) {
	case *types.Struct:
		fields := []map[string]any{}
		for index := 0; index < concrete.NumFields(); index++ {
			field := concrete.Field(index)
			fieldType := typeString(field.Type())
			fields = append(fields, map[string]any{
				"name":     field.Name(),
				"type":     fieldType,
				"optional": strings.HasPrefix(fieldType, "*"),
			})
		}
		return "class", fields, typeString(typeName.Type())
	case *types.Interface:
		fields := []map[string]any{}
		for index := 0; index < concrete.NumMethods(); index++ {
			method := concrete.Method(index)
			fields = append(fields, map[string]any{
				"name":     method.Name(),
				"type":     typeString(method.Type()),
				"optional": false,
			})
		}
		return "interface", fields, typeString(typeName.Type())
	default:
		return "type", []map[string]any{}, typeString(typeName.Type())
	}
}

func collectLocalNames(ctx *packageContext) {
	for relPath, fileNode := range ctx.FileNodes {
		for _, decl := range fileNode.Decls {
			switch typed := decl.(type) {
			case *ast.FuncDecl:
				ctx.LocalNames[typed.Name.Name] = relPath
			case *ast.GenDecl:
				for _, spec := range typed.Specs {
					switch declared := spec.(type) {
					case *ast.TypeSpec:
						ctx.LocalNames[declared.Name.Name] = relPath
					case *ast.ValueSpec:
						for _, name := range declared.Names {
							ctx.LocalNames[name.Name] = relPath
						}
					}
				}
			}
		}
	}
}

func addRouteCall(fileAnalysis *analysis, method string, routePath string, handler string, relPath string, line int) {
	fileAnalysis.Routes = append(fileAnalysis.Routes, map[string]any{
		"method":  method,
		"path":    routePath,
		"handler": handler,
		"file":    relPath,
		"line":    line,
	})
}

func analyzePackage(ctx *packageContext, directoryIndex map[string][]string) map[string]analysis {
	collectLocalNames(ctx)
	results := map[string]analysis{}
	relPaths := make([]string, 0, len(ctx.FileNodes))
	for relPath := range ctx.FileNodes {
		relPaths = append(relPaths, relPath)
	}
	sort.Strings(relPaths)

	for _, relPath := range relPaths {
		fileNode := ctx.FileNodes[relPath]
		fileAnalysis := analysis{}
		importAliases := map[string]string{}
		seenRefs := map[string]bool{}

		for _, decl := range fileNode.Decls {
			switch typed := decl.(type) {
			case *ast.FuncDecl:
				obj := ctx.Info.Defs[typed.Name]
				if ast.IsExported(typed.Name.Name) {
					signature := typed.Name.Name
					if obj != nil {
						signature = typeString(obj.Type())
					}
					fileAnalysis.Exports = append(fileAnalysis.Exports, map[string]any{
						"name":      typed.Name.Name,
						"kind":      "function",
						"signature": signature,
						"file":      relPath,
						"line":      lineFor(ctx.Fset, typed),
					})
				}
			case *ast.GenDecl:
				for _, spec := range typed.Specs {
					switch declared := spec.(type) {
					case *ast.TypeSpec:
						if !ast.IsExported(declared.Name.Name) {
							continue
						}
						obj := ctx.Info.Defs[declared.Name]
						kind := "type"
						fields := []map[string]any{}
						signature := declared.Name.Name
						if obj != nil {
							kind, fields, signature = objectKindAndFields(obj)
						}
						fileAnalysis.Exports = append(fileAnalysis.Exports, map[string]any{
							"name":      declared.Name.Name,
							"kind":      kind,
							"signature": signature,
							"file":      relPath,
							"line":      lineFor(ctx.Fset, declared),
						})
						fileAnalysis.Types = append(fileAnalysis.Types, map[string]any{
							"name":   declared.Name.Name,
							"fields": fields,
							"source": map[string]any{
								"repo": filepath.Base(ctx.RepoPath),
								"file": relPath,
								"line": lineFor(ctx.Fset, declared),
							},
						})
					case *ast.ValueSpec:
						for _, name := range declared.Names {
							if !ast.IsExported(name.Name) {
								continue
							}
							signature := name.Name
							if obj := ctx.Info.Defs[name]; obj != nil {
								signature = typeString(obj.Type())
							}
							fileAnalysis.Exports = append(fileAnalysis.Exports, map[string]any{
								"name":      name.Name,
								"kind":      "constant",
								"signature": signature,
								"file":      relPath,
								"line":      lineFor(ctx.Fset, name),
							})
						}
					}
				}
			}
		}

		for _, importSpec := range fileNode.Imports {
			importPath, err := strconv.Unquote(importSpec.Path.Value)
			if err != nil {
				importPath = importSpec.Path.Value
			}
			targetFile := resolveImport(relPath, importPath, directoryIndex)
			if targetFile == "" || targetFile == relPath {
				continue
			}
			importedName := filepath.Base(importPath)
			if importSpec.Name != nil && importSpec.Name.Name != "_" && importSpec.Name.Name != "." {
				importedName = importSpec.Name.Name
			}
			importAliases[importedName] = targetFile
			fileAnalysis.Imports = append(fileAnalysis.Imports, map[string]any{
				"from":    relPath,
				"to":      targetFile,
				"imports": []string{importedName},
			})
			fileAnalysis.SymbolReferences = append(fileAnalysis.SymbolReferences, map[string]any{
				"name":     importedName,
				"kind":     "import",
				"fromFile": relPath,
				"toFile":   targetFile,
				"line":     lineFor(ctx.Fset, importSpec),
			})
		}

		ast.Inspect(fileNode, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.CallExpr:
				if selector, ok := typed.Fun.(*ast.SelectorExpr); ok {
					if len(typed.Args) >= 2 && typed.Args[0] != nil && typed.Args[1] != nil {
						if pathLiteral, ok := typed.Args[0].(*ast.BasicLit); ok && pathLiteral.Kind == token.STRING {
							if ident, ok := typed.Args[1].(*ast.Ident); ok {
								trimmed, err := strconv.Unquote(pathLiteral.Value)
								if err != nil {
									trimmed = pathLiteral.Value
								}
								upper := strings.ToUpper(selector.Sel.Name)
								if upper == "GET" || upper == "POST" || upper == "PUT" || upper == "PATCH" || upper == "DELETE" || upper == "OPTIONS" || upper == "HEAD" {
									addRouteCall(&fileAnalysis, upper, trimmed, ident.Name, relPath, lineFor(ctx.Fset, typed))
								}
							}
						}
					}

					if selector.Sel.Name == "Methods" && len(typed.Args) > 0 {
						if methodLiteral, ok := typed.Args[0].(*ast.BasicLit); ok && methodLiteral.Kind == token.STRING {
							if parentCall, ok := selector.X.(*ast.CallExpr); ok {
								if parentSelector, ok := parentCall.Fun.(*ast.SelectorExpr); ok && parentSelector.Sel.Name == "HandleFunc" && len(parentCall.Args) >= 2 {
									if pathLiteral, ok := parentCall.Args[0].(*ast.BasicLit); ok && pathLiteral.Kind == token.STRING {
										if ident, ok := parentCall.Args[1].(*ast.Ident); ok {
											method, err := strconv.Unquote(methodLiteral.Value)
											if err != nil {
												method = methodLiteral.Value
											}
											trimmedPath, err := strconv.Unquote(pathLiteral.Value)
											if err != nil {
												trimmedPath = pathLiteral.Value
											}
											addRouteCall(&fileAnalysis, method, trimmedPath, ident.Name, relPath, lineFor(ctx.Fset, typed))
										}
									}
								}
							}
						}
					}

					if owner, ok := selector.X.(*ast.Ident); ok {
						targetFile := importAliases[owner.Name]
						if targetFile == "" {
							if selection := ctx.Info.Selections[selector]; selection != nil {
								targetFile = findObjectFile(ctx.RepoPath, ctx.Fset, selection.Obj())
							}
						}
						if targetFile != "" {
							key := selector.Sel.Name + ":" + targetFile + ":" + strconv.Itoa(lineFor(ctx.Fset, typed))
							if !seenRefs[key] {
								seenRefs[key] = true
								fileAnalysis.SymbolReferences = append(fileAnalysis.SymbolReferences, map[string]any{
									"name":     selector.Sel.Name,
									"kind":     "call",
									"fromFile": relPath,
									"toFile":   targetFile,
									"line":     lineFor(ctx.Fset, typed),
								})
							}
						}
					}
				}

				if ident, ok := typed.Fun.(*ast.Ident); ok {
					targetFile := ctx.LocalNames[ident.Name]
					if targetFile == "" {
						if obj := ctx.Info.Uses[ident]; obj != nil {
							targetFile = findObjectFile(ctx.RepoPath, ctx.Fset, obj)
						}
					}
					if targetFile != "" {
						key := ident.Name + ":" + targetFile + ":" + strconv.Itoa(lineFor(ctx.Fset, typed))
						if !seenRefs[key] {
							seenRefs[key] = true
							fileAnalysis.SymbolReferences = append(fileAnalysis.SymbolReferences, map[string]any{
								"name":     ident.Name,
								"kind":     "call",
								"fromFile": relPath,
								"toFile":   targetFile,
								"line":     lineFor(ctx.Fset, typed),
							})
						}
					}
				}
			}
			return true
		})

		results[relPath] = fileAnalysis
	}

	return results
}

func main() {
	var raw map[string]any
	if err := json.Unmarshal([]byte(os.Args[1]), &raw); err != nil {
		panic(err)
	}
	var input payload
	if repoPath, ok := raw["repoPath"].(string); ok {
		input.RepoPath = repoPath
	}
	if files, ok := raw["files"].([]any); ok {
		for _, file := range files {
			if filePath, ok := file.(string); ok {
				input.Files = append(input.Files, filePath)
			}
		}
	}

	directoryIndex := map[string][]string{}
	for _, filePath := range input.Files {
		relPath := relativePath(input.RepoPath, filePath)
		dir := filepath.ToSlash(filepath.Dir(relPath))
		directoryIndex[dir] = append(directoryIndex[dir], relPath)
	}
	for _, files := range directoryIndex {
		sort.Strings(files)
	}

	modulePath := readModulePath(input.RepoPath)
	contexts := buildPackageContexts(input.RepoPath, modulePath, input.Files)
	contextIndex := map[string]*packageContext{}
	for _, ctx := range contexts {
		contextIndex[ctx.ImportPath] = ctx
	}
	pkgImporter := &localImporter{
		contexts:        contextIndex,
		defaultImporter: importer.Default(),
		loading:         map[string]bool{},
	}
	result := map[string]analysis{}
	for _, ctx := range contexts {
		typeCheckPackage(ctx, pkgImporter)
		for relPath, fileAnalysis := range analyzePackage(ctx, directoryIndex) {
			result[relPath] = fileAnalysis
		}
	}

	encoded, err := json.Marshal(map[string]any{"adapter": "go-typechecker", "files": result})
	if err != nil {
		panic(err)
	}
	_, _ = os.Stdout.Write(encoded)
}
`;

const JAVA_HELPER = String.raw`
import java.nio.charset.StandardCharsets;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.lang.model.element.Modifier;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.Trees;

public class OmniLinkJavaHelper {
  private static final Set<String> JAVA_SYSTEM_TYPES = Set.of(
    "Boolean", "Byte", "Character", "Collection", "Double", "Float", "Integer", "Iterable",
    "List", "Long", "Map", "Object", "Optional", "Set", "Short", "String", "UUID", "Void"
  );

  private static final Pattern TYPE_NAME_PATTERN = Pattern.compile("\\b([A-Z][A-Za-z0-9_]*)\\b");
  private static final Pattern VERB_MAPPING_PATTERN = Pattern.compile("@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\\((?:[^)]*?(?:value|path)\\s*=\\s*)?\"([^\"]+)\"");
  private static final Pattern REQUEST_PATH_PATTERN = Pattern.compile("@RequestMapping\\((?:[^)]*?(?:value|path)\\s*=\\s*)?\"([^\"]+)\"");
  private static final Pattern REQUEST_METHOD_PATTERN = Pattern.compile("RequestMethod\\.([A-Z]+)");

  private static final class Analysis {
    final List<Map<String, Object>> exports = new ArrayList<>();
    final List<Map<String, Object>> routes = new ArrayList<>();
    final List<Map<String, Object>> procedures = new ArrayList<>();
    final List<Map<String, Object>> types = new ArrayList<>();
    final List<Map<String, Object>> schemas = new ArrayList<>();
    final List<Map<String, Object>> imports = new ArrayList<>();
    final List<Map<String, Object>> symbolReferences = new ArrayList<>();

    Map<String, Object> toJson() {
      Map<String, Object> json = new LinkedHashMap<>();
      json.put("exports", exports);
      json.put("routes", routes);
      json.put("procedures", procedures);
      json.put("types", types);
      json.put("schemas", schemas);
      json.put("imports", imports);
      json.put("symbolReferences", symbolReferences);
      return json;
    }
  }

  private static Analysis ensure(Map<String, Analysis> analyses, String relPath) {
    return analyses.computeIfAbsent(relPath, ignored -> new Analysis());
  }

  private static String relativePath(String repoPath, JavaFileObject fileObject) {
    return Paths.get(repoPath)
      .relativize(Paths.get(fileObject.toUri()))
      .toString()
      .replace('\\', '/');
  }

  private static int line(CompilationUnitTree unit, Tree tree, SourcePositions positions) {
    long start = positions.getStartPosition(unit, tree);
    if (start < 0) {
      return 1;
    }
    return (int) unit.getLineMap().getLineNumber(start);
  }

  private static String joinPath(String basePath, String routePath) {
    String normalizedBase = "/".equals(basePath) ? "" : basePath.replaceAll("/+$", "");
    String normalizedRoute = routePath.startsWith("/") ? routePath : "/" + routePath;
    return normalizedBase.isEmpty() ? normalizedRoute : normalizedBase + normalizedRoute;
  }

  private static String annotationPath(String annotationText) {
    Matcher direct = VERB_MAPPING_PATTERN.matcher(annotationText);
    if (direct.find()) {
      return direct.group(2);
    }
    Matcher request = REQUEST_PATH_PATTERN.matcher(annotationText);
    if (request.find()) {
      return request.group(1);
    }
    return null;
  }

  private static String[] annotationRoute(String annotationText) {
    Matcher direct = VERB_MAPPING_PATTERN.matcher(annotationText);
    if (direct.find()) {
      return new String[] {
        direct.group(1).replace("Mapping", "").toUpperCase(),
        direct.group(2),
      };
    }
    Matcher request = REQUEST_METHOD_PATTERN.matcher(annotationText);
    String method = request.find() ? request.group(1) : null;
    String routePath = annotationPath(annotationText);
    if (method != null && routePath != null) {
      return new String[] { method, routePath };
    }
    return null;
  }

  private static void addDependency(
    String relPath,
    String targetFile,
    String symbolName,
    int line,
    Analysis analysis,
    Map<String, Set<String>> dependencyNames,
    Set<String> seenReferences,
    String kind
  ) {
    if (targetFile == null || targetFile.isEmpty() || targetFile.equals(relPath)) {
      return;
    }
    dependencyNames.computeIfAbsent(targetFile, ignored -> new LinkedHashSet<>()).add(symbolName);
    String refKey = kind + ":" + targetFile + ":" + symbolName + ":" + line;
    if (seenReferences.add(refKey)) {
      Map<String, Object> symbolReference = new LinkedHashMap<>();
      symbolReference.put("name", symbolName);
      symbolReference.put("kind", kind);
      symbolReference.put("fromFile", relPath);
      symbolReference.put("toFile", targetFile);
      symbolReference.put("line", line);
      analysis.symbolReferences.add(symbolReference);
    }
  }

  private static void addTypeReferences(
    String typeText,
    String relPath,
    int line,
    Analysis analysis,
    Map<String, String> typeIndex,
    Map<String, Set<String>> dependencyNames,
    Set<String> seenReferences
  ) {
    Matcher matcher = TYPE_NAME_PATTERN.matcher(typeText == null ? "" : typeText);
    while (matcher.find()) {
      String typeName = matcher.group(1);
      if (JAVA_SYSTEM_TYPES.contains(typeName)) {
        continue;
      }
      addDependency(
        relPath,
        typeIndex.get(typeName),
        typeName,
        line,
        analysis,
        dependencyNames,
        seenReferences,
        "type"
      );
    }
  }

  private static String kindFor(ClassTree tree) {
    return switch (tree.getKind()) {
      case INTERFACE -> "interface";
      case ENUM -> "enum";
      default -> "class";
    };
  }

  private static String signatureFor(ClassTree tree) {
    return kindFor(tree) + " " + tree.getSimpleName();
  }

  private static String simpleName(String qualifiedName) {
    int index = qualifiedName.lastIndexOf('.');
    return index >= 0 ? qualifiedName.substring(index + 1) : qualifiedName;
  }

  private static String json(Object value) {
    if (value == null) {
      return "null";
    }
    if (value instanceof String stringValue) {
      return "\"" + stringValue
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t") + "\"";
    }
    if (value instanceof Number || value instanceof Boolean) {
      return value.toString();
    }
    if (value instanceof Map<?, ?> mapValue) {
      StringBuilder builder = new StringBuilder("{");
      boolean first = true;
      for (Map.Entry<?, ?> entry : mapValue.entrySet()) {
        if (!first) {
          builder.append(',');
        }
        first = false;
        builder.append(json(String.valueOf(entry.getKey()))).append(':').append(json(entry.getValue()));
      }
      return builder.append('}').toString();
    }
    if (value instanceof Iterable<?> iterableValue) {
      StringBuilder builder = new StringBuilder("[");
      boolean first = true;
      for (Object entry : iterableValue) {
        if (!first) {
          builder.append(',');
        }
        first = false;
        builder.append(json(entry));
      }
      return builder.append(']').toString();
    }
    return json(String.valueOf(value));
  }

  public static void main(String[] args) throws Exception {
    String repoPath = args[0];
    List<String> filePaths = Arrays.asList(Arrays.copyOfRange(args, 1, args.length));

    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      throw new IllegalStateException("No Java compiler available");
    }

    StandardJavaFileManager fileManager =
      compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8);
    Iterable<? extends JavaFileObject> compilationUnits = fileManager.getJavaFileObjectsFromStrings(filePaths);
    JavacTask task = (JavacTask) compiler.getTask(
      null,
      fileManager,
      null,
      List.of("-proc:none"),
      null,
      compilationUnits
    );

    List<CompilationUnitTree> units = new ArrayList<>();
    for (CompilationUnitTree unit : task.parse()) {
      units.add(unit);
    }
    task.analyze();

    Trees trees = Trees.instance(task);
    SourcePositions positions = trees.getSourcePositions();
    Map<String, String> typeIndex = new LinkedHashMap<>();

    for (CompilationUnitTree unit : units) {
      String relPath = relativePath(repoPath, unit.getSourceFile());
      String packageName = unit.getPackageName() == null ? "" : unit.getPackageName().toString();
      for (Tree typeDecl : unit.getTypeDecls()) {
        if (!(typeDecl instanceof ClassTree classTree)) {
          continue;
        }
        String simpleName = classTree.getSimpleName().toString();
        String qualifiedName = packageName.isEmpty() ? simpleName : packageName + "." + simpleName;
        typeIndex.putIfAbsent(qualifiedName, relPath);
        typeIndex.putIfAbsent(simpleName, relPath);
      }
    }

    Map<String, Analysis> analyses = new LinkedHashMap<>();

    for (CompilationUnitTree unit : units) {
      String relPath = relativePath(repoPath, unit.getSourceFile());
      Analysis analysis = ensure(analyses, relPath);
      Map<String, Set<String>> dependencyNames = new LinkedHashMap<>();
      Set<String> seenReferences = new LinkedHashSet<>();

      for (ImportTree importTree : unit.getImports()) {
        if (importTree.isStatic()) {
          continue;
        }
        String imported = importTree.getQualifiedIdentifier().toString();
        if (imported.endsWith(".*")) {
          continue;
        }
        String targetFile = typeIndex.get(imported);
        if (targetFile == null) {
          targetFile = typeIndex.get(simpleName(imported));
        }
        if (targetFile == null || targetFile.equals(relPath)) {
          continue;
        }
        String importedName = simpleName(imported);
        Map<String, Object> importEntry = new LinkedHashMap<>();
        importEntry.put("from", relPath);
        importEntry.put("to", targetFile);
        importEntry.put("imports", List.of(importedName));
        analysis.imports.add(importEntry);
        addDependency(
          relPath,
          targetFile,
          importedName,
          line(unit, importTree, positions),
          analysis,
          dependencyNames,
          seenReferences,
          "import"
        );
      }

      for (Tree typeDecl : unit.getTypeDecls()) {
        if (!(typeDecl instanceof ClassTree classTree)) {
          continue;
        }

        int classLine = line(unit, classTree, positions);
        String className = classTree.getSimpleName().toString();
        Map<String, Object> typeEntry = new LinkedHashMap<>();
        List<Map<String, Object>> fields = new ArrayList<>();
        typeEntry.put("name", className);
        typeEntry.put("fields", fields);
        typeEntry.put(
          "source",
          Map.of("repo", Paths.get(repoPath).getFileName().toString(), "file", relPath, "line", classLine)
        );
        analysis.types.add(typeEntry);

        if (classTree.getModifiers().getFlags().contains(Modifier.PUBLIC)) {
          Map<String, Object> exportEntry = new LinkedHashMap<>();
          exportEntry.put("name", className);
          exportEntry.put("kind", kindFor(classTree));
          exportEntry.put("signature", signatureFor(classTree));
          exportEntry.put("file", relPath);
          exportEntry.put("line", classLine);
          analysis.exports.add(exportEntry);
        }

        String basePath = "";
        for (AnnotationTree annotationTree : classTree.getModifiers().getAnnotations()) {
          String candidate = annotationPath(annotationTree.toString());
          if (candidate != null) {
            basePath = candidate;
            break;
          }
        }

        for (Tree member : classTree.getMembers()) {
          if (member instanceof VariableTree variableTree) {
            int fieldLine = line(unit, variableTree, positions);
            String fieldType = variableTree.getType() == null ? "unknown" : variableTree.getType().toString();
            Map<String, Object> field = new LinkedHashMap<>();
            field.put("name", variableTree.getName().toString());
            field.put("type", fieldType);
            field.put("optional", false);
            fields.add(field);
            addTypeReferences(
              fieldType,
              relPath,
              fieldLine,
              analysis,
              typeIndex,
              dependencyNames,
              seenReferences
            );
            continue;
          }

          if (!(member instanceof MethodTree methodTree)) {
            continue;
          }

          int methodLine = line(unit, methodTree, positions);
          String returnType = methodTree.getReturnType() == null ? "" : methodTree.getReturnType().toString();
          addTypeReferences(
            returnType,
            relPath,
            methodLine,
            analysis,
            typeIndex,
            dependencyNames,
            seenReferences
          );
          for (VariableTree parameterTree : methodTree.getParameters()) {
            addTypeReferences(
              parameterTree.getType() == null ? "" : parameterTree.getType().toString(),
              relPath,
              line(unit, parameterTree, positions),
              analysis,
              typeIndex,
              dependencyNames,
              seenReferences
            );
          }

          for (AnnotationTree annotationTree : methodTree.getModifiers().getAnnotations()) {
            String[] route = annotationRoute(annotationTree.toString());
            if (route == null) {
              continue;
            }
            Map<String, Object> routeEntry = new LinkedHashMap<>();
            routeEntry.put("method", route[0]);
            routeEntry.put("path", joinPath(basePath, route[1]));
            routeEntry.put("handler", methodTree.getName().toString());
            routeEntry.put("file", relPath);
            routeEntry.put("line", methodLine);
            analysis.routes.add(routeEntry);
          }
        }
      }

      for (Map.Entry<String, Set<String>> dependencyEntry : dependencyNames.entrySet()) {
        if (dependencyEntry.getKey().equals(relPath) || dependencyEntry.getValue().isEmpty()) {
          continue;
        }
        Map<String, Object> importEntry = new LinkedHashMap<>();
        importEntry.put("from", relPath);
        importEntry.put("to", dependencyEntry.getKey());
        importEntry.put("imports", new ArrayList<>(dependencyEntry.getValue()));
        boolean exists = analysis.imports.stream().anyMatch(existing ->
          dependencyEntry.getKey().equals(existing.get("to"))
        );
        if (!exists) {
          analysis.imports.add(importEntry);
        }
      }
    }

    Map<String, Object> files = new LinkedHashMap<>();
    for (Map.Entry<String, Analysis> entry : analyses.entrySet()) {
      files.put(entry.getKey(), entry.getValue().toJson());
    }

    System.out.println(json(Map.of("adapter", "java-compiler", "files", files)));
  }
}
`;

const SWIFT_SYSTEM_TYPES = new Set([
  'Array',
  'Any',
  'AnyObject',
  'Bool',
  'Character',
  'Data',
  'Date',
  'Dictionary',
  'Double',
  'Float',
  'Int',
  'Int8',
  'Int16',
  'Int32',
  'Int64',
  'Never',
  'Optional',
  'Result',
  'Set',
  'String',
  'UInt',
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'URL',
  'Void',
]);

function ensureRawFileAnalysis(
  files: Record<string, RawSemanticFileAnalysis>,
  relPath: string,
): RawSemanticFileAnalysis {
  if (!files[relPath]) {
    files[relPath] = {
      exports: [],
      routes: [],
      procedures: [],
      types: [],
      schemas: [],
      imports: [],
      symbolReferences: [],
    };
  }
  return files[relPath];
}

function swiftRelativePath(repoPath: string, absolutePath: string): string {
  return path.relative(repoPath, absolutePath).replace(/\\/g, '/');
}

function swiftLineInfo(
  rawLine: string,
  repoPath: string,
): {
  relPath: string;
  line: number;
} | null {
  const match = rawLine.match(/range=\[([^:\]]+\.swift):(\d+):\d+\s*-/);
  if (!match) {
    return null;
  }
  return {
    relPath: swiftRelativePath(repoPath, match[1]),
    line: Number(match[2]),
  };
}

function swiftTypeNames(typeText: string): string[] {
  return [...typeText.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)]
    .map((match) => match[1])
    .filter((name) => !SWIFT_SYSTEM_TYPES.has(name));
}

function parseSwiftAst(repo: RepoConfig, astOutput: string): RawSemanticResult {
  const files: Record<string, RawSemanticFileAnalysis> = {};
  const symbolToFile = new Map<string, string>();
  const pendingTypeReferences = new Map<string, Array<{ name: string; line: number }>>();
  const typeStack: Array<{ indent: number; relPath: string; typeEntry: TypeDef }> = [];

  const lines = astOutput.split('\n');
  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    while (typeStack.length > 0 && indent <= typeStack[typeStack.length - 1]!.indent) {
      typeStack.pop();
    }

    const lineInfo = swiftLineInfo(rawLine, repo.path);
    const typeMatch = rawLine.match(
      /^\s*\((struct_decl|class_decl|protocol_decl)\b.*"([^"]+)"\s+interface_type="([^"]+)"/,
    );
    if (typeMatch && lineInfo) {
      const relPath = lineInfo.relPath;
      const fileAnalysis = ensureRawFileAnalysis(files, relPath);
      const exportKind = typeMatch[1] === 'protocol_decl' ? 'interface' : 'class';
      const typeEntry: TypeDef = {
        name: typeMatch[2],
        fields: [],
        source: {
          repo: repo.name,
          file: relPath,
          line: lineInfo.line,
        },
      };
      fileAnalysis.exports?.push({
        name: typeMatch[2],
        kind: exportKind,
        signature: typeMatch[3],
        file: relPath,
        line: lineInfo.line,
      });
      fileAnalysis.types?.push(typeEntry);
      if (!symbolToFile.has(typeMatch[2])) {
        symbolToFile.set(typeMatch[2], relPath);
      }
      typeStack.push({ indent, relPath, typeEntry });
      continue;
    }

    const functionMatch = rawLine.match(/^\s*\(func_decl\b.*"([^"]+)"\s+interface_type="([^"]+)"/);
    if (functionMatch && lineInfo) {
      const relPath = lineInfo.relPath;
      const fileAnalysis = ensureRawFileAnalysis(files, relPath);
      const functionName = functionMatch[1].replace(/\(.*/, '');
      const currentType = typeStack[typeStack.length - 1];
      const isMethod = Boolean(
        currentType && currentType.relPath === relPath && indent > currentType.indent,
      );
      const refs = pendingTypeReferences.get(relPath) ?? [];
      for (const name of swiftTypeNames(functionMatch[2])) {
        refs.push({ name, line: lineInfo.line });
      }
      pendingTypeReferences.set(relPath, refs);
      if (!isMethod && functionName !== 'init' && functionName !== 'deinit') {
        fileAnalysis.exports?.push({
          name: functionName,
          kind: 'function',
          signature: functionMatch[2],
          file: relPath,
          line: lineInfo.line,
        });
      }
      continue;
    }

    const propertyMatch = rawLine.match(/^\s*\(var_decl\b.*"([^"]+)"\s+interface_type="([^"]+)"/);
    if (propertyMatch && lineInfo && typeStack.length > 0) {
      const currentType = typeStack[typeStack.length - 1]!;
      if (currentType.relPath !== lineInfo.relPath || indent <= currentType.indent) {
        continue;
      }
      currentType.typeEntry.fields.push({
        name: propertyMatch[1],
        type: propertyMatch[2],
        optional: propertyMatch[2].includes('?'),
      });
      const refs = pendingTypeReferences.get(lineInfo.relPath) ?? [];
      for (const name of swiftTypeNames(propertyMatch[2])) {
        refs.push({ name, line: lineInfo.line });
      }
      pendingTypeReferences.set(lineInfo.relPath, refs);
    }
  }

  for (const [relPath, refs] of pendingTypeReferences.entries()) {
    const fileAnalysis = ensureRawFileAnalysis(files, relPath);
    const dependencyNames = new Map<string, Set<string>>();
    for (const ref of refs) {
      const targetFile = symbolToFile.get(ref.name);
      if (!targetFile || targetFile === relPath) {
        continue;
      }
      const targetNames = dependencyNames.get(targetFile) ?? new Set<string>();
      targetNames.add(ref.name);
      dependencyNames.set(targetFile, targetNames);
      fileAnalysis.symbolReferences?.push({
        name: ref.name,
        kind: 'type',
        fromFile: relPath,
        toFile: targetFile,
        line: ref.line,
      });
    }
    for (const [targetFile, names] of dependencyNames.entries()) {
      fileAnalysis.imports?.push({
        from: relPath,
        to: targetFile,
        imports: [...names].sort(),
      });
    }
  }

  return {
    adapter: 'swift-typechecker',
    files,
  };
}

async function runPythonHelper(
  repo: RepoConfig,
  filePaths: string[],
): Promise<RepoSemanticAnalysis | null> {
  try {
    const { stdout } = await execFileAsync(
      'python3',
      ['-c', PYTHON_HELPER, repo.path, JSON.stringify(filePaths)],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const parsed = JSON.parse(stdout) as RawSemanticResult;
    return normalizeResult(parsed);
  } catch {
    return null;
  }
}

async function runGoHelper(
  repo: RepoConfig,
  filePaths: string[],
): Promise<RepoSemanticAnalysis | null> {
  const helperPath = path.join(os.tmpdir(), `omni-link-go-helper-${process.pid}.go`);
  try {
    await fs.writeFile(helperPath, GO_HELPER, 'utf8');
    const { stdout } = await execFileAsync(
      'go',
      ['run', helperPath, JSON.stringify({ repoPath: repo.path, files: filePaths })],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const parsed = JSON.parse(stdout) as RawSemanticResult;
    return normalizeResult(parsed);
  } catch {
    return null;
  } finally {
    await fs.rm(helperPath, { force: true }).catch(() => undefined);
  }
}

function javaCommandCandidates(): string[] {
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : null,
    '/opt/homebrew/opt/openjdk@21/bin/java',
    'java',
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidates)];
}

async function runJavaHelper(
  repo: RepoConfig,
  filePaths: string[],
): Promise<RepoSemanticAnalysis | null> {
  const helperPath = path.join(os.tmpdir(), `omni-link-java-helper-${process.pid}.java`);
  try {
    await fs.writeFile(helperPath, JAVA_HELPER, 'utf8');
    for (const javaCommand of javaCommandCandidates()) {
      try {
        const { stdout } = await execFileAsync(
          javaCommand,
          ['--add-modules', 'jdk.compiler', helperPath, repo.path, ...filePaths],
          {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
          },
        );
        const parsed = JSON.parse(stdout) as RawSemanticResult;
        return normalizeResult(parsed);
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await fs.rm(helperPath, { force: true }).catch(() => undefined);
  }
}

async function runSwiftHelper(
  repo: RepoConfig,
  filePaths: string[],
): Promise<RepoSemanticAnalysis | null> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'swiftc',
      ['-typecheck', '-dump-ast', ...filePaths],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return normalizeResult(parseSwiftAst(repo, stderr || stdout));
  } catch {
    return null;
  }
}

class ToolchainSemanticAnalyzer implements RepoAnalyzer {
  readonly id = 'toolchain';

  supports(config: RepoConfig): boolean {
    return SUPPORTED_LANGUAGES.has(config.language);
  }

  async analyzeRepo(config: RepoConfig, filePaths: string[]): Promise<RepoSemanticAnalysis | null> {
    if (!this.supports(config) || filePaths.length === 0) {
      return null;
    }

    if (config.language === 'python') {
      return runPythonHelper(config, filePaths);
    }
    if (config.language === 'go') {
      return runGoHelper(config, filePaths);
    }
    if (config.language === 'java') {
      return runJavaHelper(config, filePaths);
    }
    if (config.language === 'swift') {
      return runSwiftHelper(config, filePaths);
    }
    return null;
  }
}

export const toolchainSemanticAnalyzer = new ToolchainSemanticAnalyzer();
