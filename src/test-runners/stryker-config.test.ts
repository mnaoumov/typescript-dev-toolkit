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
    expect(defineStrykerConfig()).toEqual({
      checkers: [],
      concurrency: 4,
      coverageAnalysis: 'perTest',
      htmlReporter: { fileName: 'reports/mutation/mutation.html' },
      ignorePatterns: ['/.astro', '/.claude', '/.codex', '/coverage', '/dist', '/docs', '/reports'],
      inPlace: true,
      jsonReporter: { fileName: 'reports/mutation/mutation.json' },
      mutate: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/**/*.d.ts',
        '!src/**/index.ts',
        '!src/__merged.ts',
        '!src/test-helpers/**',
        '!src/**/@types/**'
      ],
      reporters: ['clear-text', 'progress-append-only', 'json', 'html'],
      // eslint-disable-next-line unicorn/name-replacements -- `tempDirName` is a Stryker option.
      tempDirName: '.stryker-tmp',
      testRunner: 'vitest',
      timeoutMS: 10_000,
      vitest: { configFile: STRYKER_VITEST_CONFIG_FILE_NAME, related: false }
    });
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
