import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ExecOptions } from '../exec.ts';
import type { ResolvePathFromRootSafeParams } from '../root.ts';

import { testMutation } from './stryker.ts';

const {
  mockExecFromRoot,
  mockExistsSync
} = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string | string[], options: ExecOptions) => Promise<string>>(),
  mockExistsSync: vi.fn<(path: string) => boolean>()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (): string[] => ['/root/node_modules/.bin/stryker']
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

const STRYKER = '/root/node_modules/.bin/stryker';

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
  mockExistsSync.mockReturnValue(true);
});

describe('testMutation', () => {
  it('should run everything incrementally without module paths', async () => {
    await testMutation();
    expect(mockExecFromRoot).toHaveBeenLastCalledWith([STRYKER, 'run', '--incremental'], { env: {}, isInteractive: true });
  });

  it('should scope the run to the modules and their sibling tests', async () => {
    await testMutation({ modulePaths: [String.raw`src\a.ts`, 'src/b/c.ts'] });
    expect(mockExistsSync).toHaveBeenCalledWith('/root/src/a.test.ts');
    expect(mockExecFromRoot).toHaveBeenLastCalledWith([STRYKER, 'run', '--mutate', 'src/a.ts,src/b/c.ts'], {
      env: { STRYKER_TEST_FILES: 'src/a.test.ts,src/b/c.test.ts' },
      isInteractive: true
    });
  });

  it('should refuse a tree with uncommitted changes', async () => {
    mockExecFromRoot.mockResolvedValueOnce(' M src/a.ts');
    await expect(testMutation()).rejects.toThrow('Mutation testing needs a committed tree');
    expect(mockExecFromRoot).toHaveBeenCalledTimes(1);
  });

  it('should refuse a path that is not a module', async () => {
    await expect(testMutation({ modulePaths: ['src/a.js', 'src/a.d.ts', 'src/a.test.ts'] })).rejects.toThrow(
      'Cannot scope the mutation run:\nsrc/a.js: not a .ts module\nsrc/a.d.ts: not a .ts module\nsrc/a.test.ts: not a .ts module'
    );
    expect(mockExecFromRoot).not.toHaveBeenCalled();
  });

  it('should refuse a module without a sibling test', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(testMutation({ modulePaths: ['src/a.ts'] })).rejects.toThrow('src/a.ts: no sibling test src/a.test.ts');
  });
});
