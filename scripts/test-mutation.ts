/**
 * @file
 *
 * Runs Stryker mutation testing on demand over the named modules, or incrementally over everything; its
 * `test:mutation` script points here.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { testMutation } from '../src/test-runners/stryker.ts';

const [, , ...modulePaths] = process.argv;

await wrapCliTask(async () => {
  await testMutation({ modulePaths });
});
