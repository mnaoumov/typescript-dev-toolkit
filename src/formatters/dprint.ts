/**
 * @file
 *
 * Format the source code.
 */

import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { existsSync } from 'node:fs';

import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import {
  execFromRoot,
  getRootFolder,
  resolvePathFromRootSafe
} from '../root.ts';

/**
 * Parameters for the {@link format} function.
 */
export interface FormatOptions {
  /**
   * The `dprint.json` used when the project has none of its own. Without it, a project with no `dprint.json`
   * fails.
   */
  readonly defaultConfigFilePath?: string | undefined;

  /**
   * Optional file paths to format. If omitted, formats the entire project.
   */
  readonly paths?: string[] | undefined;

  /**
   * Whether to rewrite the source code.
   *
   * @default `true`
   */
  readonly rewrite?: boolean | undefined;
}

/**
 * Format the source code.
 *
 * Explicit {@link FormatOptions.paths} get `--allow-no-files`: a list `dprint.json` excludes entirely (a pre-commit
 * hook staging only a `demo-vault/` file) is nothing to format, not an error, while dprint would exit `14` with
 * `No files found to format`. The whole-project run keeps the check, since finding nothing there is a broken
 * configuration.
 *
 * @param options - The {@link FormatOptions}.
 * @returns A {@link Promise} that resolves when the source code has been formatted.
 */
export async function format(options?: FormatOptions): Promise<void> {
  const { defaultConfigFilePath, paths, rewrite = true } = options ?? {};
  const rootFolder = getRootFolder();
  assertNonNullable(rootFolder, 'Root folder not found');
  let dprintJsonPath = resolvePathFromRootSafe({ path: RepoPaths.DprintJson });
  if (!existsSync(dprintJsonPath) && defaultConfigFilePath) {
    dprintJsonPath = defaultConfigFilePath;
  }

  if (!existsSync(dprintJsonPath)) {
    throw new Error('dprint.json not found');
  }

  const command = rewrite ? 'fmt' : 'check';
  const hasPaths = paths !== undefined && paths.length > 0;
  await execFromRoot([
    ...resolveToolCommand({ tool: 'dprint' }),
    command,
    '--config',
    dprintJsonPath,
    ...hasPaths ? ['--allow-no-files'] : [],
    { batchedArguments: hasPaths ? paths : ['**/*'] }
  ]);
}
