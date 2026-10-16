/**
 * @file
 *
 * Format the source code with Prettier.
 */

import {
  existsSync,
  readFileSync
} from 'node:fs';

import { readPackageJson } from '../npm.ts';
import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import {
  execFromRoot,
  resolvePathFromRootSafe
} from '../root.ts';
import {
  getSharedConfigFilePath,
  SharedConfigFile
} from '../shared-config-files.ts';

/**
 * Every file Prettier reads its configuration from, besides the `prettier` key of `package.json`.
 *
 * @see {@link https://prettier.io/docs/configuration}
 */
export const PRETTIER_CONFIG_FILE_NAMES: readonly string[] = [
  '.prettierrc',
  '.prettierrc.cjs',
  '.prettierrc.cts',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.mjs',
  '.prettierrc.mts',
  '.prettierrc.toml',
  '.prettierrc.ts',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  'prettier.config.cjs',
  'prettier.config.cts',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.mts',
  'prettier.config.ts'
];

/**
 * The files Prettier leaves alone, as the shared `dprint.json` does: Markdown belongs to markdownlint, and a lockfile
 * belongs to its package manager. They are passed as negated patterns, which Prettier applies to the paths it is given
 * as well as to the ones it finds.
 */
const EXCLUDED_PATTERNS: readonly string[] = ['!**/*.md', '!**/*-lock.json'];

/**
 * Parameters for the {@link format} function.
 */
export interface FormatOptions {
  /**
   * The Prettier configuration used when the project has none of its own. Omitted, the shared one this package ships
   * (`assets/prettier.json`) is used.
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
 * Format the source code with Prettier.
 *
 * Prettier finds the project's own configuration itself. Only a project with none gets `--config`, pointing at
 * {@link FormatOptions.defaultConfigFilePath} or at the shared configuration. `.gitignore` and `.prettierignore` are
 * honored, as Prettier always does.
 *
 * @param options - The {@link FormatOptions}.
 * @returns A {@link Promise} that resolves when the source code has been formatted.
 */
export async function format(options?: FormatOptions): Promise<void> {
  const { defaultConfigFilePath, paths, rewrite = true } = options ?? {};
  const configArguments = await hasPrettierConfig()
    ? []
    : ['--config', defaultConfigFilePath ?? getSharedConfigFilePath(SharedConfigFile.Prettier)];
  const hasPaths = paths !== undefined && paths.length > 0;

  await execFromRoot([
    ...resolveToolCommand({ tool: 'prettier' }),
    rewrite ? '--write' : '--check',
    '--ignore-unknown',
    ...hasPaths ? ['--no-error-on-unmatched-pattern'] : [],
    ...configArguments,
    ...EXCLUDED_PATTERNS,
    { batchedArguments: hasPaths ? paths : [RepoPaths.CurrentFolder] }
  ]);
}

/**
 * Reads the shared Prettier configuration this package ships, for a project's own `prettier.config.mjs` to export or
 * build on.
 *
 * @returns The shared configuration.
 */
export function getPrettierConfig(): Readonly<Record<string, unknown>> {
  return JSON.parse(readFileSync(getSharedConfigFilePath(SharedConfigFile.Prettier), 'utf-8')) as Record<string, unknown>;
}

/**
 * Says whether the project configures Prettier itself.
 *
 * @returns Whether a Prettier configuration file, or a `prettier` key in `package.json`, exists at the project root.
 */
export async function hasPrettierConfig(): Promise<boolean> {
  if (PRETTIER_CONFIG_FILE_NAMES.some((fileName) => existsSync(resolvePathFromRootSafe({ path: fileName })))) {
    return true;
  }

  if (!existsSync(resolvePathFromRootSafe({ path: RepoPaths.PackageJson }))) {
    return false;
  }

  const packageJson = await readPackageJson();
  return Object.hasOwn(packageJson, 'prettier');
}
