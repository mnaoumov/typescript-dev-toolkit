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
 * Patterns every run excludes on top of the project's `dprint.json` `excludes`.
 *
 * `.claude/settings.local.json` is Claude Code's tool-local settings file, which it writes without a trailing newline.
 * It is usually hidden by the developer's global git ignore only, which dprint does not read, so without this entry
 * `format:check` fails a gate on a file nobody commits.
 */
const DPRINT_ADDITIONAL_EXCLUDES: readonly string[] = ['**/.claude/settings.local.json'];

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
 * Every run also excludes every `.claude/settings.local.json`, passed as `--excludes=<pattern>`, which dprint adds to the
 * configuration's own `excludes`, and which applies to an explicit path too. The `=` form is load-bearing:
 * `--excludes` takes several values, so `--excludes <pattern>` would swallow the file list that follows it.
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
    ...DPRINT_ADDITIONAL_EXCLUDES.map((pattern) => `--excludes=${pattern}`),
    ...hasPaths ? ['--allow-no-files'] : [],
    { batchedArguments: hasPaths ? paths : ['**/*'] }
  ]);
}
