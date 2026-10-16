/**
 * @file
 *
 * Runs ONE workspace package's unit tests; its `test` script points here.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { test } from '../src/test-runners/auto.ts';

await wrapCliTask(async () => {
  await test({
    projects: ['unit-tests']
  });
});
