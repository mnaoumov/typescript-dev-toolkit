import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  defineStrykerConfig,
  getStrykerTestInclude,
  STRYKER_TEST_FILES_ENV_VARIABLE,
  STRYKER_VITEST_CONFIG_FILE_NAME
} from './stryker-config.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defineStrykerConfig', () => {
  it('should run in place against the mutation vitest configuration', () => {
    const config = defineStrykerConfig();
    expect(config['inPlace']).toBe(true);
    expect(config['testRunner']).toBe('vitest');
    expect(config['vitest']).toEqual({ configFile: STRYKER_VITEST_CONFIG_FILE_NAME, related: false });
    expect(config['ignorePatterns']).toContain('/docs');
  });

  it('should let an override replace a default', () => {
    const CONCURRENCY = 2;
    const config = defineStrykerConfig({ concurrency: CONCURRENCY });
    expect(config['concurrency']).toBe(CONCURRENCY);
    expect(config['inPlace']).toBe(true);
  });
});

describe('getStrykerTestInclude', () => {
  it('should return the defaults without a scoped test list', () => {
    vi.stubEnv(STRYKER_TEST_FILES_ENV_VARIABLE, undefined);
    expect(getStrykerTestInclude(['src/**/*.test.ts'])).toEqual(['src/**/*.test.ts']);
  });

  it('should return the scoped test files', () => {
    vi.stubEnv(STRYKER_TEST_FILES_ENV_VARIABLE, 'src/a.test.ts,src/b.test.ts');
    expect(getStrykerTestInclude(['src/**/*.test.ts'])).toEqual(['src/a.test.ts', 'src/b.test.ts']);
  });
});
