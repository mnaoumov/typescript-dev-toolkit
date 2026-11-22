/**
 * @file
 *
 * Fails the build when the published output imports a package that `package.json` does not install for a consumer.
 *
 * Every bare specifier in the scanned folders (`dist/lib` and `bin` by default, code and declarations, ESM and
 * CommonJS) must name a package in `dependencies`, `optionalDependencies` or `peerDependencies`, the package itself,
 * or a builtin (any `node:` specifier, Node's own, and Electron's `electron` and `original-fs`); a declaration
 * file's import may also be served by the package's `@types` one. A package in
 * `devDependencies` only is present in the package's own repository and absent from a
 * consumer's install, so nothing there fails, and the consumer gets `Cannot find module`.
 *
 * It also checks the reverse direction: a package in `dependencies`, `optionalDependencies` or `peerDependencies` that
 * no scanned file imports (or, from a declaration file, references through its `@types` package or a
 * `/// <reference types>` directive) is reported, because every consumer installs it for nothing. A package the
 * output reaches without a static import (resolved by path, run as a command, loaded through a variable specifier)
 * is listed in {@link ValidateDependenciesOptions.unimportedDependencies} with its reason, and an entry that is
 * imported after all fails too, so the list cannot go stale. The idea follows `knip`'s unused-dependency check; no code
 * is adapted from it.
 */

import type { PackageJson } from 'type-fest';

import { existsSync } from 'node:fs';
import {
  readdir,
  readFile
} from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import {
  join,
  relative
} from 'node:path';
import process from 'node:process';
import { preProcessFile } from 'typescript';

import { readPackageJson } from './npm.ts';
import { RepoPaths } from './repo-paths.ts';

/**
 * The folders {@link validateDependencies} scans when none are given.
 */
export const DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS: readonly string[] = [RepoPaths.DistLib, 'bin'];

/**
 * The modules Electron provides to its own processes, which no package installs: Node's `isBuiltin` does not know them.
 * `electron` also covers its `electron/main`, `electron/renderer` and `electron/common` subpaths.
 */
const ELECTRON_BUILTIN_PACKAGE_NAMES: ReadonlySet<string> = new Set(['electron', 'original-fs']);
const NODE_SCHEME = 'node:';
const DECLARATION_FILE_PATTERN = /\.d\.(?:cts|mts|ts)$/u;
const SCANNED_FILE_PATTERN = /\.(?:cjs|cts|js|mjs|mts|ts)$/u;
const TYPES_SCOPE = '@types/';
const NODE_TYPES_PACKAGE_NAME = `${TYPES_SCOPE}node`;
const SCOPED_PACKAGE_NAME_SEGMENT_COUNT = 2;

/**
 * Options for {@link validateDependencies}.
 */
export interface ValidateDependenciesOptions {
  /**
   * The folders to scan, relative to the current working folder. A folder that does not exist is skipped.
   *
   * @default {@link DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS}
   */
  readonly folders?: readonly string[];

  /**
   * Declared packages the published output reaches without a static import, each mapped to the reason it is still
   * needed: a package resolved by path at runtime, run as a command, or loaded through a variable specifier. Every
   * entry must name a package in `dependencies`, `optionalDependencies` or `peerDependencies`, carry a non-empty reason,
   * and stay unimported, or the check fails.
   *
   * @default {}
   */
  readonly unimportedDependencies?: Readonly<Record<string, string>>;
}

/**
 * What one source file references.
 */
interface SourceReferences {
  /**
   * The module specifiers it imports, requires or references.
   */
  readonly specifiers: readonly string[];

  /**
   * The names its `/// <reference types>` directives give.
   */
  readonly typeReferences: readonly string[];
}

/**
 * Parameters for {@link getUnimportedDependencySections}.
 */
interface UnimportedDependencySectionsParams {
  /**
   * The packages the scanned files import or reference.
   */
  readonly importedPackageNames: ReadonlySet<string>;

  /**
   * The package's parsed `package.json`.
   */
  readonly packageJson: PackageJson;

  /**
   * The {@link ValidateDependenciesOptions.unimportedDependencies} entries.
   */
  readonly unimportedDependencies: Readonly<Record<string, string>>;
}

/**
 * Parameters for {@link getUnimportedEntryProblem}.
 */
interface UnimportedEntryProblemParams extends UnimportedDependencySectionsParams {
  /**
   * The entry's package name.
   */
  readonly packageName: string;

