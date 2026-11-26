/**
 * @file
 *
 * Source discovery + extraction: walks `src`, filters to documentable entry files, and turns each
 * file's exported declarations into `TypeInfo` entries keyed by a qualified `${namespace}#${name}`.
 */

import type { SourceFile } from 'ts-morph';
import type { Statement } from 'typescript';

import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  dirname,
  join,
  relative,
  resolve
} from 'node:path';
import { Node } from 'ts-morph';
import {
  canHaveModifiers,
  createSourceFile,
  getModifiers,
  isClassDeclaration,
  isEnumDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceExport,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  ScriptTarget,
  SyntaxKind
} from 'typescript';

import type { TypeInfo } from './api-doc-types.ts';

import { GENERIC_TYPE_PARAMS } from './api-doc-constants.ts';
import {
  isDocumentedDirectoryName,
  isDocumentedFileName
} from './api-doc-documented-files.ts';
import {
  extractClassInfo,
  extractEnumInfo,
  extractInterfaceInfo,
  extractTypeAliasInfo,
  getDescription,
  getExamples,
  getParameterDescriptions,
  getRemarks,
  getReturnDescription,
  getSince
} from './api-doc-jsdoc.ts';
import { registerPackageDeclaration } from './api-doc-package-sites.ts';
import { getApiDocSettings } from './api-doc-settings.ts';
import { simplifyType } from './api-doc-text-utils.ts';

/**
 * A package's public API barrel, read by {@link readPublicApiBarrel}.
 */
export interface PublicApiBarrel {
  /**
   * The modules the barrel re-exports from, directly or through other barrels, in the order they are reached: the
   * entry files of the API reference.
   */
  readonly files: readonly string[];

  /**
   * The qualified ids (`<namespace>#<name>`) of the exports the barrel forwards by name.
   */
  readonly publicKeys: ReadonlySet<string>;

  /**
   * The namespaces of the modules the barrel re-exports whole (`export * from`).
   */
  readonly wholeNamespaces: ReadonlySet<string>;
}

interface BarrelModule {
  // The names the module declares and exports itself.
  readonly localExports: ReadonlySet<string>;
  readonly reExports: readonly BarrelReExport[];
}

interface BarrelNamedImport {
  readonly importedName: string;
  readonly moduleSpecifier: string;
}

interface BarrelReExport {
  // The names re-exported, or `null` for `export * from`.
  readonly names: null | readonly string[];
  readonly targetPath: string;
}

/**
 * Collect top-level exported functions.
 *
 * @param src - The source file.
 * @param types - The documented types, keyed by qualified id.
 * @param namespace - The type's namespace.
 */
export function collectFunctions(src: SourceFile, types: Map<string, TypeInfo>, namespace: string): void {
  for (const $function of src.getFunctions()) {
    if (!$function.isExported()) {
      continue;
    }
    const name = $function.getName();
    if (!name) {
      continue;
    }
    const key = qualifiedKey(namespace, name);
    if (types.has(key)) {
      continue;
    }
    const parameterDescriptions = getParameterDescriptions($function);
    const params = $function.getParameters().map((p) => ({
      description: parameterDescriptions.get(p.getName()) ?? '',
      name: p.getName(),
      type: simplifyType(p.getType().getText())
    }));
    const parameterString = params.map((p) => `${p.name}: ${p.type}`).join(', ');
    const returnType = simplifyType($function.getReturnType().getText());
    const signature = `${name}(${parameterString})`;
    types.set(key, {
      baseTypes: [],
      description: getDescription($function),
      enumMembers: [],
      examples: getExamples($function),
      implementsTypes: [],
      kind: 'function',
      methods: [{
        description: getDescription($function),
        examples: getExamples($function),
        inheritedFrom: '',
        isStatic: false,
        name,
        overloadKey: name,
        parameters: params,
        remarks: getRemarks($function),
        returnDescription: getReturnDescription($function),
        returnType,
        signature,
        since: getSince($function),
        type: ''
      }],
      name,
      namespace,
      properties: [],
      remarks: getRemarks($function),
      typeParameters: $function.getTypeParameters().map((tp) => tp.getText())
    });
  }
}

