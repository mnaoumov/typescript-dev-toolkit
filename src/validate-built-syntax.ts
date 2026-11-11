/**
 * @file
 *
 * Fails the build when an emitted JavaScript module of the published output does not parse.
 *
 * Every `.cjs`, `.js` and `.mjs` file in the scanned folders (`dist/lib` and `bin` by default) is parsed with `acorn`
 * the way Node would load it, so a module the build wrote with a syntax error fails the build instead of shipping.
 * Nothing after `esbuild` otherwise reads the text a build plugin rewrote: `obsidian-dev-toolkit` 9.1.0 shipped a rule
 * module whose string literal the extension rewrite had ended early, and every consumer's lint aborted on load.
 */

import type { Options } from 'acorn';

import { parse } from 'acorn';
import { existsSync } from 'node:fs';
import {
  readdir,
  readFile
} from 'node:fs/promises';
import {
  extname,
  join,
  relative
} from 'node:path';
import process from 'node:process';

import { readPackageJson } from './npm.ts';
import { RepoPaths } from './repo-paths.ts';

/**
 * The folders {@link validateBuiltSyntax} scans when none are given.
 */
export const DEFAULT_VALIDATE_BUILT_SYNTAX_FOLDERS: readonly string[] = [RepoPaths.DistLib, 'bin'];

const MODULE_EXTENSIONS: ReadonlySet<string> = new Set(['.cjs', '.js', '.mjs']);

/**
 * Options for {@link findSyntaxProblem}.
 */
export interface FindSyntaxProblemOptions {
  /**
   * Whether a `.js` file is an ES module, as it is in a package whose `package.json` says `"type": "module"`.
   *
   * @default false
   */
  readonly isJsEsm?: boolean;
}

/**
 * Options for {@link validateBuiltSyntax}.
 */
export interface ValidateBuiltSyntaxOptions {
  /**
   * The folders to scan, relative to the current working folder. A folder that does not exist is skipped.
   *
   * @default {@link DEFAULT_VALIDATE_BUILT_SYNTAX_FOLDERS}
   */
  readonly folders?: readonly string[];
}

/**
 * Parses one module's text the way Node would load it.
 *
 * @param path - The module's path; its extension picks the source type.
 * @param text - The module's text.
 * @param options - How a `.js` file is loaded.
 * @returns The parser's message, with its line and column, or `null` when the text parses.
 */
export function findSyntaxProblem(path: string, text: string, options: FindSyntaxProblemOptions = {}): null | string {
  const extension = extname(path);
  const isEsm = extension === '.mjs' || (extension === '.js' && !!options.isJsEsm);
  const parseOptions: Options = {
    allowHashBang: true,
    allowReturnOutsideFunction: !isEsm,
    ecmaVersion: 'latest',
    sourceType: isEsm ? 'module' : 'script'
  };

  try {
    parse(text, parseOptions);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Checks that every emitted JavaScript module in the published output parses.
 *
 * @param options - The options controlling which folders are scanned.
 * @returns A {@link Promise} that resolves when every module parses.
 * @throws If any module does not parse. The error lists each offending file with the parser's message.
 */
export async function validateBuiltSyntax(options: ValidateBuiltSyntaxOptions = {}): Promise<void> {
  const root = process.cwd();
  const packageJson = await readPackageJson(root);
  const isJsEsm = packageJson.type === 'module';

  let checkedCount = 0;
  const problems: string[] = [];
  for (const folder of options.folders ?? DEFAULT_VALIDATE_BUILT_SYNTAX_FOLDERS) {
    for (const filePath of await getModulePaths(join(root, folder))) {
      checkedCount++;
      const problem = findSyntaxProblem(filePath, await readFile(filePath, 'utf-8'), { isJsEsm });
      if (problem !== null) {
        problems.push(`${relative(root, filePath).replaceAll('\\', '/')}: ${problem}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${String(problems.length)} of ${String(checkedCount)} emitted module(s) do not parse:\n${problems.join('\n')}`
    );
  }
}

/**
 * Lists the JavaScript modules under a folder, recursively.
 *
 * @param folder - The absolute folder path.
 * @returns The absolute paths of the modules, or none when the folder does not exist.
 */
async function getModulePaths(folder: string): Promise<string[]> {
  if (!existsSync(folder)) {
    return [];
  }

  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && MODULE_EXTENSIONS.has(extname(entry.name)))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}
