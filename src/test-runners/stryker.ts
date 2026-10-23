/**
 * @file
 *
 * Runs Stryker mutation testing on demand: over named modules and their sibling tests, or incrementally over the
 * whole project. Never part of a gate: a full run takes about an hour.
 */

import { toPosixPath } from '@mnaoumov/typescript-lib/path';
import { existsSync } from 'node:fs';

import { resolveToolCommand } from '../package-manager.ts';
import {
  execFromRoot,
  resolvePathFromRootSafe
} from '../root.ts';
import { STRYKER_TEST_FILES_ENV_VARIABLE } from './stryker-config.ts';

/**
 * Options for {@link testMutation}.
 */
export interface TestMutationOptions {
  /**
   * The modules to mutate, as paths from the project root. Each needs a sibling `*.test.ts`, and only those tests run.
   * With none, every file the configuration's `mutate` globs name is mutated, incrementally.
   *
   * @default `[]`
   */
  readonly modulePaths?: readonly string[];
}

const TS_EXTENSION_REG_EXP = /\.ts$/;

/**
 * Runs Stryker mutation testing.
 *
 * The run mutates the tree in place and, when it ends, puts back the whole tree as it was when it started, so it
 * refuses to start on a tree with uncommitted changes, and nothing may be edited while it runs.
 *
 * @param options - The {@link TestMutationOptions}.
 * @returns A {@link Promise} that resolves when Stryker exits.
 * @throws If the tree has uncommitted changes, a path is not a `.ts` module, or a module has no sibling test.
 */
export async function testMutation(options: TestMutationOptions = {}): Promise<void> {
  const modulePaths = (options.modulePaths ?? []).map((modulePath) => toPosixPath(modulePath));
  const testFiles = getSiblingTestFiles(modulePaths);

  const status = await execFromRoot('git status --porcelain --untracked-files=all', { isQuiet: true });
  if (status) {
    throw new Error(
      `Mutation testing needs a committed tree: Stryker mutates it in place and puts the whole tree back as it was when the run started, so an uncommitted change would be lost.\n${status}`
    );
  }

  const runArguments = modulePaths.length > 0 ? ['--mutate', modulePaths.join(',')] : ['--incremental'];
  const env = modulePaths.length > 0 ? { [STRYKER_TEST_FILES_ENV_VARIABLE]: testFiles.join(',') } : {};

  await execFromRoot([...resolveToolCommand({ tool: 'stryker' }), 'run', ...runArguments], { env, isInteractive: true });
}

/**
 * Derives each module's sibling test file.
 *
 * @param modulePaths - The modules, as POSIX paths from the project root.
 * @returns The test files, in the same order.
 * @throws If a path is not a `.ts` module, or its sibling test does not exist.
 */
function getSiblingTestFiles(modulePaths: readonly string[]): string[] {
  const problems: string[] = [];
  const testFiles = modulePaths.map((modulePath) => {
    if (!modulePath.endsWith('.ts') || modulePath.endsWith('.d.ts') || modulePath.endsWith('.test.ts')) {
      problems.push(`${modulePath}: not a .ts module`);
      return modulePath;
    }

    const testFile = modulePath.replace(TS_EXTENSION_REG_EXP, '.test.ts');
    if (!existsSync(resolvePathFromRootSafe({ path: testFile }))) {
      problems.push(`${modulePath}: no sibling test ${testFile}`);
    }

    return testFile;
  });

  if (problems.length > 0) {
    throw new Error(`Cannot scope the mutation run:\n${problems.join('\n')}`);
  }

  return testFiles;
}
