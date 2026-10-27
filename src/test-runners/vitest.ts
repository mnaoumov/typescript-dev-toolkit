/**
 * @file
 *
 * This module provides functions for running tests using the Vitest framework.
 */

import { availableParallelism } from 'node:os';
import process from 'node:process';

import { getBulkConcurrency } from '../bulk-concurrency.ts';
import {
  execFromRoot,
  resolvePathFromRootSafe
} from '../root.ts';

const WATCH_WORKER_DIVISOR = 2;
const workerEnvironmentQueue = { pending: Promise.resolve<unknown>(undefined) };

/**
 * Options for running tests with coverage.
 */
export interface TestCoverageOptions extends TestOptions {
  /**
   * Minimum coverage percentage required. If the actual coverage falls below
   * this threshold, the process exits with a non-zero code.
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
   * The projects to run.
   */
  readonly projects?: string[];
}

/**
 * Options for running tests in watch mode.
 */
export type TestWatchOptions = TestOptions;

/**
 * Runs the test suite.
 *
 * @param options - The options for the test.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function test(options: TestOptions = {}): Promise<void> {
  await execFromRoot(['vitest', 'run', ...buildProjectFlags(options.projects)], {
    env: await getWorkerEnvironment(options)
  });
}

/**
 * Runs the test suite with coverage.
 *
 * @param options - Optional coverage configuration.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function testCoverage(options: TestCoverageOptions = {}): Promise<void> {
  const threshold = String(options.minCoverageInPercents ?? 0);
  await execFromRoot([
    'vitest',
    'run',
    ...buildProjectFlags(options.projects),
    '--coverage',
    `--coverage.thresholds.lines=${threshold}`,
    `--coverage.thresholds.functions=${threshold}`,
    `--coverage.thresholds.branches=${threshold}`,
    `--coverage.thresholds.statements=${threshold}`
  ], { env: await getWorkerEnvironment(options) });
}

/**
 * Runs the test suite in watch mode.
 *
 * @param options - The options for the test.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function testWatch(options: TestWatchOptions = {}): Promise<void> {
  await execFromRoot(['vitest', ...buildProjectFlags(options.projects)], {
    env: await getWorkerEnvironment(options, true)
  });
}

/**
 * Builds `--project` flags for the given project prefixes.
 * Each prefix expands to both `--project=prefix` (exact match)
 * and `--project=prefix:*` (sub-projects).
 *
 * @param projects - The project name prefixes.
 * @returns The `--project` flags array.
 */
function buildProjectFlags(projects?: string[]): string[] {
  return (projects ?? []).flatMap((project) => [`--project=${project}`, `--project=${project}:*`]);
}

/**
 * Resolves the bulk cap without letting Vitest's environment override hide narrower project limits.
 * The narrowest limit applies to the whole invocation because CLI and environment limits replace project limits.
 *
 * @param options - The selected test projects.
 * @param isWatch - Whether this invocation watches for changes.
 * @returns Child environment overrides, empty outside bulk work.
 */
async function getWorkerEnvironment(options: TestOptions, isWatch = false): Promise<NodeJS.ProcessEnv> {
  const next = workerEnvironmentQueue.pending.then(() => resolveWorkerEnvironment(options, isWatch));
  workerEnvironmentQueue.pending = next.catch(() => undefined);
  return next;
}

/**
 * Resolves one invocation's worker environment while holding the configuration-resolution queue.
 *
 * @param options - The selected test projects.
 * @param isWatch - Whether this invocation watches for changes.
 * @returns Child environment overrides.
 */
async function resolveWorkerEnvironment(options: TestOptions, isWatch: boolean): Promise<NodeJS.ProcessEnv> {
  const budget = getBulkConcurrency(Infinity);
  if (!Number.isFinite(budget)) {
    return {};
  }

  // Optional peer: leave loading Vitest to the CLI outside bulk work.
  const { resolveConfig } = await import('vitest/node');
  const inheritedWorkers = process.env['VITEST_MAX_WORKERS'];
  delete process.env['VITEST_MAX_WORKERS'];
  let config;
  try {
    config = await resolveConfig({
      project: (options.projects ?? []).flatMap((project) => [project, `${project}:*`]),
      root: resolvePathFromRootSafe({ path: '.' }),
      watch: isWatch
    });
  } finally {
    if (inheritedWorkers !== undefined) {
      // eslint-disable-next-line require-atomic-updates -- Worker environment resolutions are serialized; restore the inherited value before the next invocation reads it.
      process.env['VITEST_MAX_WORKERS'] = inheritedWorkers;
    }
  }

  const ordinaryWorkers = Math.max(isWatch ? Math.floor(availableParallelism() / WATCH_WORKER_DIVISOR) : availableParallelism() - 1, 1);
  const inheritedLimit = Number.parseInt(inheritedWorkers ?? '', 10);
  let workers = Math.min(budget, ordinaryWorkers);
  if (Number.isSafeInteger(inheritedLimit) && inheritedLimit > 0) {
    workers = Math.min(workers, inheritedLimit);
  }

  const configs = [config.test, ...config.test.resolvedProjects.filter((entry) => !entry.hidden).map((entry) => entry.projectConfig)];
  for (const testConfig of configs) {
    if (testConfig.maxWorkers) {
      workers = Math.min(workers, testConfig.maxWorkers);
    }
  }

  return { VITEST_MAX_WORKERS: String(workers) };
}