  /**
   * The entry's reason.
   */
  readonly reason: string;
}

/**
 * The `package.json` fields whose packages a consumer installs, in the order their findings are reported.
 */
const INSTALLED_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/**
 * Checks that every bare import in the published output names a package a consumer installs, and that every package
 * a consumer installs is imported by the published output.
 *
 * @param options - The options controlling which folders are scanned and which packages may stay unimported.
 * @returns A {@link Promise} that resolves when every import is declared and every declared package is imported.
 * @throws If any import names a package that is not in `dependencies`, `optionalDependencies` or `peerDependencies`,
 * the package itself, or a Node builtin; if a package in one of those fields is imported by no scanned file and not
 * listed in {@link ValidateDependenciesOptions.unimportedDependencies}; or if an entry of that list is imported, is not
 * declared, or has no reason. The reverse check is skipped when no scanned file exists, since there is no output to
 * judge. The error lists every finding.
 */
export async function validateDependencies(options: ValidateDependenciesOptions = {}): Promise<void> {
  const root = process.cwd();
  const packageJson = await readPackageJson(root);
  const installedPackageNames = new Set(
    INSTALLED_DEPENDENCY_FIELDS.flatMap((field) => Object.keys(packageJson[field] ?? {}))
  );
  if (packageJson.name) {
    installedPackageNames.add(packageJson.name);
  }

  const undeclaredImports: string[] = [];
  const importedPackageNames = new Set<string>();
  let scannedFileCount = 0;
  for (const folder of options.folders ?? DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS) {
    for (const filePath of await getFilePaths(join(root, folder))) {
      scannedFileCount++;
      const isDeclarationFile = DECLARATION_FILE_PATTERN.test(filePath);
      const { specifiers, typeReferences } = getReferences(await readFile(filePath, 'utf-8'));
      if (isDeclarationFile) {
        for (const typeReference of typeReferences) {
          markImported(importedPackageNames, getTypeReferencePackageName(typeReference), true);
        }
      }
      for (const specifier of specifiers) {
        if (isDeclarationFile && isBuiltin(specifier)) {
          importedPackageNames.add(NODE_TYPES_PACKAGE_NAME);
        }
        const packageName = getPackageName(specifier);
        if (packageName === null) {
          continue;
        }
        markImported(importedPackageNames, packageName, isDeclarationFile);
        if (installedPackageNames.has(packageName)) {
          continue;
        }
        if (isDeclarationFile && installedPackageNames.has(getTypesPackageName(packageName))) {
          continue;
        }
        undeclaredImports.push(`${relative(root, filePath).replaceAll('\\', '/')}: ${specifier}`);
      }
    }
  }

  const sections: string[] = [];
  if (undeclaredImports.length > 0) {
    sections.push(
      `The published output imports packages that are not in dependencies, optionalDependencies or peerDependencies:\n${undeclaredImports.join('\n')}`
    );
  }

  if (scannedFileCount > 0) {
    sections.push(...getUnimportedDependencySections({
      importedPackageNames,
      packageJson,
      unimportedDependencies: options.unimportedDependencies ?? {}
    }));
  }

  if (sections.length > 0) {
    throw new Error(sections.join('\n\n'));
  }
}

/**
 * Lists the scanned files under a folder, recursively.
 *
 * @param folder - The absolute folder path.
 * @returns The absolute paths of the scanned files, or none when the folder does not exist.
 */
