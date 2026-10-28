/**
 * @file
 *
 * Runs ONE workspace package's unit tests; its `test` script points here.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { test } from '../src/test-runners/auto.ts';

const [, , ...additionalArguments] = process.argv;

await wrapCliTask(async () => {
  await test({
    additionalArguments,
    projects: ['unit-tests']
  });
});
