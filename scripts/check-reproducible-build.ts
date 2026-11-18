/**
 * @file
 *
 * Builds this package from the working tree and from `git archive HEAD` extracted elsewhere, and requires `dist/` to be
 * identical byte for byte. `--no-build` compares the `dist/` the last build left instead of building the working tree
 * again; CI passes it after the gate.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { assertReproducibleBuild } from '../src/reproducible-build.ts';

await wrapCliTask(() =>
  assertReproducibleBuild({
    outputPaths: ['dist'],
    shouldBuildWorkingTree: !process.argv.includes('--no-build')
  })
);
