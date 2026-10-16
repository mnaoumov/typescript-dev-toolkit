import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolveToolCommandParams } from '../package-manager.ts';
import type { ResolvePathFromRootSafeParams } from '../root.ts';

import {
  format,
  getPrettierConfig,
  hasPrettierConfig
} from './prettier.ts';

const {
  mockExecFromRoot,
  mockExistsSync,
  mockReadFileSync,
  mockReadPackageJson
} = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadFileSync: vi.fn<(path: string) => string>(),
  mockReadPackageJson: vi.fn<() => Promise<Record<string, unknown>>>()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (params: ResolveToolCommandParams): string[] => [params.tool]
}));

vi.mock('../npm.ts', () => ({
  readPackageJson: mockReadPackageJson
}));

vi.mock('../shared-config-files.ts', () => ({
  getSharedConfigFilePath: (file: string): string => `/pkg/assets/${file}`,
  SharedConfigFile: { Prettier: 'prettier.json' }
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
  mockReadPackageJson.mockResolvedValue({});
});

describe('getPrettierConfig', () => {
  it('should read the shared configuration', () => {
    mockReadFileSync.mockImplementation((path: string) => path === '/pkg/assets/prettier.json' ? '{ "semi": true }' : '');
    expect(getPrettierConfig()).toEqual({ semi: true });
  });
});

describe('hasPrettierConfig', () => {
  it('should find a configuration file', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/prettier.config.mjs');
    expect(await hasPrettierConfig()).toBe(true);
  });

  it('should find a prettier key in package.json', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/package.json');
    mockReadPackageJson.mockResolvedValue({ prettier: '@scope/prettier-config' });
    expect(await hasPrettierConfig()).toBe(true);
  });

  it('should find nothing in a package.json without the key', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/package.json');
    expect(await hasPrettierConfig()).toBe(false);
  });

  it('should find nothing without a package.json', async () => {
    mockExistsSync.mockReturnValue(false);
    expect(await hasPrettierConfig()).toBe(false);
    expect(mockReadPackageJson).not.toHaveBeenCalled();
  });
});

describe('format', () => {
  it('should write the whole project with the project configuration', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/.prettierrc');
    await format();
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      'prettier',
      '--write',
      '--ignore-unknown',
      '!**/*.md',
      '!**/*-lock.json',
      { batchedArguments: ['.'] }
    ]);
  });

  it('should check the given paths and skip the unmatched ones', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/.prettierrc');
    await format({ paths: ['src/a.ts'], rewrite: false });
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      'prettier',
      '--check',
      '--ignore-unknown',
      '--no-error-on-unmatched-pattern',
      '!**/*.md',
      '!**/*-lock.json',
      { batchedArguments: ['src/a.ts'] }
    ]);
  });

  it('should use the shared configuration when the project has none', async () => {
    mockExistsSync.mockReturnValue(false);
    await format();
    expect(mockExecFromRoot).toHaveBeenCalledWith(expect.arrayContaining(['--config', '/pkg/assets/prettier.json']));
  });

  it('should prefer the default configuration it is given', async () => {
    mockExistsSync.mockReturnValue(false);
    await format({ defaultConfigFilePath: '/consumer/prettier.json' });
    expect(mockExecFromRoot).toHaveBeenCalledWith(expect.arrayContaining(['--config', '/consumer/prettier.json']));
  });
});
