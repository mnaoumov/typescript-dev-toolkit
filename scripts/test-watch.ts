/**
 * @file
 *
 * Runs ONE workspace package's unit tests in watch mode; its `test:watch` script points here.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { testWatch } from '../src/test-runners/auto.ts';

const [, , ...additionalArguments] = process.argv;

await wrapCliTask(async () => {
  await testWatch({
    additionalArguments,
    projects: ['unit-tests']
  });
});