async function getFilePaths(folder: string): Promise<string[]> {
  if (!existsSync(folder)) {
    return [];
  }

  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SCANNED_FILE_PATTERN.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Gets the package a bare specifier names.
 *
 * @param specifier - The module specifier.
 * @returns The package name, or `null` for a relative or absolute path, a builtin of Node or Electron, or any
 * `node:`-scheme specifier: no package name can start with `node:`, and Electron's `node:original-fs` is one Node's own
 * list lacks.
 */
function getPackageName(specifier: string): null | string {
  if (
    specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith(NODE_SCHEME) || isBuiltin(specifier)
  ) {
    return null;
  }

  const segments = specifier.split('/');
  const segmentCount = specifier.startsWith('@') ? SCOPED_PACKAGE_NAME_SEGMENT_COUNT : 1;
  const packageName = segments.slice(0, segmentCount).join('/');
  return ELECTRON_BUILTIN_PACKAGE_NAMES.has(packageName) ? null : packageName;
}

/**
 * Collects the module specifiers a source file imports, requires or references, and its `/// <reference types>`
 * directives, ignoring strings and comments.
 *
 * @param sourceText - The source text.
 * @returns The module specifiers and the type reference names.
 */
function getReferences(sourceText: string): SourceReferences {
  const { importedFiles, typeReferenceDirectives } = preProcessFile(sourceText, true, true);
  return {
    specifiers: importedFiles.map((importedFile) => importedFile.fileName),
    typeReferences: typeReferenceDirectives.map((directive) => directive.fileName)
  };
}

/**
 * Gets the package a `/// <reference types>` directive names (`node` → `node`, `pkg/sub` → `pkg`).
 *
 * @param typeReference - The directive's `types` value.
 * @returns The package name.
 */
function getTypeReferencePackageName(typeReference: string): string {
  const segmentCount = typeReference.startsWith('@') ? SCOPED_PACKAGE_NAME_SEGMENT_COUNT : 1;
  return typeReference.split('/').slice(0, segmentCount).join('/');
}

/**
 * Gets the DefinitelyTyped package that declares a package's types, which is what a declaration file's import of
 * that package resolves to when the package ships no types of its own (`estree` → `@types/estree`,
 * `@scope/name` → `@types/scope__name`).
 *
 * @param packageName - The package name.
 * @returns The `@types` package name.
 */
function getTypesPackageName(packageName: string): string {
  return TYPES_SCOPE + packageName.replace(/^@/u, '').replace('/', '__');
}

/**
 * Builds the error sections of the reverse check: declared packages nothing imports, and wrong
 * {@link ValidateDependenciesOptions.unimportedDependencies} entries.
 *
 * @param params - The parameters for the check.
 * @returns The error sections, none when everything is in order.
 */
function getUnimportedDependencySections(params: UnimportedDependencySectionsParams): string[] {
  const { importedPackageNames, packageJson, unimportedDependencies } = params;
  const sections: string[] = [];

  const unusedDependencies = INSTALLED_DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(packageJson[field] ?? {})
      .filter((packageName) =>
        packageName !== packageJson.name && !importedPackageNames.has(packageName)
        && !Object.hasOwn(unimportedDependencies, packageName)
      )
      .map((packageName) => `${field}: ${packageName}`)
  );
  if (unusedDependencies.length > 0) {
    sections.push(
      `The published output imports nothing from these declared packages, so every consumer installs them for nothing. Remove each, or list it in unimportedDependencies with the reason it is still needed:\n${unusedDependencies.join('\n')}`
    );
  }

  const wrongEntries = Object.entries(unimportedDependencies)
    .map(([packageName, reason]) => getUnimportedEntryProblem({ ...params, packageName, reason }))
    .filter((problem) => problem !== null);
  if (wrongEntries.length > 0) {
    sections.push(`These unimportedDependencies entries are wrong:\n${wrongEntries.join('\n')}`);
  }

  return sections;
}

/**
 * Says what is wrong with one {@link ValidateDependenciesOptions.unimportedDependencies} entry.
 *
 * @param params - The parameters for the check, with the entry's package name and reason.
 * @returns The problem line, or `null` when the entry is correct.
 */
function getUnimportedEntryProblem(params: UnimportedEntryProblemParams): null | string {
  const { importedPackageNames, packageJson, packageName, reason } = params;
  if (reason.trim() === '') {
    return `${packageName}: has no reason`;
  }
  if (INSTALLED_DEPENDENCY_FIELDS.every((field) => !Object.hasOwn(packageJson[field] ?? {}, packageName))) {
    return `${packageName}: is not in dependencies, optionalDependencies or peerDependencies`;
  }
  if (importedPackageNames.has(packageName)) {
    return `${packageName}: is imported by the published output, so the entry is stale`;
  }
  return null;
}

/**
 * Records a package as imported by the published output, and, for a declaration file, its `@types` package too.
 *
 * @param importedPackageNames - The set to add to.
 * @param packageName - The package name.
 * @param isDeclarationFile - Whether the reference comes from a declaration file.
 */
function markImported(importedPackageNames: Set<string>, packageName: string, isDeclarationFile: boolean): void {
  importedPackageNames.add(packageName);
  if (isDeclarationFile) {
    importedPackageNames.add(getTypesPackageName(packageName));
  }
}