/**
 * Records where every symbol a source file imports is declared, so a type another documented package declares
 * links to that package's site.
 *
 * @param src - The source file.
 */
export function collectPackageDeclarations(src: SourceFile): void {
  for (const importDeclaration of src.getImportDeclarations()) {
    for (const namedImport of importDeclaration.getNamedImports()) {
      // An unresolved import aliases the checker's unknown symbol, which has no declarations.
      // A renamed import carries its symbol on the local name.
      const localNameNode = namedImport.getAliasNode() ?? namedImport.getNameNode();
      const declarations = localNameNode.getSymbolOrThrow().getAliasedSymbolOrThrow().getDeclarations();
      for (const declaration of declarations) {
        // Only a type is linked from type text; a function's name also matches words that are not references to it.
        if (isTypeDeclaration(declaration)) {
          registerPackageDeclaration(namedImport.getName(), declaration.getSourceFile().getFilePath());
        }
      }
    }
  }
}

/**
 * Collect top-level exported variable declarations (e.g. `export const EMPTY = ''`).
 *
 * @param src - The source file.
 * @param types - The documented types, keyed by qualified id.
 * @param namespace - The type's namespace.
 */
export function collectVariables(src: SourceFile, types: Map<string, TypeInfo>, namespace: string): void {
  for (const variableStatement of src.getVariableStatements()) {
    if (!variableStatement.isExported()) {
      continue;
    }
    const declarationKind = variableStatement.getDeclarationKind();
    for (const declaration of variableStatement.getDeclarations()) {
      const name = declaration.getName();
      const key = qualifiedKey(namespace, name);
      if (types.has(key)) {
        continue;
      }
      types.set(key, {
        baseTypes: [],
        description: getDescription(variableStatement),
        enumMembers: [],
        examples: getExamples(variableStatement),
        implementsTypes: [],
        kind: 'variable',
        methods: [],
        name,
        namespace,
        properties: [],
        remarks: getRemarks(variableStatement),
        typeParameters: [],
        variableKeyword: declarationKind,
        variableType: simplifyType(declaration.getType().getText())
      });
    }
  }
}

/**
 * Compute a hash of every input that decides the generated pages: the generator's own modules, the settings and
 * the entry source files. An unchanged hash lets a run skip the generation.
 *
 * @param entryFiles - The entry source files.
 * @param generatorDirectory - The folder holding the generator's modules.
 * @returns The hash, as hex.
 */
export function computeCacheHash(entryFiles: string[], generatorDirectory: string): string {
  const hash = createHash('sha256');

  // The generator itself
  const generatorFiles = readdirSync(generatorDirectory).filter((name) => !name.endsWith('.test.ts')).sort();
  for (const generatorFile of generatorFiles) {
    hash.update(generatorFile);
    hash.update(readFileSync(join(generatorDirectory, generatorFile), 'utf-8'));
  }

  // The settings, which every link and path depends on. A hook is hashed by its source, which `JSON.stringify` drops.
  const settings = getApiDocSettings();
  hash.update(JSON.stringify({
    ...settings,
    externalTypeLinks: [...settings.externalTypeLinks],
    importStatement: settings.importStatement && String(settings.importStatement),
    memberRouteSegment: settings.memberRouteSegment && String(settings.memberRouteSegment),
    packageSites: [...settings.packageSites]
  }));

  // Hash all entry source files
  for (const filePath of [...entryFiles].sort()) {
    hash.update(filePath);
    hash.update(readFileSync(filePath, 'utf-8'));
  }

  return hash.digest('hex');
}

/**
 * Compute the namespace (POSIX path relative to `src`, no extension) for a source file.
 *
 * @param srcDirectory - The source folder the namespace is relative to.
 * @param filePath - The file's path.
 * @returns The namespace.
 */
export function computeNamespace(srcDirectory: string, filePath: string): string {
  return relative(srcDirectory, filePath).replaceAll('\\', '/').replace(/\.ts$/, '');
}

