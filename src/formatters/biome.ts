/**
 * @file
 *
 * Format the source code with Biome.
 */

import { getLibDebugger } from '@mnaoumov/typescript-lib/debug';
import {
  basename,
  relative,
  toPosixPath
} from '@mnaoumov/typescript-lib/path';
import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { existsSync } from 'node:fs';
import {
  cp,
  writeFile
} from 'node:fs/promises';

import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import {
  execFromRoot,
  getRootFolder,
  resolvePathFromRootSafe
} from '../root.ts';
import {
  getSharedConfigFilePath,
  SharedConfigFile
} from '../shared-config-files.ts';

/**
 * The files Biome reads its configuration from.
 */
export const BIOME_CONFIG_FILE_NAMES: readonly string[] = [RepoPaths.BiomeJson, RepoPaths.BiomeJsonc];

/**
 * The flags that make Biome skip, rather than fail on, a path it is handed but does not handle: a pre-commit hook
 * hands every tool explicit file lists, which can name a file Biome does not know or a file the project ignores.
 */
export const BIOME_EXPLICIT_PATHS_ARGUMENTS: readonly string[] = ['--files-ignore-unknown=true', '--no-errors-on-unmatched'];

/**
 * Parameters for the {@link ensureBiomeConfig} function.
 */
export interface EnsureBiomeConfigOptions {
  /**
   * The configuration file copied to the project root when the project has none.
   */
  readonly defaultConfigFilePath?: string | undefined;
}

/**
 * Parameters for the {@link format} function.
 */
export interface FormatOptions {
  /**
   * The configuration file copied to the project root when the project has none. Omitted, a `biome.json` extending
   * the shared one this package ships (`assets/biome.json`) is written instead.
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
 * Makes sure the project has a Biome configuration of its own.
 *
 * Biome resolves a configuration's VCS root and globs against the configuration file's own folder, so a shared
 * configuration cannot be passed with `--config-path` from inside `node_modules`: it looks for `.gitignore` there.
 * The project's own `biome.json` extends it instead. When there is none, the default one is copied in, or a
 * `biome.json` extending the shared configuration is written.
 *
 * @param options - The {@link EnsureBiomeConfigOptions}.
 * @returns A {@link Promise} that resolves when the project has a Biome configuration.
 */
export async function ensureBiomeConfig(options?: EnsureBiomeConfigOptions): Promise<void> {
  if (hasBiomeConfig()) {
    return;
  }

  const debug = getLibDebugger('Biome:ensureBiomeConfig');
  const defaultConfigFilePath = options?.defaultConfigFilePath;
  if (defaultConfigFilePath) {
    debug('Biome configuration file not found. Copying the default config...');
    await cp(defaultConfigFilePath, resolvePathFromRootSafe({ path: basename(defaultConfigFilePath) }));
    return;
  }

  debug('Biome configuration file not found. Writing one that extends the shared config...');
  const rootFolder = getRootFolder();
  assertNonNullable(rootFolder, 'Root folder not found');
  const sharedConfigPath = toPosixPath(relative(rootFolder, getSharedConfigFilePath(SharedConfigFile.Biome)));
  const extendsPath = JSON.stringify(sharedConfigPath.startsWith('.') ? sharedConfigPath : `./${sharedConfigPath}`);
  // Written the way `biome format` prints it, so the first format leaves the file alone.
  await writeFile(resolvePathFromRootSafe({ path: RepoPaths.BiomeJson }), `{\n  "extends": [${extendsPath}]\n}\n`);
}

/**
 * Format the source code with Biome.
 *
 * @param options - The {@link FormatOptions}.
 * @returns A {@link Promise} that resolves when the source code has been formatted.
 */
export async function format(options?: FormatOptions): Promise<void> {
  const { defaultConfigFilePath, paths, rewrite = true } = options ?? {};
  await ensureBiomeConfig({ defaultConfigFilePath });
  const hasPaths = paths !== undefined && paths.length > 0;

  await execFromRoot([
    ...resolveToolCommand({ tool: 'biome' }),
    'format',
    ...rewrite ? ['--write'] : [],
    ...hasPaths ? BIOME_EXPLICIT_PATHS_ARGUMENTS : [],
    { batchedArguments: hasPaths ? paths : [RepoPaths.CurrentFolder] }
  ]);
}

/**
 * Says whether the project configures Biome itself.
 *
 * @returns Whether a `biome.json` or `biome.jsonc` exists at the project root.
 */
export function hasBiomeConfig(): boolean {
  return BIOME_CONFIG_FILE_NAMES.some((fileName) => existsSync(resolvePathFromRootSafe({ path: fileName })));
}
