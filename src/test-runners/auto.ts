/**
 * @file
 *
 * Runs the tests with whichever runner the project configures: vitest or jest.
 */

import { existsSync } from 'node:fs';

import { resolvePathFromRootSafe } from '../root.ts';
import {
  hasJestConfig,
  test as jestTest,
  testCoverage as jestTestCoverage,
  testWatch as jestTestWatch
} from './jest.ts';
import {
  test as vitestTest,
  testCoverage as vitestTestCoverage,
  testWatch as vitestTestWatch
} from './vitest.ts';

/**
 * A test runner the toolkit runs.
 */
export type TestRunner = 'jest' | 'vitest';

/**
 * Every file vitest reads its configuration from.
 *
 * `vite.config.*` is deliberately not among them: a project that bundles with vite and tests with jest has one.
 *
 * @see {@link https://vitest.dev/config/}
 */
export const VITEST_CONFIG_FILE_NAMES: readonly string[] = [
  'vitest.config.cjs',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.mts',
  'vitest.config.ts'
];

interface RunnerFunctions {
  readonly test: (options: TestOptions) => Promise<void>;
  readonly testCoverage: (options: TestCoverageOptions) => Promise<void>;
  readonly testWatch: (options: TestWatchOptions) => Promise<void>;
}

const RUNNERS: Readonly<Record<TestRunner, RunnerFunctions>> = {
  jest: {
    test: jestTest,
    testCoverage: jestTestCoverage,
    testWatch: jestTestWatch
  },
  vitest: {
    test: vitestTest,
    testCoverage: vitestTestCoverage,
    testWatch: vitestTestWatch
  }
};

/**
 * Options for running tests with coverage.
 */
export interface TestCoverageOptions extends TestOptions {
  /**
   * Minimum coverage percentage required, for lines, functions, branches and statements alike.
   *
   * @default `0`
   */
  readonly minCoverageInPercents?: number;
}

/**
 * Options for running tests.
 */
export interface TestOptions {
  /**
   * Further CLI arguments for the runner, appended after the wrapper's own: file filters, `-t`, `--maxWorkers`. An
   * argument naming an option the wrapper sets itself (projects, coverage, watch mode) throws.
   */
  readonly additionalArguments?: readonly string[];

  /**
   * Whether jest runs the suite as ES modules. Vitest ignores it.
   *
   * @default `true` when `package.json` declares `"type": "module"`
   */
  readonly esm?: boolean;

  /**
   * The projects to run. Vitest also runs each one's `name:*` sub-projects; jest matches a `displayName` exactly.
   */
  readonly projects?: string[];

  /**
   * The runner to use. Omitted, {@link detectTestRunner} chooses it.
   */
  readonly runner?: TestRunner;
}

/**
 * Options for running tests in watch mode.
 */
export type TestWatchOptions = TestOptions;

/**
 * Chooses the test runner from the configuration files at the project root.
 *
 * The order is a vitest configuration, then a jest one (a file, or a `jest` key in `package.json`). A project with
 * neither gets vitest, the runner every package on this toolchain used before jest was supported.
 *
 * @returns The runner to use.
 */
export async function detectTestRunner(): Promise<TestRunner> {
  if (VITEST_CONFIG_FILE_NAMES.some((fileName) => existsSync(resolvePathFromRootSafe({ path: fileName })))) {
    return 'vitest';
  }

  return await hasJestConfig() ? 'jest' : 'vitest';
}

/**
 * Runs the test suite with the project's runner.
 *
 * @param options - The {@link TestOptions}.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function test(options: TestOptions = {}): Promise<void> {
  const { runner = await detectTestRunner(), ...runnerOptions } = options;
  await RUNNERS[runner].test(runnerOptions);
}

/**
 * Runs the test suite with coverage, with the project's runner.
 *
 * @param options - The {@link TestCoverageOptions}.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function testCoverage(options: TestCoverageOptions = {}): Promise<void> {
  const { runner = await detectTestRunner(), ...runnerOptions } = options;
  await RUNNERS[runner].testCoverage(runnerOptions);
}

/**
 * Runs the test suite in watch mode, with the project's runner.
 *
 * @param options - The {@link TestWatchOptions}.
 * @returns A {@link Promise} that resolves when the watcher exits.
 */
export async function testWatch(options: TestWatchOptions = {}): Promise<void> {
  const { runner = await detectTestRunner(), ...runnerOptions } = options;
  await RUNNERS[runner].testWatch(runnerOptions);
}
