/**
 * @file
 *
 * Lints the project with whichever linter the project configures: ESLint or Biome.
 */

import { hasBiomeConfig } from '../formatters/biome.ts';
import { lint as lintWithBiome } from './biome.ts';
import {
  hasEslintConfig,
  lint as lintWithEslint
} from './eslint.ts';

/**
 * A linter the toolkit runs.
 */
export type Linter = 'biome' | 'eslint';

const LINTERS: Readonly<Record<Linter, (options: LintOptions) => Promise<void>>> = {
  biome: lintWithBiome,
  eslint: lintWithEslint
};

/**
 * Parameters for the {@link lint} function.
 */
export interface LintOptions {
  /**
   * The configuration file used when the project has none of its own, as the chosen linter's own `lint` takes it.
   */
  readonly defaultConfigFilePath?: string | undefined;

  /**
   * The linter to run. Omitted, {@link detectLinter} chooses it.
   */
  readonly linter?: Linter | undefined;

  /**
   * Optional file paths to lint. If omitted, lints the entire project.
   */
  readonly paths?: string[] | undefined;

  /**
   * Whether to fix linting issues automatically.
   *
   * @default `false`
   */
  readonly shouldFix?: boolean | undefined;
}

/**
 * Chooses the linter from the configuration files at the project root.
 *
 * An `eslint.config.*` file wins, so a project that formats with Biome and lints with ESLint gets ESLint. Otherwise a
 * `biome.json` / `biome.jsonc` picks Biome, and a project with neither gets ESLint, as before Biome was supported.
 *
 * @returns The linter to run.
 */
export function detectLinter(): Linter {
  if (hasEslintConfig()) {
    return 'eslint';
  }

  return hasBiomeConfig() ? 'biome' : 'eslint';
}

/**
 * Lints the project with its linter.
 *
 * @param options - The {@link LintOptions}.
 * @returns A {@link Promise} that resolves when the project lints clean.
 */
export async function lint(options?: LintOptions): Promise<void> {
  const { linter = detectLinter(), ...lintOptions } = options ?? {};
  await LINTERS[linter](lintOptions);
}
