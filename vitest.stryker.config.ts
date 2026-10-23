import type { ViteUserConfig } from 'vitest/config';

import { getStrykerTestInclude } from './src/test-runners/stryker-config.ts';
import { DEFAULT_VITEST_TEST_EXCLUDE } from './src/test-runners/vitest-config.ts';

const BIG_TIMEOUT_IN_MILLISECONDS = 30_000;

// The mutation run's vitest configuration: the `unit-tests` and `unit-tests:eslint-typecheck` projects flattened into one,
// since Stryker's vitest runner forces its own pool anyway.
const config: ViteUserConfig = {
  test: {
    environment: 'node',
    exclude: [...DEFAULT_VITEST_TEST_EXCLUDE, 'src/**/*.integration.test.ts'],
    globals: false,
    include: getStrykerTestInclude(['src/**/*.test.ts']),
    onConsoleLog: (): false => false,
    testTimeout: BIG_TIMEOUT_IN_MILLISECONDS
  }
};

export default config;
