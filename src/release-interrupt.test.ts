import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import dedent from 'dedent';
import process from 'node:process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { InterruptHooks } from './release-interrupt.ts';
import type { ResolvePathFromRootSafeParams } from './root.ts';

import {
  getProcessInterruptHooks,
  guardReleaseInterrupt,
  INTERRUPTED_EXIT_CODE,
  readWorkingTreeChanges,
  renderWorkingTreeDiff,
  restoreWorkingTreeChanges
} from './release-interrupt.ts';

const { mockExecFromRoot, mockReadFile, mockRm } = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string | string[]) => Promise<string>>(),
  mockReadFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
  mockRm: vi.fn<(path: string, options: object) => Promise<void>>()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: mockReadFile,
  rm: mockRm
}));

interface FakeProcess {
  readonly exitCodes: number[];
  readonly hooks: InterruptHooks;
  readonly lines: string[];
  readonly listener: () => (() => void) | null;
}

function createFakeProcess(): FakeProcess {
  const exitCodes: number[] = [];
  const lines: string[] = [];
  let current: (() => void) | null = null;
  return {
    exitCodes,
    hooks: {
      exit(code: number): void {
        exitCodes.push(code);
      },
      onInterrupt(listener: () => void): () => void {
        current = listener;
        return (): void => {
          current = null;
        };
      },
      write(text: string): void {
        lines.push(text);
      }
    },
    lines,
    listener: () => current
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRm.mockResolvedValue(undefined);
});

describe('guardReleaseInterrupt', () => {
  it('should run the cleanup once, hand it the writer and exit with 130', async () => {
    const fake = createFakeProcess();
    const onInterrupt = vi.fn((write: (text: string) => void) => {
      write('restored');
      return noopAsync();
    });
    guardReleaseInterrupt({ hooks: fake.hooks, onInterrupt });
    fake.listener()?.();
    fake.listener()?.();
    await vi.waitFor(() => {
      expect(fake.exitCodes).toEqual([INTERRUPTED_EXIT_CODE]);
    });
    expect(onInterrupt).toHaveBeenCalledOnce();
    expect(fake.lines).toEqual(['restored']);
  });

  it('should report a failed cleanup and still exit', async () => {
    const fake = createFakeProcess();
    guardReleaseInterrupt({ hooks: fake.hooks, onInterrupt: () => Promise.reject(new Error('git is gone')) });
    fake.listener()?.();
    await vi.waitFor(() => {
      expect(fake.exitCodes).toEqual([INTERRUPTED_EXIT_CODE]);
    });
    expect(fake.lines[0]).toContain('Cleaning up after Ctrl+C failed: ');
    expect(fake.lines[0]).toContain('git is gone');
  });

  it('should listen to the real SIGINT by default', () => {
    const before = process.listenerCount('SIGINT');
    const guard = guardReleaseInterrupt({ onInterrupt: noopAsync });
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    guard.stop();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('should unregister once, however often it is stopped', () => {
    const fake = createFakeProcess();
    const unregister = vi.fn();
    const guard = guardReleaseInterrupt({ hooks: { ...fake.hooks, onInterrupt: () => unregister }, onInterrupt: noopAsync });
    guard.stop();
    guard.stop();
    expect(unregister).toHaveBeenCalledOnce();
  });
});

describe('getProcessInterruptHooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should add and remove a SIGINT listener', () => {
    const hooks = getProcessInterruptHooks();
    const before = process.listenerCount('SIGINT');
    const unregister = hooks.onInterrupt(vi.fn());
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    unregister();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('should exit the process and write to standard error', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(noop as typeof process.exit);
    const writtenChunks: unknown[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writtenChunks.push(chunk);
      return true;
    });
    const hooks = getProcessInterruptHooks();
    hooks.exit(INTERRUPTED_EXIT_CODE);
    hooks.write('stopped');
    expect(exitSpy).toHaveBeenCalledWith(INTERRUPTED_EXIT_CODE);
    expect(writtenChunks).toEqual(['stopped\n']);
  });
});

