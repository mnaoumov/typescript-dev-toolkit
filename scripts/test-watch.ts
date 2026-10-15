/**
 * @file
 *
 * Runs ONE workspace package's unit tests in watch mode; its `test:watch` script points here.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { testWatch } from '../src/test-runners/vitest.ts';

await wrapCliTask(async () => {
  await testWatch({
    projects: ['unit-tests']
  });
});
