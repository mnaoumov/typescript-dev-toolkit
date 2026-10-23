/**
 * @file
 *
 * The shared Stryker configuration for an on-demand mutation run ({@link defineStrykerConfig}), and the test list the
 * mutation run's vitest configuration reads ({@link getStrykerTestInclude}).
 *
 * The module imports nothing but `node:process` and holds no TypeScript syntax Node cannot strip, so a repository
 * that cannot install this package (this one) loads it straight from its `stryker.config.mjs`.
 */

import process from 'node:process';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_IN_MILLISECONDS = 10_000;

/**
 * The environment variable `testMutation` hands the scoped run's test files in, comma-separated.
 */
export const STRYKER_TEST_FILES_ENV_VARIABLE = 'STRYKER_TEST_FILES';

/**
 * The vitest configuration file the mutation run reads, beside the project's own `vitest.config.*`.
 */
export const STRYKER_VITEST_CONFIG_FILE_NAME = 'vitest.stryker.config.ts';

/**
 * The files mutated by a run that names none: every source file but the tests, the declarations, the generated
 * barrels and the test helpers.
 */
export const DEFAULT_STRYKER_MUTATE: readonly string[] = [
  'src/**/*.ts',
  '!src/**/*.test.ts',
  '!src/**/*.d.ts',
  '!src/**/index.ts',
  '!src/__merged.ts',
  '!src/test-helpers/**',
  '!src/**/@types/**'
];

/**
 * The folders Stryker never reads. A documentation site's `docs/` alone held 18,000 files in the pilot: copying it
 * took 5 minutes, and then the main process died of a 4 GB heap OOM.
 */
export const DEFAULT_STRYKER_IGNORE_PATTERNS: readonly string[] = [
  '/.astro',
  '/.claude',
  '/.codex',
  '/coverage',
  '/dist',
  '/docs',
  '/reports'
];

/**
 * A Stryker configuration object, as a `stryker.config.mjs` exports it.
 *
 * Kept loose rather than typed by `@stryker-mutator/api`, so a consumer that never runs Stryker never needs its
 * types.
 */
export type StrykerConfig = Record<string, unknown>;

/**
 * Defines the Stryker configuration of an on-demand mutation run.
 *
 * The defaults encode what the pilot measured:
 *
 * - `inPlace: true`, because Stryker's sandbox copy breaks module resolution through a symlinked `node_modules`. In
 *   place, Stryker mutates the tree itself and puts back the WHOLE tree as it was when the run started, so the run
 *   needs a committed tree and nobody may edit it while the run is going.
 * - `vitest.related: false`, because `vitest.related` found no tests at all; the scoped run names its test files
 *   through {@link getStrykerTestInclude} instead.
 * - `ignorePatterns`, see {@link DEFAULT_STRYKER_IGNORE_PATTERNS}.
 *
 * @param overrides - Keys that replace the defaults. The merge is shallow: an override of `vitest` replaces the
 *   whole `vitest` object.
 * @returns The configuration to export from `stryker.config.mjs`.
 */
export function defineStrykerConfig(overrides: StrykerConfig = {}): StrykerConfig {
  return {
    checkers: [],
    concurrency: DEFAULT_CONCURRENCY,
    coverageAnalysis: 'perTest',
    htmlReporter: { fileName: 'reports/mutation/mutation.html' },
    ignorePatterns: [...DEFAULT_STRYKER_IGNORE_PATTERNS],
    inPlace: true,
    jsonReporter: { fileName: 'reports/mutation/mutation.json' },
    mutate: [...DEFAULT_STRYKER_MUTATE],
    reporters: ['clear-text', 'progress-append-only', 'json', 'html'],
    // eslint-disable-next-line unicorn/name-replacements -- `tempDirName` is a Stryker option.
    tempDirName: '.stryker-tmp',
    testRunner: 'vitest',
    timeoutMS: DEFAULT_TIMEOUT_IN_MILLISECONDS,
    vitest: {
      configFile: STRYKER_VITEST_CONFIG_FILE_NAME,
      related: false
    },
    ...overrides
  };
}

/**
 * Picks the test files of the mutation run's vitest configuration: the ones `testMutation` named for a scoped run, or
 * the given defaults for a full one.
 *
 * @param defaultInclude - The `include` globs of a full run.
 * @returns The `include` list.
 */
export function getStrykerTestInclude(defaultInclude: readonly string[]): string[] {
  const testFiles = process.env[STRYKER_TEST_FILES_ENV_VARIABLE];
  return testFiles ? testFiles.split(',') : [...defaultInclude];
}