describe('readWorkingTreeChanges', () => {
  it('should read the changed tracked paths and the untracked ones', async () => {
    mockExecFromRoot.mockImplementation((command) => Promise.resolve(Array.isArray(command) && command[1] === 'diff' ? 'package.json\0CHANGELOG.md\0' : 'notes.txt\0'));
    await expect(readWorkingTreeChanges()).resolves.toEqual({ changedPaths: ['package.json', 'CHANGELOG.md'], untrackedPaths: ['notes.txt'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(['git', 'diff', '--name-only', '-z', 'HEAD'], { isQuiet: true });
    expect(mockExecFromRoot).toHaveBeenCalledWith(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { isQuiet: true });
  });
});

describe('restoreWorkingTreeChanges', () => {
  function playTree(changed: string, untracked: string): void {
    mockExecFromRoot.mockImplementation((command) => {
      if (Array.isArray(command) && command[1] === 'diff') {
        return Promise.resolve(changed);
      }
      return Promise.resolve(Array.isArray(command) && command[1] === 'ls-files' ? untracked : '');
    });
  }

  it('should put back only what changed since, and delete only what appeared since', async () => {
    playTree('package.json\0own-edit.ts\0CHANGELOG.md', 'own-notes.txt\0versions.json');
    const restored = await restoreWorkingTreeChanges({ changedPaths: ['own-edit.ts'], untrackedPaths: ['own-notes.txt'] });
    expect(restored).toEqual(['CHANGELOG.md', 'package.json', 'versions.json']);
    expect(mockExecFromRoot).toHaveBeenCalledWith(['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', 'package.json', 'CHANGELOG.md'], { isQuiet: true });
    expect(mockRm).toHaveBeenCalledOnce();
    expect(mockRm).toHaveBeenCalledWith('/root/versions.json', { force: true });
  });

  it('should touch nothing when nothing changed since', async () => {
    playTree('own-edit.ts', '');
    await expect(restoreWorkingTreeChanges({ changedPaths: ['own-edit.ts'], untrackedPaths: [] })).resolves.toEqual([]);
    expect(mockExecFromRoot.mock.calls.some(([command]) => Array.isArray(command) && command[1] === 'restore')).toBe(false);
    expect(mockRm).not.toHaveBeenCalled();
  });
});

describe('renderWorkingTreeDiff', () => {
  function playTree(changed: string, untracked: string): void {
    mockExecFromRoot.mockImplementation((command) => {
      if (Array.isArray(command) && command[1] === 'diff') {
        return Promise.resolve(changed);
      }
      if (Array.isArray(command) && command[1] === 'ls-files') {
        return Promise.resolve(untracked);
      }
      return Promise.resolve(Array.isArray(command) && command[2] === 'diff' ? 'diff --git a/package.json b/package.json\n-1.0.0\n+1.0.1' : '');
    });
  }

  it('should diff only what changed since, and show only what appeared since whole', async () => {
    playTree('package.json\0own-edit.ts', 'own-notes.txt\0versions.json\0CHANGELOG.md');
    mockReadFile.mockImplementation((path) => Promise.resolve(path === '/root/versions.json' ? '{\r\n  "1.0.1": "1.0.0"\r\n}\r\n' : '# CHANGELOG\n'));
    const diff = await renderWorkingTreeDiff({ changedPaths: ['own-edit.ts'], untrackedPaths: ['own-notes.txt'] });
    expect(diff).toBe(dedent`
      diff --git a/package.json b/package.json
      -1.0.0
      +1.0.1
      new file CHANGELOG.md
      +# CHANGELOG
      new file versions.json
      +{
      +  "1.0.1": "1.0.0"
      +}
    `);
    expect(mockExecFromRoot).toHaveBeenCalledWith(['git', '--no-optional-locks', 'diff', '--no-color', 'HEAD', '--', 'package.json'], { isQuiet: true });
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });

  it('should be empty and run no diff when nothing changed since', async () => {
    playTree('own-edit.ts', '');
    await expect(renderWorkingTreeDiff({ changedPaths: ['own-edit.ts'], untrackedPaths: [] })).resolves.toBe('');
    expect(mockExecFromRoot.mock.calls.some(([command]) => Array.isArray(command) && command[2] === 'diff')).toBe(false);
  });
});