/**
 * Recursively find all documentable `*.ts` entry files under `src`.
 *
 * Excludes: `*.test.ts` (incl. `*.browser.test.ts` / `*.integration.test.ts`), `*.d.ts`,
 * `index.ts`, `__merged.ts`, `setup.ts`, `*-setup.ts`, and any subtree under a `@types`,
 * `styles`, or `test-helpers` directory, or one of `excludedDirectories`.
 *
 * @param directory - The folder to search.
 * @param excludedDirectories - Directory names excluded in addition to the defaults.
 * @returns The entry files' paths.
 */
export function findEntryFiles(directory: string, excludedDirectories: readonly string[] = []): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isDocumentedDirectoryName(entry.name, excludedDirectories)) {
        continue;
      }
      results.push(...findEntryFiles(fullPath, excludedDirectories));
    } else if (isDocumentedFileName(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Drops every documented type the public API barrel does not re-export. Run it after `resolveInheritedMembers`, so
 * a public class still inherits the members of an internal base class.
 *
 * @param types - The documented types, keyed by qualified id.
 * @param barrel - The barrel, read by {@link readPublicApiBarrel}.
 */
export function keepPublicApi(types: Map<string, TypeInfo>, barrel: PublicApiBarrel): void {
  for (const [key, info] of types) {
    if (!barrel.wholeNamespaces.has(info.namespace) && !barrel.publicKeys.has(key)) {
      types.delete(key);
    }
  }
}

/**
 * Collects a source file's exported type aliases, enums, interfaces and classes.
 *
 * @param src - The source file.
 * @param types - The documented types, keyed by qualified id.
 * @param namespace - The type's namespace.
 */
export function processSourceFile(src: SourceFile, types: Map<string, TypeInfo>, namespace: string): void {
  for (const alias of src.getTypeAliases()) {
    if (!alias.isExported()) {
      continue;
    }
    const key = qualifiedKey(namespace, alias.getName());
    if (!types.has(key)) {
      types.set(key, extractTypeAliasInfo(alias, namespace));
    }
  }

  for (const enumDeclaration of src.getEnums()) {
    if (!enumDeclaration.isExported()) {
      continue;
    }
    const key = qualifiedKey(namespace, enumDeclaration.getName());
    if (!types.has(key)) {
      types.set(key, extractEnumInfo(enumDeclaration, namespace));
    }
  }

  for (const iface of src.getInterfaces()) {
    if (!iface.isExported()) {
      continue;
    }
    const key = qualifiedKey(namespace, iface.getName());
    if (!types.has(key)) {
      types.set(key, extractInterfaceInfo(iface, namespace));
    }
  }

  for (const cls of src.getClasses()) {
    if (!cls.isExported()) {
      continue;
    }
    const name = cls.getName();
    if (!name) {
      continue;
    }
    const key = qualifiedKey(namespace, name);
    if (!types.has(key)) {
      types.set(key, extractClassInfo(cls, namespace));
    }
  }
}

/**
 * Reads a package's public API barrel: the modules it re-exports from and the names it forwards.
 *
 * Re-exports are followed down to the module that declares each name, through `export * from`,
 * `export { a } from` and `import { a } from` + `export { a }`, so a barrel of barrels documents its whole API.
 * A local declaration shadows a name an `export *` would bring in, as in TypeScript.
 *
 * It is parsed on its own rather than through the ts-morph project, because the cache check needs the entry files
 * before that project exists, and a cache hit must not pay for loading it.
 *
 * @param entryFile - The barrel, e.g. `<root>/src/index.ts`.
 * @param sourceDirectory - The folder namespaces are relative to.
 * @returns The barrel.
 * @throws If the barrel re-exports a module that does not exist or belongs to another package, renames an export,
 * or re-exports a module as a namespace: none of these can be documented under the name a consumer imports.
 */
export function readPublicApiBarrel(entryFile: string, sourceDirectory: string): PublicApiBarrel {
  const files = new Set<string>();
  const publicKeys = new Set<string>();
  const wholeNamespaces = new Set<string>();
  const modules = new Map<string, BarrelModule>();
  const visitedWhole = new Set<string>();
  const visitedNames = new Set<string>();

  function readModule(filePath: string): BarrelModule {
    let barrelModule = modules.get(filePath);
    if (barrelModule === undefined) {
      barrelModule = parseBarrelModule(filePath);
      modules.set(filePath, barrelModule);
    }
    return barrelModule;
  }

  // Everything a module exports: its own declarations, and every module it re-exports, followed down.
  function visitWhole(filePath: string): void {
    if (visitedWhole.has(filePath)) {
      return;
    }
    visitedWhole.add(filePath);
    files.add(filePath);
    wholeNamespaces.add(computeNamespace(sourceDirectory, filePath));
    for (const reExport of readModule(filePath).reExports) {
      if (reExport.names === null) {
        visitWhole(reExport.targetPath);
      } else {
        for (const name of reExport.names) {
          visitName(reExport.targetPath, name);
        }
      }
    }
  }

  // One name a module exports, followed to the module that declares it.
  function visitName(filePath: string, name: string): void {
    const visitKey = qualifiedKey(filePath, name);
    if (visitedNames.has(visitKey)) {
      return;
    }
    visitedNames.add(visitKey);
    files.add(filePath);
    const barrelModule = readModule(filePath);
    const namedReExport = barrelModule.reExports.find((reExport) => reExport.names?.includes(name));
    if (namedReExport !== undefined) {
      visitName(namedReExport.targetPath, name);
      return;
    }
    if (barrelModule.localExports.has(name)) {
      publicKeys.add(qualifiedKey(computeNamespace(sourceDirectory, filePath), name));
      return;
    }
    // A local declaration shadows an `export *`, so the stars are searched only when the module declares no such name.
    for (const reExport of barrelModule.reExports) {
      if (reExport.names === null) {
        visitName(reExport.targetPath, name);
      }
    }
  }

  // The barrel itself is not documented: only what it forwards is.
  for (const reExport of parseBarrelModule(entryFile).reExports) {
    if (reExport.names === null) {
      visitWhole(reExport.targetPath);
    } else {
      for (const name of reExport.names) {
        visitName(reExport.targetPath, name);
      }
    }
  }

  return { files: [...files], publicKeys, wholeNamespaces };
}

/**
 * Register all type parameter names so renderTypeWithLinks won't hyperlink them.
 * Skip names that are also known types — those should still be linkable. The site's `genericTypeParameters`
 * are registered as given.
 *
 * @param types - The documented types, keyed by qualified id.
 */
export function registerGenericTypeParams(types: Map<string, TypeInfo>): void {
  for (const name of getApiDocSettings().genericTypeParameters ?? []) {
    GENERIC_TYPE_PARAMS.add(name);
  }
  const knownNames = new Set<string>();
  for (const [, info] of types) {
    knownNames.add(info.name);
  }
  for (const [, info] of types) {
    for (const tp of info.typeParameters) {
      const bareParameter = tp.replace(/\s+extends\s+.*$/, '');
      if (!knownNames.has(bareParameter)) {
        GENERIC_TYPE_PARAMS.add(bareParameter);
      }
    }
  }
}

// The names a module imports by name (`import { a as b } from`), keyed by their local name.
function collectNamedImports(statements: readonly Statement[]): Map<string, BarrelNamedImport> {
  const namedImports = new Map<string, BarrelNamedImport>();
  for (const statement of statements) {
    if (
      isImportDeclaration(statement) && isStringLiteral(statement.moduleSpecifier) && statement.importClause?.namedBindings !== undefined
      && isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        namedImports.set(element.name.text, {
          importedName: (element.propertyName ?? element.name).text,
          moduleSpecifier: statement.moduleSpecifier.text
        });
      }
    }
  }
  return namedImports;
}

function getDeclaredExportNames(statement: Statement): readonly string[] {
  const modifiers = canHaveModifiers(statement) ? getModifiers(statement) ?? [] : [];
  if (modifiers.every((modifier) => modifier.kind !== SyntaxKind.ExportKeyword) || modifiers.some((modifier) => modifier.kind === SyntaxKind.DefaultKeyword)) {
    return [];
  }
  if (isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => (isIdentifier(declaration.name) ? [declaration.name.text] : []));
  }
  if (
    (isFunctionDeclaration(statement) || isClassDeclaration(statement) || isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)
      || isEnumDeclaration(statement) || isModuleDeclaration(statement))
    && statement.name !== undefined && isIdentifier(statement.name)
  ) {
    return [statement.name.text];
  }
  return [];
}

