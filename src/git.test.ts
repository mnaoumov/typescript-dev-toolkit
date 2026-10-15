import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getNonIgnoredFiles,
  readIndexContent
} from './git.ts';

interface FakeChild extends EventEmitter {
  stderr: PassThrough;
  stdout: PassThrough;
}

const { mockExecFromRoot, mockSpawn } = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: unknown, options?: unknown) => Promise<string>>(),
  mockSpawn: vi.fn()
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: mockSpawn
}));

vi.mock('./root.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./root.ts')>(),
  execFromRoot: mockExecFromRoot
}));

describe('getNonIgnoredFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should ask git for tracked and untracked-but-not-ignored files', async () => {
    mockExecFromRoot.mockResolvedValue('');
    await getNonIgnoredFiles();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { isQuiet: true }
    );
  });

  it('should pass the patterns as a pathspec', async () => {
    mockExecFromRoot.mockResolvedValue('');
    await getNonIgnoredFiles({ patterns: ['*.md', '*.mdx'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md', '*.mdx'],
      { isQuiet: true }
    );
  });

  it('should split the NUL-separated output', async () => {
    mockExecFromRoot.mockResolvedValue('README.md\0docs/guide.md\0');
    expect(await getNonIgnoredFiles()).toEqual(['README.md', 'docs/guide.md']);
  });

  it('should return an empty array when git reports no files', async () => {
    mockExecFromRoot.mockResolvedValue('');
    expect(await getNonIgnoredFiles()).toEqual([]);
  });

  it('should deduplicate paths git lists more than once', async () => {
    mockExecFromRoot.mockResolvedValue('README.md\0README.md\0docs/guide.md\0');
    expect(await getNonIgnoredFiles()).toEqual(['README.md', 'docs/guide.md']);
  });

  it('should return null when git is unavailable or the folder is not a repository', async () => {
    mockExecFromRoot.mockRejectedValue(new Error('not a git repository'));
    expect(await getNonIgnoredFiles()).toBeNull();
  });
});

function makeFakeChild(): FakeChild {
  // eslint-disable-next-line unicorn/prefer-event-target -- This stands in for a Node `ChildProcess`, which IS an `EventEmitter`. The code under test calls `.on(...)`, so an `EventTarget` would not be a substitute.
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  mockSpawn.mockReturnValue(child);
  return child;
}

describe('readIndexContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run git cat-file on the stage-0 path without a shell', async () => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'src/a.ts');
    child.emit('close', 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith('git', ['-C', '/repo', 'cat-file', 'blob', ':./src/a.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  });

  it('should concatenate the stdout chunks as raw bytes', async () => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'a.bin');
    child.stdout.emit('data', Buffer.from([0x00, 0xFE]));
    child.stdout.emit('data', Buffer.from([0xFF, 0x0A]));
    child.emit('close', 0);
    expect(await promise).toEqual(Buffer.from([0x00, 0xFE, 0xFF, 0x0A]));
  });

  it.each([
    'fatal: path \'a.ts\' does not exist (neither on disk nor in the index)',
    'fatal: path \'a.ts\' exists on disk, but not in the index',
    'fatal: Not a valid object name :./a.ts'
  ])('should answer null when git reports no index entry: %s', async (message) => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'a.ts');
    child.stderr.emit('data', Buffer.from(message));
    child.emit('close', 128);
    expect(await promise).toBeNull();
  });

  it('should reject with the exit code and stderr on any other failure', async () => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'a.ts');
    child.stderr.emit('data', Buffer.from('fatal: not a git repository\n'));
    child.emit('close', 128);
    await expect(promise).rejects.toThrow('`git cat-file blob :./a.ts` failed with exit code 128:\nfatal: not a git repository');
  });

  it('should report a null exit code when git was killed by a signal', async () => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'a.ts');
    child.emit('close', null);
    await expect(promise).rejects.toThrow('failed with exit code (null)');
  });

  it('should reject when git cannot be spawned', async () => {
    const child = makeFakeChild();
    const promise = readIndexContent('/repo', 'a.ts');
    const cause = new Error('spawn git ENOENT');
    child.emit('error', cause);
    await expect(promise).rejects.toThrow('Could not run `git cat-file` for a.ts.');
    await expect(promise).rejects.toMatchObject({ cause });
  });
});
