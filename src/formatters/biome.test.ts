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
  ensureBiomeConfig,
  format,
  hasBiomeConfig
} from './biome.ts';

const {
  mockCp,
  mockExecFromRoot,
  mockExistsSync,
  mockGetRootFolder,
  mockGetSharedConfigFilePath,
  mockWriteFile
} = vi.hoisted(() => ({
  mockCp: vi.fn(),
  mockExecFromRoot: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockGetRootFolder: vi.fn<() => null | string>(),
  mockGetSharedConfigFilePath: vi.fn<() => string>(),
  mockWriteFile: vi.fn()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  getRootFolder: mockGetRootFolder,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (params: ResolveToolCommandParams): string[] => [params.tool]
}));

vi.mock('../shared-config-files.ts', () => ({
  getSharedConfigFilePath: mockGetSharedConfigFilePath,
  SharedConfigFile: { Biome: 'biome.json' }
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...$module,
    cp: mockCp,
    writeFile: mockWriteFile
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
  mockGetRootFolder.mockReturnValue('/root');
  mockGetSharedConfigFilePath.mockReturnValue('/root/node_modules/@mnaoumov/typescript-dev-toolkit/assets/biome.json');
});

describe('hasBiomeConfig', () => {
  it('should find biome.jsonc', () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/biome.jsonc');
    expect(hasBiomeConfig()).toBe(true);
  });

  it('should find nothing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(hasBiomeConfig()).toBe(false);
  });
});

describe('ensureBiomeConfig', () => {
  it('should leave an existing configuration alone', async () => {
    mockExistsSync.mockReturnValue(true);
    await ensureBiomeConfig();
    expect(mockCp).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should copy the default configuration it is given', async () => {
    mockExistsSync.mockReturnValue(false);
    await ensureBiomeConfig({ defaultConfigFilePath: '/consumer/templates/biome.json' });
    expect(mockCp).toHaveBeenCalledWith('/consumer/templates/biome.json', '/root/biome.json');
  });

  it('should write a configuration extending the shared one', async () => {
    mockExistsSync.mockReturnValue(false);
    await ensureBiomeConfig();
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/root/biome.json',
      '{\n  "extends": ["./node_modules/@mnaoumov/typescript-dev-toolkit/assets/biome.json"]\n}\n'
    );
  });

  it('should keep a relative path that already leaves the root', async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetSharedConfigFilePath.mockReturnValue('/shared/biome.json');
    await ensureBiomeConfig();
    expect(mockWriteFile).toHaveBeenCalledWith('/root/biome.json', expect.stringContaining('"../shared/biome.json"'));
  });

  it('should throw when the root folder is not found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetRootFolder.mockReturnValue(null);
    await expect(ensureBiomeConfig()).rejects.toThrow('Root folder not found');
  });
});

describe('format', () => {
  it('should write the whole project', async () => {
    mockExistsSync.mockReturnValue(true);
    await format();
    expect(mockExecFromRoot).toHaveBeenCalledWith(['biome', 'format', '--write', { batchedArguments: ['.'] }]);
  });

  it('should check the given paths and skip the ones Biome does not handle', async () => {
    mockExistsSync.mockReturnValue(true);
    await format({ paths: ['README.md'], rewrite: false });
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      'biome',
      'format',
      '--files-ignore-unknown=true',
      '--no-errors-on-unmatched',
      { batchedArguments: ['README.md'] }
    ]);
  });
});
