import { noop } from '@mnaoumov/typescript-lib/function';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ExecOptions } from '../exec.ts';

import {
  test,
  testCoverage,
  testWatch
} from './vitest.ts';

const { mockExec, mockResolveConfig } = vi.hoisted(() => ({
  mockExec: vi.fn<(command: string[], options: ExecOptions) => Promise<string>>(),
  mockResolveConfig: vi.fn<() => Promise<unknown>>()
}));

vi.mock('../root.ts', () => ({ execFromRoot: mockExec, resolvePathFromRootSafe: (): string => '/root' }));
vi.mock('vitest/node', () => ({ resolveConfig: mockResolveConfig }));
vi.mock('node:os', () => ({ availableParallelism: (): number => 6 }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BULK_CORES', undefined);
  vi.stubEnv('VITEST_MAX_WORKERS', undefined);
  mockResolveConfig.mockResolvedValue({ test: { resolvedProjects: [] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Vitest wrappers', () => {
  it.each([undefined, '', ' ', '0', '-2', '1.5', '2x', 'Infinity', '9007199254740992'])('leaves ordinary invocations alone for budget %s', async (budget) => {
    vi.stubEnv('BULK_CORES', budget);
    await test();
    expect(mockExec).toHaveBeenCalledWith(['vitest', 'run'], { env: {} });
    expect(mockResolveConfig).not.toHaveBeenCalled();
  });

  it.each([test, testCoverage, testWatch])('caps each wrapper and preserves project selection', async (run) => {
    vi.stubEnv('BULK_CORES', ' 2 ');
    await run({ projects: ['unit-tests'] });
    expect(mockExec.mock.calls[0]?.[0]).toContain('--project=unit-tests:*');
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ env: { VITEST_MAX_WORKERS: '2' } });
    expect(mockResolveConfig).toHaveBeenCalledWith({ project: ['unit-tests', 'unit-tests:*'], root: '/root', watch: run === testWatch });
  });

  it('keeps coverage thresholds', async () => {
    await testCoverage({ minCoverageInPercents: 100 });
    expect(mockExec.mock.calls[0]?.[0]).toEqual(['vitest', 'run', '--coverage', '--coverage.thresholds.lines=100', '--coverage.thresholds.functions=100', '--coverage.thresholds.branches=100', '--coverage.thresholds.statements=100']);
  });

  it.each([
    { maxWorkers: 1 },
    { resolvedProjects: [{ projectConfig: { maxWorkers: 1 } }] }
  ])('preserves a narrower configured limit %j', async (config) => {
    vi.stubEnv('BULK_CORES', '2');
    mockResolveConfig.mockResolvedValue({ test: { resolvedProjects: [], ...config } });
    await test();
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ env: { VITEST_MAX_WORKERS: '1' } });
  });

  it.each([['1', '1'], ['8', '2'], ['bad', '2'], ['0', '2']])('caps inherited worker setting %s', async (inherited, expected) => {
    vi.stubEnv('BULK_CORES', '2');
    vi.stubEnv('VITEST_MAX_WORKERS', inherited);
    mockResolveConfig.mockImplementation(() => {
      expect(process.env['VITEST_MAX_WORKERS']).toBeUndefined();
      return Promise.resolve({ test: { resolvedProjects: [] } });
    });
    await test();
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ env: { VITEST_MAX_WORKERS: expected } });
    expect(process.env['VITEST_MAX_WORKERS']).toBe(inherited);
  });

  it('restores the environment when configuration resolution fails', async () => {
    vi.stubEnv('BULK_CORES', '2');
    vi.stubEnv('VITEST_MAX_WORKERS', '1');
    mockResolveConfig.mockRejectedValueOnce(new Error('broken config'));
    await expect(test()).rejects.toThrow('broken config');
    expect(process.env['VITEST_MAX_WORKERS']).toBe('1');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('preserves an inherited narrow cap when wrappers are called together', async () => {
    vi.stubEnv('BULK_CORES', '2');
    vi.stubEnv('VITEST_MAX_WORKERS', '1');
    let releaseResolution = noop;
    const resolution = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    mockResolveConfig.mockImplementation(async () => {
      await resolution;
      return { test: { resolvedProjects: [] } };
    });
    const runs = [test(), testCoverage()];
    await vi.waitFor(() => {
      expect(mockResolveConfig).toHaveBeenCalled();
    });
    releaseResolution();
    await Promise.all(runs);
    expect(mockExec.mock.calls.map((call) => call[1])).toEqual([
      { env: { VITEST_MAX_WORKERS: '1' } },
      { env: { VITEST_MAX_WORKERS: '1' } }
    ]);
    expect(process.env['VITEST_MAX_WORKERS']).toBe('1');
  });

  it('ignores worker limits of projects excluded by the selection', async () => {
    vi.stubEnv('BULK_CORES', '2');
    mockResolveConfig.mockResolvedValue({ test: { resolvedProjects: [{ hidden: true, projectConfig: { maxWorkers: 1 } }] } });
    await test();
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ env: { VITEST_MAX_WORKERS: '2' } });
  });

  it.each([[test, '5'], [testWatch, '3']])('does not raise the ordinary worker default', async (run, expected) => {
    vi.stubEnv('BULK_CORES', '20');
    await run();
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ env: { VITEST_MAX_WORKERS: expected } });
  });

  it.each([test, testCoverage, testWatch])('appends forwarded filters and options after its own', async (run) => {
    await run({ additionalArguments: ['src/a.test.ts', '--maxWorkers=2', '-t', 'adds'], projects: ['unit-tests'] });
    expect(mockExec.mock.calls[0]?.[0].slice(-4)).toEqual(['src/a.test.ts', '--maxWorkers=2', '-t', 'adds']);
    expect(mockExec.mock.calls[0]?.[0]).toContain('--project=unit-tests');
  });

  it.each(['--project=other', '--project', '--coverage', '--no-coverage', '--coverage.thresholds.lines=0', '--watch', '-w', '--run'])(
    'refuses forwarded option %s the wrapper owns',
    async (argument) => {
      vi.stubEnv('BULK_CORES', '2');
      await expect(testCoverage({ additionalArguments: [argument] })).rejects.toThrow(`vitest wrapper sets these options itself, so they cannot be forwarded: ${argument}`);
      expect(mockExec).not.toHaveBeenCalled();
      expect(mockResolveConfig).not.toHaveBeenCalled();
    }
  );
});
