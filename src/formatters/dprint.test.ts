import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolveToolCommandParams } from '../package-manager.ts';
import type { ResolvePathFromRootSafeParams } from '../root.ts';

import { format } from './dprint.ts';

const EXCLUDES = '--excludes=**/.claude/settings.local.json';

const {
  mockExecFromRoot,
  mockExistsSync,
  mockGetRootFolder
} = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockGetRootFolder: vi.fn<() => null | string>()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  getRootFolder: mockGetRootFolder,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (params: ResolveToolCommandParams): string[] => [params.tool]
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
  mockGetRootFolder.mockReturnValue('/root');
});

describe('format', () => {
  it('should format the whole project without allowing an empty file set', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/dprint.json');
    await format();
    expect(mockExecFromRoot).toHaveBeenCalledWith(['dprint', 'fmt', '--config', '/root/dprint.json', EXCLUDES, { batchedArguments: ['**/*'] }]);
  });

  it('should allow explicit paths that dprint.json excludes entirely', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/dprint.json');
    await format({ paths: ['demo-vault/a.ts'], rewrite: false });
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      'dprint',
      'check',
      '--config',
      '/root/dprint.json',
      EXCLUDES,
      '--allow-no-files',
      { batchedArguments: ['demo-vault/a.ts'] }
    ]);
  });

  it('should treat an empty path list as the whole project', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/dprint.json');
    await format({ paths: [] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(['dprint', 'fmt', '--config', '/root/dprint.json', EXCLUDES, { batchedArguments: ['**/*'] }]);
  });

  it('should fall back to the default configuration', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/consumer/dprint.json');
    await format({ defaultConfigFilePath: '/consumer/dprint.json' });
    expect(mockExecFromRoot).toHaveBeenCalledWith(expect.arrayContaining(['--config', '/consumer/dprint.json']));
  });

  it('should throw without any dprint.json', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(format()).rejects.toThrow('dprint.json not found');
  });

  it('should throw without a root folder', async () => {
    mockGetRootFolder.mockReturnValue(null);
    await expect(format()).rejects.toThrow('Root folder not found');
  });
});
