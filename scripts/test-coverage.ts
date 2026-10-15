/**
 * @file
 *
 * Runs ONE workspace package's unit tests under the 100% coverage gate; its `test:coverage` script points here.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { testCoverage } from '../src/test-runners/vitest.ts';

await wrapCliTask(async () => {
  const FULL_COVERAGE_IN_PERCENTS = 100;
  await testCoverage({
    minCoverageInPercents: FULL_COVERAGE_IN_PERCENTS,
    projects: ['unit-tests']
  });
});
