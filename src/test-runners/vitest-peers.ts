/**
 * @file
 *
 * Checks that `@vitest/coverage-v8` is installed at exactly the version of `vitest`, and fails with the one
 * `npm install` line that fixes it when it is not.
 *
 * Vitest publishes its companion packages in lockstep, and the coverage provider's own peer range is the exact
 * `vitest` version. A partial bump (`npm install vitest@latest`, or a renovate PR that moves only one of the two)
 * leaves the pair mismatched, a combination vitest does not support, which a package manager that does not enforce
 * peers (or npm under `--legacy-peer-deps`) installs anyway. Failing when the configuration loads names the cause
 * before a coverage run goes wrong somewhere else. A missing package is left alone: a project that never runs
 * coverage does not need the provider.
 */

import type { PackageJson } from 'type-fest';

import { existsSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';

import { readJsonSync } from '../json.ts';
import { resolvePathFromRootSafe } from '../root.ts';

/**
 * The coverage provider the shared vitest configuration names.
 */
export const VITEST_COVERAGE_V8_PACKAGE_NAME = '@vitest/coverage-v8';

/**
 * The test runner whose version the coverage provider must match.
 */
export const VITEST_PACKAGE_NAME = 'vitest';

/**
 * Parameters for {@link assertVitestPeerVersions}.
 */
export interface AssertVitestPeerVersionsParams {
  /**
   * Who is checking, named at the start of each line of the error, such as `defineLibraryVitestConfig()`.
   */
  readonly callerName: string;

  /**
   * Reads the installed versions. The default resolves them from the project root's `node_modules`.
   */
  readonly readInstalledVersion?: InstalledVersionReader;
}

/**
 * Reads the installed version of a package, or `null` when it is not installed.
 */
export type InstalledVersionReader = (packageName: string) => null | string;

/**
 * One thing to fix: what is wrong, and the `name@version` that fixes it.
 */
export interface VitestPeerProblem {
  /**
   * The `name@version` to install.
   */
  readonly install: string;

  /**
   * What is wrong.
   */
  readonly message: string;
}

/**
 * Throws one error naming every problem and the one command that fixes them all, or returns when the installed
 * versions fit.
 *
 * @param params - The {@link AssertVitestPeerVersionsParams}.
 */
export function assertVitestPeerVersions(params: AssertVitestPeerVersionsParams): void {
  const problems = findVitestPeerProblems(params.readInstalledVersion ?? readInstalledPackageVersion);
  if (problems.length === 0) {
    return;
  }

  const lines = problems.map((problem) => `${params.callerName}: ${problem.message}`);
  const specs = problems.map((problem) => problem.install);
  throw new Error([...lines, `Run: npm install --save-dev ${specs.join(' ')}`].join('\n'));
}

/**
 * Finds the version problems of the vitest companion packages.
 *
 * @param readInstalledVersion - Reads the installed versions.
 * @returns The problems, empty when the versions fit or when either package is not installed.
 */
export function findVitestPeerProblems(readInstalledVersion: InstalledVersionReader): VitestPeerProblem[] {
  const vitestVersion = readInstalledVersion(VITEST_PACKAGE_NAME);
  const coverageVersion = readInstalledVersion(VITEST_COVERAGE_V8_PACKAGE_NAME);
  if (vitestVersion === null || coverageVersion === null || vitestVersion === coverageVersion) {
    return [];
  }

  return [{
    install: `${VITEST_COVERAGE_V8_PACKAGE_NAME}@${vitestVersion}`,
    message: `"${VITEST_COVERAGE_V8_PACKAGE_NAME}" ${coverageVersion} is installed next to "${VITEST_PACKAGE_NAME}" ${vitestVersion}; the two must be the same version.`
  }];
}

/**
 * Reads a package's installed version the way Node resolves the package: from the nearest `node_modules` folder,
 * walking up from `cwd`, that holds it.
 *
 * It reads the `package.json` file directly rather than resolving `<name>/package.json`, because a package whose
 * `exports` field does not list that subpath (`@vitest/coverage-v8` among them) refuses the resolution.
 *
 * @param packageName - The package name.
 * @param cwd - The folder to start from. The default is the project root.
 * @returns The version, or `null` when no `node_modules` folder up the tree holds the package.
 */
export function readInstalledPackageVersion(packageName: string, cwd?: string): null | string {
  let folder = cwd ?? resolvePathFromRootSafe({ path: '.' });
  for (;;) {
    const packageJsonPath = join(folder, 'node_modules', packageName, 'package.json');
    if (existsSync(packageJsonPath)) {
      const { version } = readJsonSync<PackageJson>(packageJsonPath);
      return typeof version === 'string' ? version : null;
    }

    const parent = dirname(folder);
    if (parent === folder) {
      return null;
    }
    folder = parent;
  }
}
