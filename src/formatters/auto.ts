/**
 * @file
 *
 * Formats the source code with whichever formatter the project configures: dprint, Prettier or Biome.
 */

import { existsSync } from 'node:fs';

import { RepoPaths } from '../repo-paths.ts';
import { resolvePathFromRootSafe } from '../root.ts';
import {
  format as formatWithBiome,
  hasBiomeConfig
} from './biome.ts';
import { format as formatWithDprint } from './dprint.ts';
import {
  format as formatWithPrettier,
  hasPrettierConfig
} from './prettier.ts';

/**
 * A formatter the toolkit runs.
 */
export type Formatter = 'biome' | 'dprint' | 'prettier';

const FORMATTERS: Readonly<Record<Formatter, (options: FormatOptions) => Promise<void>>> = {
  biome: formatWithBiome,
  dprint: formatWithDprint,
  prettier: formatWithPrettier
};

/**
 * Parameters for the {@link format} function.
 */
export interface FormatOptions {
  /**
   * The configuration file used when the project has none of its own, as the chosen formatter's own `format` takes
   * it.
   */
  readonly defaultConfigFilePath?: string | undefined;

  /**
   * The formatter to run. Omitted, {@link detectFormatter} chooses it.
   */
  readonly formatter?: Formatter | undefined;

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
 * Chooses the formatter from the configuration files at the project root.
 *
 * The order is `dprint.json`, then a Prettier configuration, then `biome.json` / `biome.jsonc`, so a project that
 * lints with Biome and lays out with Prettier gets Prettier. A project with none of them gets dprint, as before
 * Prettier and Biome were supported.
 *
 * @returns The formatter to run.
 */
export async function detectFormatter(): Promise<Formatter> {
  if (existsSync(resolvePathFromRootSafe({ path: RepoPaths.DprintJson }))) {
    return 'dprint';
  }

  if (await hasPrettierConfig()) {
    return 'prettier';
  }

  return hasBiomeConfig() ? 'biome' : 'dprint';
}

/**
 * Formats the source code with the project's formatter.
 *
 * @param options - The {@link FormatOptions}.
 * @returns A {@link Promise} that resolves when the source code has been formatted.
 */
export async function format(options?: FormatOptions): Promise<void> {
  const { formatter = await detectFormatter(), ...formatOptions } = options ?? {};
  await FORMATTERS[formatter](formatOptions);
}
