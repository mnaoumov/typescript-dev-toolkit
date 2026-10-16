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
 */

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
}

/**
 * Checks that every bare import in the published output names a package a consumer installs.
 *
 * @param options - The options controlling which folders are scanned.
 * @returns A {@link Promise} that resolves when every import is declared.
 * @throws If any import names a package that is not in `dependencies`, `optionalDependencies` or `peerDependencies`,
 * the package itself, or a Node builtin. The error lists each offending file and specifier.
 */
export async function validateDependencies(options: ValidateDependenciesOptions = {}): Promise<void> {
  const root = process.cwd();
  const packageJson = await readPackageJson(root);
  const installedPackageNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {})
  ]);
  if (packageJson.name) {
    installedPackageNames.add(packageJson.name);
  }

  const undeclaredImports: string[] = [];
  for (const folder of options.folders ?? DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS) {
    for (const filePath of await getFilePaths(join(root, folder))) {
      const isDeclarationFile = DECLARATION_FILE_PATTERN.test(filePath);
      for (const specifier of getImportSpecifiers(await readFile(filePath, 'utf-8'))) {
        const packageName = getPackageName(specifier);
        if (packageName === null || installedPackageNames.has(packageName)) {
          continue;
        }
        if (isDeclarationFile && installedPackageNames.has(getTypesPackageName(packageName))) {
          continue;
        }
        undeclaredImports.push(`${relative(root, filePath).replaceAll('\\', '/')}: ${specifier}`);
      }
    }
  }

  if (undeclaredImports.length > 0) {
    throw new Error(
      `The published output imports packages that are not in dependencies, optionalDependencies or peerDependencies:\n${undeclaredImports.join('\n')}`
    );
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
 * Collects the module specifiers a source file imports, requires or references, ignoring strings and comments.
 *
 * @param sourceText - The source text.
 * @returns The module specifiers.
 */
function getImportSpecifiers(sourceText: string): string[] {
  const { importedFiles } = preProcessFile(sourceText, true, true);
  return importedFiles.map((importedFile) => importedFile.fileName);
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
