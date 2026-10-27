import {
  DEFAULT_VITEST_TEST_EXCLUDE,
  defineLibraryVitestConfig
} from './src/test-runners/vitest-config.ts';

const ESLINT_TYPECHECK_TEST_FILES = 'src/linters/eslint-rules/*.test.ts';
const INTEGRATION_TEST_FILES = 'src/**/*.integration.test.ts';

// The unit tests that build a real TypeScript or ts-morph program, esbuild bundle or resvg image. Each takes seconds
// alone and went past a 30 s per-test override when a release ran on a machine other work held at 100% CPU, so they
// run in a project of their own with a budget sized for that load and no more than two workers.
const SLOW_TEST_FILES = [
  'src/bundlers/esbuild-impl/preprocess-plugin.test.ts',
  'src/docs-site/api-doc-*.test.ts',
  'src/docs-site/docs-snippets.test.ts',
  'src/docs-site/og-images*.test.ts',
  'src/library-build.test.ts'
];
const SLOW_TEST_MAX_WORKERS = 2;
const SLOW_TEST_GROUP_ORDER = 1;

// Every `@typescript-eslint/rule-tester` case builds a type-aware program, so these run one file at a time in a
// shared worker; see AGENTS.md on why a timeout here is machine load rather than a broken rule.
const ESLINT_TYPECHECK_GROUP_ORDER = 2;
const BIG_TIMEOUT_IN_MILLISECONDS = 30_000;
const LOADED_MACHINE_TIMEOUT_IN_MILLISECONDS = 180_000;

export default defineLibraryVitestConfig({
  projects: [
    {
      test: {
        environment: 'node',
        exclude: [...DEFAULT_VITEST_TEST_EXCLUDE, INTEGRATION_TEST_FILES, ESLINT_TYPECHECK_TEST_FILES, ...SLOW_TEST_FILES],
        include: ['src/**/*.test.ts'],
        name: 'unit-tests',
        setupFiles: []
      }
    },
    {
      test: {
        environment: 'node',
        exclude: [...DEFAULT_VITEST_TEST_EXCLUDE, INTEGRATION_TEST_FILES],
        include: SLOW_TEST_FILES,
        maxWorkers: SLOW_TEST_MAX_WORKERS,
        name: 'unit-tests:slow',
        sequence: {
          groupOrder: SLOW_TEST_GROUP_ORDER
        },
        setupFiles: [],
        testTimeout: LOADED_MACHINE_TIMEOUT_IN_MILLISECONDS
      }
    },
    {
      test: {
        environment: 'node',
        exclude: [...DEFAULT_VITEST_TEST_EXCLUDE],
        include: [ESLINT_TYPECHECK_TEST_FILES],
        isolate: false,
        maxWorkers: 1,
        name: 'unit-tests:eslint-typecheck',
        sequence: {
          groupOrder: ESLINT_TYPECHECK_GROUP_ORDER
        },
        setupFiles: [],
        testTimeout: LOADED_MACHINE_TIMEOUT_IN_MILLISECONDS
      }
    },
    {
      test: {
        environment: 'node',
        exclude: [...DEFAULT_VITEST_TEST_EXCLUDE],
        include: [INTEGRATION_TEST_FILES],
        name: 'integration-tests',
        setupFiles: [],
        testTimeout: BIG_TIMEOUT_IN_MILLISECONDS
      }
    },
    {
      test: {
        environment: 'node',
        exclude: [...DEFAULT_VITEST_TEST_EXCLUDE],
        // This package's own documentation checks; outside `src/`, so outside the coverage gate.
        include: ['scripts/**/*.test.ts'],
        name: 'unit-tests:scripts',
        setupFiles: []
      }
    }
  ]
});
