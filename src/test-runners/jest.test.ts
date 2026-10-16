import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ExecOptions } from '../exec.ts';
import type { ResolvePathFromRootSafeParams } from '../root.ts';

import {
  hasJestConfig,
  test,
  testCoverage,
  testWatch
} from './jest.ts';

const {
  mockExecFromRoot,
  mockExistsSync,
  mockIsEsmPackage,
  mockReadPackageJson
} = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string[], options: ExecOptions) => Promise<string>>(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsEsmPackage: vi.fn<() => boolean>(),
  mockReadPackageJson: vi.fn<() => Promise<Record<string, unknown>>>()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../npm.ts', () => ({
  readPackageJson: mockReadPackageJson
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (): string[] => ['/root/node_modules/.bin/jest']
}));

vi.mock('./jest-config.ts', () => ({
  isEsmPackage: mockIsEsmPackage
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

const JEST = '/root/node_modules/.bin/jest';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_OPTIONS', undefined);
  mockExecFromRoot.mockResolvedValue('');
  mockExistsSync.mockReturnValue(false);
  mockIsEsmPackage.mockReturnValue(false);
  mockReadPackageJson.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasJestConfig', () => {
  it('should find a jest configuration file', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/jest.config.ts');
    expect(await hasJestConfig()).toBe(true);
    expect(mockReadPackageJson).not.toHaveBeenCalled();
  });

  it('should find a jest key in package.json', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/package.json');
    mockReadPackageJson.mockResolvedValue({ jest: {} });
    expect(await hasJestConfig()).toBe(true);
  });

  it('should be false for a package.json without a jest key', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/package.json');
    expect(await hasJestConfig()).toBe(false);
  });

  it('should be false without a package.json', async () => {
    expect(await hasJestConfig()).toBe(false);
    expect(mockReadPackageJson).not.toHaveBeenCalled();
  });
});

describe('test', () => {
  it('should run jest without NODE_OPTIONS for a CommonJS package', async () => {
    await test();
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], { env: {}, isInteractive: false });
  });

  it('should add --experimental-vm-modules for an ESM package', async () => {
    mockIsEsmPackage.mockReturnValue(true);
    await test();
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], {
      env: { NODE_OPTIONS: '--experimental-vm-modules' },
      isInteractive: false
    });
  });

  it('should keep the inherited NODE_OPTIONS', async () => {
    vi.stubEnv('NODE_OPTIONS', ' --max-old-space-size=4096 ');
    await test({ esm: true });
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], {
      env: { NODE_OPTIONS: '--max-old-space-size=4096 --experimental-vm-modules' },
      isInteractive: false
    });
    expect(mockIsEsmPackage).not.toHaveBeenCalled();
  });

  it('should not add the flag twice', async () => {
    vi.stubEnv('NODE_OPTIONS', '--experimental-vm-modules');
    await test({ esm: true });
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], {
      env: { NODE_OPTIONS: '--experimental-vm-modules' },
      isInteractive: false
    });
  });

  it('should leave NODE_OPTIONS alone when esm is false', async () => {
    mockIsEsmPackage.mockReturnValue(true);
    await test({ esm: false });
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], { env: {}, isInteractive: false });
  });

  it('should select the projects', async () => {
    await test({ projects: ['unit', 'dom'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST, '--selectProjects', 'unit', 'dom'], { env: {}, isInteractive: false });
  });

  it('should pass no --selectProjects for an empty list', async () => {
    await test({ projects: [] });
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST], { env: {}, isInteractive: false });
  });
});

describe('testCoverage', () => {
  it('should run with coverage and a zero threshold by default', async () => {
    await testCoverage();
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      JEST,
      '--coverage',
      '--coverageThreshold={"global":{"branches":0,"functions":0,"lines":0,"statements":0}}'
    ], { env: {}, isInteractive: false });
  });

  it('should apply the threshold to all four metrics', async () => {
    await testCoverage({ minCoverageInPercents: 100, projects: ['unit'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      JEST,
      '--coverage',
      '--coverageThreshold={"global":{"branches":100,"functions":100,"lines":100,"statements":100}}',
      '--selectProjects',
      'unit'
    ], { env: {}, isInteractive: false });
  });
});

describe('testWatch', () => {
  it('should run jest --watch on the terminal', async () => {
    await testWatch();
    expect(mockExecFromRoot).toHaveBeenCalledWith([JEST, '--watch'], { env: {}, isInteractive: true });
  });
});
