/**
 * @file
 *
 * This module provides functions for running tests using the Jest framework.
 */

import { existsSync } from 'node:fs';
import process from 'node:process';

import type { OwnedOption } from './forwarded-arguments.ts';

import { readPackageJson } from '../npm.ts';
import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import {
  execFromRoot,
  resolvePathFromRootSafe
} from '../root.ts';
import { assertNoOwnedArguments } from './forwarded-arguments.ts';
import { isEsmPackage } from './jest-config.ts';

const OWNED_OPTIONS: readonly OwnedOption[] = [
  { names: ['--selectProjects', '--select-projects'], replacement: 'the `projects` option' },
  { names: ['--watch', '--watchAll', '--watch-all'], replacement: 'the `testWatch` wrapper' },
  {
    names: ['--coverage', '--no-coverage', '--collectCoverage', '--collect-coverage', '--no-collectCoverage', '--coverageThreshold', '--coverage-threshold'],
    replacement: 'the `testCoverage` wrapper and its `minCoverageInPercents` option'
  }
];

/**
 * Every file jest reads its configuration from, besides the `jest` key of `package.json`.
 *
 * @see {@link https://jestjs.io/docs/configuration}
 */
export const JEST_CONFIG_FILE_NAMES: readonly string[] = [
  'jest.config.cjs',
  'jest.config.cts',
  'jest.config.js',
  'jest.config.json',
  'jest.config.mjs',
  'jest.config.mts',
  'jest.config.ts'
];

/**
 * The Node flag jest's ESM loader needs: it is built on `vm.SyntheticModule`, which Node only exposes under it.
 * Without it every ESM suite fails to load with `Must use import to load ES Module`.
 */
export const EXPERIMENTAL_VM_MODULES_FLAG = '--experimental-vm-modules';

/**
 * Options for running tests with coverage.
 */
export interface TestCoverageOptions extends TestOptions {
  /**
   * Minimum coverage percentage required, for lines, functions, branches and statements alike. If the actual coverage
   * falls below it, jest exits with a non-zero code.
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
   * Further jest CLI arguments, appended after the wrapper's own: test path patterns, `-t`, `--maxWorkers`, `--bail`.
   * An argument naming an option the wrapper sets itself (`--selectProjects`, `--coverage*`, `--watch*`) throws.
   */
  readonly additionalArguments?: readonly string[];

  /**
   * Whether jest runs the suite as ES modules, which adds {@link EXPERIMENTAL_VM_MODULES_FLAG} to `NODE_OPTIONS`.
   *
   * @default `true` when `package.json` declares `"type": "module"`, the rule `defineJestConfig` follows too
   */
  readonly esm?: boolean;

  /**
   * The projects to run, by their `displayName`, passed to jest's `--selectProjects`. Unlike vitest's runner, a name
   * matches only itself: jest has no `name:*` form.
   */
  readonly projects?: string[];
}

/**
 * Options for running tests in watch mode.
 */
export type TestWatchOptions = TestOptions;

/**
 * Says whether the project configures jest.
 *
 * @returns Whether a jest configuration file, or a `jest` key in `package.json`, exists at the project root.
 */
export async function hasJestConfig(): Promise<boolean> {
  if (JEST_CONFIG_FILE_NAMES.some((fileName) => existsSync(resolvePathFromRootSafe({ path: fileName })))) {
    return true;
  }

  if (!existsSync(resolvePathFromRootSafe({ path: RepoPaths.PackageJson }))) {
    return false;
  }

  const packageJson = await readPackageJson();
  return Object.hasOwn(packageJson, 'jest');
}

/**
 * Runs the test suite.
 *
 * @param options - The options for the test.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function test(options: TestOptions = {}): Promise<void> {
  await runJest([], options);
}

/**
 * Runs the test suite with coverage.
 *
 * @param options - Optional coverage configuration.
 * @returns A {@link Promise} that resolves when the tests have completed.
 */
export async function testCoverage(options: TestCoverageOptions = {}): Promise<void> {
  const threshold = options.minCoverageInPercents ?? 0;
  const coverageThreshold = {
    global: {
      branches: threshold,
      functions: threshold,
      lines: threshold,
      statements: threshold
    }
  };
  await runJest(['--coverage', `--coverageThreshold=${JSON.stringify(coverageThreshold)}`], options);
}

/**
 * Runs the test suite in watch mode, re-running the tests the changed files affect. Jest needs a git or Mercurial
 * repository for that.
 *
 * @param options - The options for the test.
 * @returns A {@link Promise} that resolves when the watcher exits.
 */
export async function testWatch(options: TestWatchOptions = {}): Promise<void> {
  await runJest(['--watch'], options, true);
}

/**
 * Appends {@link EXPERIMENTAL_VM_MODULES_FLAG} to a `NODE_OPTIONS` value, keeping whatever it already holds.
 *
 * @param nodeOptions - The inherited `NODE_OPTIONS`.
 * @returns The `NODE_OPTIONS` jest runs with.
 */
function addExperimentalVmModulesFlag(nodeOptions = ''): string {
  const flags = nodeOptions.split(/\s+/).filter(Boolean);
  if (!flags.includes(EXPERIMENTAL_VM_MODULES_FLAG)) {
    flags.push(EXPERIMENTAL_VM_MODULES_FLAG);
  }

  return flags.join(' ');
}

/**
 * Runs the jest CLI from the project root.
 *
 * @param runArguments - The arguments that select what jest does.
 * @param options - The {@link TestOptions}.
 * @param isInteractive - Whether jest gets the terminal, as its watch mode needs to read keys.
 * @returns A {@link Promise} that resolves when jest exits.
 */
async function runJest(runArguments: string[], options: TestOptions, isInteractive = false): Promise<void> {
  const { additionalArguments = [], esm = isEsmPackage(), projects = [] } = options;
  assertNoOwnedArguments({ forwardedArguments: additionalArguments, ownedOptions: OWNED_OPTIONS, runnerName: 'jest' });
  const projectArguments = projects.length > 0 ? ['--selectProjects', ...projects] : [];
  const env = esm ? { NODE_OPTIONS: addExperimentalVmModulesFlag(process.env['NODE_OPTIONS']) } : {};

  await execFromRoot([...resolveToolCommand({ tool: 'jest' }), ...runArguments, ...projectArguments, ...additionalArguments], {
    env,
    isInteractive
  });
}
