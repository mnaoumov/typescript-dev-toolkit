/**
 * @file
 *
 * Source discovery + extraction: walks `src`, filters to documentable entry files, and turns each
 * file's exported declarations into `TypeInfo` entries keyed by a qualified `${namespace}#${name}`.
 */

import type { SourceFile } from 'ts-morph';

import { createHash } from 'node:crypto';
import {
  readdirSync,
  readFileSync
} from 'node:fs';
import {
  join,
  relative
} from 'node:path';
import { Node } from 'ts-morph';

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

function isTypeDeclaration(declaration: Node): boolean {
  return Node.isClassDeclaration(declaration) || Node.isInterfaceDeclaration(declaration) || Node.isTypeAliasDeclaration(declaration) || Node.isEnumDeclaration(declaration);
}

function qualifiedKey(namespace: string, name: string): string {
  return `${namespace}#${name}`;
}