function isTypeDeclaration(declaration: Node): boolean {
  return Node.isClassDeclaration(declaration) || Node.isInterfaceDeclaration(declaration) || Node.isTypeAliasDeclaration(declaration) || Node.isEnumDeclaration(declaration);
}

/**
 * Parses one module of the public API barrel's re-export graph: the names it declares itself and the modules it
 * re-exports.
 *
 * @param filePath - The module.
 * @returns The module.
 * @throws If it re-exports a module that does not exist or belongs to another package, renames a re-export, or
 * re-exports a module as a namespace.
 */
function parseBarrelModule(filePath: string): BarrelModule {
  const sourceFile = createSourceFile(filePath, readFileSync(filePath, 'utf-8'), ScriptTarget.Latest);
  const localExports = new Set<string>();
  const reExports: BarrelReExport[] = [];
  const namedImports = collectNamedImports(sourceFile.statements);

  function resolveTarget(moduleSpecifier: string): string {
    if (!moduleSpecifier.startsWith('.')) {
      throw new Error(`${filePath} re-exports '${moduleSpecifier}', which is not a module of this package.`);
    }
    const targetPath = resolve(dirname(filePath), moduleSpecifier);
    if (!existsSync(targetPath)) {
      throw new Error(`${filePath} re-exports '${moduleSpecifier}', which does not exist.`);
    }
    return targetPath;
  }

  function assertNotRenamed(propertyName: string, name: string): void {
    if (propertyName !== name) {
      throw new Error(`${filePath} renames '${propertyName}' to '${name}', which the API reference cannot document.`);
    }
  }

  for (const statement of sourceFile.statements) {
    for (const name of getDeclaredExportNames(statement)) {
      localExports.add(name);
    }
    if (!isExportDeclaration(statement)) {
      continue;
    }
    const { exportClause, moduleSpecifier } = statement;

    if (moduleSpecifier === undefined) {
      // `export { a };`: a name this module declares, or one it imports, which is then a re-export.
      /* v8 ignore start -- Without a module specifier the grammar allows only named exports; the parser gives even `export *;` one. */
      if (exportClause === undefined || !isNamedExports(exportClause)) {
        continue;
      }
      /* v8 ignore stop */
      for (const element of exportClause.elements) {
        const localName = (element.propertyName ?? element.name).text;
        const namedImport = namedImports.get(localName);
        if (!namedImport?.moduleSpecifier.startsWith('.')) {
          localExports.add(element.name.text);
          continue;
        }
        assertNotRenamed(namedImport.importedName, element.name.text);
        reExports.push({ names: [element.name.text], targetPath: resolveTarget(namedImport.moduleSpecifier) });
      }
      continue;
    }

    // A specifier that is not a string literal is a syntax error (`export { a } from x;`) the parser recovered from.
    if (!isStringLiteral(moduleSpecifier)) {
      continue;
    }
    const targetPath = resolveTarget(moduleSpecifier.text);
    if (exportClause === undefined) {
      reExports.push({ names: null, targetPath });
      continue;
    }
    if (isNamespaceExport(exportClause)) {
      throw new Error(`${filePath} re-exports '${moduleSpecifier.text}' as a namespace, which the API reference cannot document.`);
    }
    reExports.push({
      names: exportClause.elements.map((element) => {
        assertNotRenamed((element.propertyName ?? element.name).text, element.name.text);
        return element.name.text;
      }),
      targetPath
    });
  }

  return { localExports, reExports };
}

function qualifiedKey(namespace: string, name: string): string {
  return `${namespace}#${name}`;
}
