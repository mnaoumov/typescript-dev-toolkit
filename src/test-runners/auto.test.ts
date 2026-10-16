import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvePathFromRootSafeParams } from '../root.ts';

import {
  detectTestRunner,
  test,
  testCoverage,
  testWatch
} from './auto.ts';

const {
  mockExistsSync,
  mockHasJestConfig,
  mockJest,
  mockVitest
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockHasJestConfig: vi.fn<() => Promise<boolean>>(),
  mockJest: {
    test: vi.fn(),
    testCoverage: vi.fn(),
    testWatch: vi.fn()
  },
  mockVitest: {
    test: vi.fn(),
    testCoverage: vi.fn(),
    testWatch: vi.fn()
  }
}));

vi.mock('../root.ts', () => ({
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('./jest.ts', () => ({
  ...mockJest,
  hasJestConfig: mockHasJestConfig
}));

vi.mock('./vitest.ts', () => mockVitest);

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockHasJestConfig.mockResolvedValue(false);
});

describe('detectTestRunner', () => {
  it('should prefer a vitest configuration over a jest one', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/vitest.config.mts');
    mockHasJestConfig.mockResolvedValue(true);
    expect(await detectTestRunner()).toBe('vitest');
  });

  it('should pick jest', async () => {
    mockHasJestConfig.mockResolvedValue(true);
    expect(await detectTestRunner()).toBe('jest');
  });

  it('should fall back to vitest', async () => {
    expect(await detectTestRunner()).toBe('vitest');
  });
});

describe('test', () => {
  it('should run the detected runner with the options', async () => {
    mockHasJestConfig.mockResolvedValue(true);
    await test({ esm: true, projects: ['unit'] });
    expect(mockJest.test).toHaveBeenCalledWith({ esm: true, projects: ['unit'] });
    expect(mockVitest.test).not.toHaveBeenCalled();
  });

  it('should run the runner it is told to', async () => {
    mockHasJestConfig.mockResolvedValue(true);
    await test({ runner: 'vitest' });
    expect(mockVitest.test).toHaveBeenCalledWith({});
  });

  it('should run vitest without options', async () => {
    await test();
    expect(mockVitest.test).toHaveBeenCalledWith({});
  });
});

describe('testCoverage', () => {
  it('should run the detected runner with the threshold', async () => {
    mockHasJestConfig.mockResolvedValue(true);
    await testCoverage({ minCoverageInPercents: 100 });
    expect(mockJest.testCoverage).toHaveBeenCalledWith({ minCoverageInPercents: 100 });
  });

  it('should run vitest without options', async () => {
    await testCoverage();
    expect(mockVitest.testCoverage).toHaveBeenCalledWith({});
  });
});

describe('testWatch', () => {
  it('should run the runner it is told to', async () => {
    await testWatch({ runner: 'jest' });
    expect(mockJest.testWatch).toHaveBeenCalledWith({});
  });

  it('should run vitest without options', async () => {
    await testWatch();
    expect(mockVitest.testWatch).toHaveBeenCalledWith({});
  });
});
