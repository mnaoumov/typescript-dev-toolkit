/**
 * @file
 *
 * Lints the project with Biome.
 */

import {
  BIOME_EXPLICIT_PATHS_ARGUMENTS,
  ensureBiomeConfig
} from '../formatters/biome.ts';
import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import { execFromRoot } from '../root.ts';

/**
 * Parameters for the {@link lint} function.
 */
export interface LintOptions {
  /**
   * The configuration file copied to the project root when the project has none. Omitted, a `biome.json` extending
   * the shared one this package ships (`assets/biome.json`) is written instead.
   */
  readonly defaultConfigFilePath?: string | undefined;

  /**
   * Optional file paths to lint. If omitted, lints the entire project.
   */
  readonly paths?: string[] | undefined;

  /**
   * Whether to apply the safe fixes.
   *
   * @default `false`
   */
  readonly shouldFix?: boolean | undefined;
}

/**
 * Lint the project with Biome.
 *
 * A warning fails the run, as it does for ESLint: Biome exits `0` on warnings unless it is given
 * `--error-on-warnings`.
 *
 * @param options - The {@link LintOptions}.
 * @returns A {@link Promise} that resolves when the project lints clean.
 */
export async function lint(options?: LintOptions): Promise<void> {
  const { defaultConfigFilePath, paths, shouldFix } = options ?? {};
  await ensureBiomeConfig({ defaultConfigFilePath });
  const hasPaths = paths !== undefined && paths.length > 0;

  await execFromRoot([
    ...resolveToolCommand({ tool: 'biome' }),
    'lint',
    '--error-on-warnings',
    ...shouldFix ? ['--write'] : [],
    ...hasPaths ? BIOME_EXPLICIT_PATHS_ARGUMENTS : [],
    { batchedArguments: hasPaths ? paths : [RepoPaths.CurrentFolder] }
  ]);
}
