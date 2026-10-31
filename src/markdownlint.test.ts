import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  join,
  resolve
} from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolveToolCommandParams } from './package-manager.ts';
import type { ResolvePathFromRootSafeParams } from './root.ts';

import { lint } from './linters/markdownlint.ts';

const {
  mockCp,
  mockExecFromRoot,
  mockExistsSync,
  mockGetNonIgnoredFiles,
  mockGetRootFolder,
  mockGlob,
  mockMkdtemp,
  mockReadFile,
  mockResolvePathFromRootSafe,
  mockResolveToolCommand,
  mockRm,
  mockWriteFile
} = vi.hoisted(() => ({
  mockCp: vi.fn(),
  mockExecFromRoot: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockGetNonIgnoredFiles: vi.fn<() => Promise<null | string[]>>(),
  mockGetRootFolder: vi.fn<(cwd?: string) => null | string>(),
  mockGlob: vi.fn(),
  mockMkdtemp: vi.fn<(prefix: string) => Promise<string>>(),
  mockReadFile: vi.fn<(path: string) => Promise<string>>(),
  mockResolvePathFromRootSafe: vi.fn<(params: ResolvePathFromRootSafeParams) => string>(),
  mockResolveToolCommand: vi.fn<(params: ResolveToolCommandParams) => string[]>(),
  mockRm: vi.fn(),
  mockWriteFile: vi.fn<(path: string, content: string) => Promise<void>>()
}));

vi.mock('./env-toggle.ts', () => ({
  loadEnvFileIfExists: vi.fn()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  getRootFolder: mockGetRootFolder,
  resolvePathFromRootSafe: mockResolvePathFromRootSafe
}));

vi.mock('./package-manager.ts', () => ({
  resolveToolCommand: mockResolveToolCommand
}));

vi.mock('./git.ts', () => ({
  getNonIgnoredFiles: mockGetNonIgnoredFiles
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
    glob: mockGlob,
    mkdtemp: mockMkdtemp,
    readFile: mockReadFile,
    rm: mockRm,
    writeFile: mockWriteFile
  };
});

vi.mock('@mnaoumov/typescript-lib/debug', () => ({
  getLibDebugger: vi.fn(() => vi.fn())
}));

beforeEach(() => {
  vi.stubEnv('BULK_CORES', undefined);
  vi.stubEnv('LINK_CHECK_SKIP', undefined);
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
  mockCp.mockResolvedValue(undefined);
  // Default to "git cannot answer" so the existing cases keep exercising the glob fallback they assert on.
  mockGetNonIgnoredFiles.mockResolvedValue(null);
  mockResolvePathFromRootSafe.mockImplementation((params: ResolvePathFromRootSafeParams) => `/root/${params.path}`);
  mockResolveToolCommand.mockImplementation((params: ResolveToolCommandParams) => [params.tool]);
  mockGlob.mockReturnValue((async function* generateMdFiles(): AsyncGenerator<string, void> {
    await noopAsync();
    yield 'README.md';
  })());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('lint', () => {
  it('should run markdownlint-cli2 and linkinator when config file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledTimes(2);
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['markdownlint-cli2', { batchedArguments: ['.'] }])
    );
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md'] }])
    );
  });

  // A rate-limited host (forum.obsidian.md answering CI with 429) failed the check over links that exist.
  it('should retry linkinator errors with a seconds-wide jitter and only warn on a lasting 429', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', '--retry-errors', '--retry-errors-count', '3', '--retry-errors-jitter', '5000', '--status-code', '429:warn', '--status-code', '408:warn', '--timeout', '30000'])
    );
    expect(mockExecFromRoot.mock.calls[1]?.[0]).not.toContain('--retry');
  });

  it.each([[undefined, '100'], ['2', '2'], ['bad', '100'], ['200', '100']])('caps linkinator concurrency for budget %s', async (budget, expected) => {
    vi.stubEnv('BULK_CORES', budget);
    mockExistsSync.mockReturnValue(true);
    await lint();
    expect(mockExecFromRoot.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(['--concurrency', expected]));
  });

  it('propagates a failed linkinator run, including exhausted request timeouts', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFromRoot.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('linkinator timeout'));
    await expect(lint()).rejects.toThrow('linkinator timeout');
  });

  it('should pass --fix when shouldFix is true', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint({ shouldFix: true });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['markdownlint-cli2', '--fix', { batchedArguments: ['.'] }])
    );
  });

  it('should not pass --fix when shouldFix is false', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint({ shouldFix: false });
    const firstCall = mockExecFromRoot.mock.calls[0] as string[][];
    expect(firstCall[0]).not.toContain('--fix');
  });

  it('should copy the default config it is given when no config file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    await lint({ defaultConfigFilePath: '/pkg/dist/templates/.markdownlint-cli2.mjs' });
    expect(mockCp).toHaveBeenCalledTimes(1);
    expect(mockCp).toHaveBeenCalledWith('/pkg/dist/templates/.markdownlint-cli2.mjs', '/root/.markdownlint-cli2.mjs');
    expect(mockExecFromRoot).toHaveBeenCalledTimes(2);
  });

  it('should lint without copying anything when no config file exists and no default is given', async () => {
    mockExistsSync.mockReturnValue(false);
    await lint();
    expect(mockCp).not.toHaveBeenCalled();
    expect(mockExecFromRoot).toHaveBeenCalledTimes(2);
  });

  it('should link-check the non-ignored markdown files git reports', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue(['README.md', 'docs/guide.md']);
    await lint();
    expect(mockGetNonIgnoredFiles).toHaveBeenCalledWith({ patterns: ['*.md'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md', 'docs/guide.md'] }])
    );
  });

  // Git only skips what the repository asked it to skip, and `obsidian-codescript-toolkit` deliberately
  // TRACKS a vendored `node_modules` tree so its demo vault can `require('uuid')` offline. Third-party
  // Markdown is not ours to link-check — the vendored README's relative link to an upstream-only file
  // failed the whole gate.
  it('should drop vendored node_modules markdown from the list git reports', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue([
      'README.md',
      'demo-vault/_assets/CodeScriptToolkit/node_modules/uuid/README.md',
      'docs/guide.md'
    ]);
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md', 'docs/guide.md'] }])
    );
  });

  it('should keep a file whose own name merely contains the words', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue(['docs/node_modules-migration.md']);
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['docs/node_modules-migration.md'] }])
    );
  });

  it('should prefer git over the glob fallback', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue(['README.md']);
    await lint();
    expect(mockGlob).not.toHaveBeenCalled();
  });

  it('should fall back to the glob when git cannot answer', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue(null);
    await lint();
    expect(mockGlob).toHaveBeenCalledOnce();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md'] }])
    );
  });

  // A Starlight site's guides link to each other as `/<site-base>/guides/...`, which resolves only against
  // the built site, so linkinator reports every one as a 404.
  it('should leave linkCheckExcludeGlobs matches out of the linkinator pass only', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetNonIgnoredFiles.mockResolvedValue(['README.md', 'docs/src/content/docs/guides/setup.md', 'docs.md']);
    await lint({ linkCheckExcludeGlobs: ['docs/**'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['markdownlint-cli2', { batchedArguments: ['.'] }])
    );
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md', 'docs.md'] }])
    );
  });

  it('should apply linkCheckExcludeGlobs to the glob fallback', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlob.mockReturnValue((async function* generateMdFiles(): AsyncGenerator<string, void> {
      await noopAsync();
      yield 'README.md';
      yield 'site/guide.md';
    })());
    await lint({ linkCheckExcludeGlobs: ['CHANGELOG.md', 'site/**'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md'] }])
    );
  });

  it('should apply linkCheckExcludeGlobs to explicit paths', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetRootFolder.mockReturnValue('/root');
    await lint({ linkCheckExcludeGlobs: ['docs/**'], paths: ['/root/README.md', '/root/docs/guide.md'] });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['markdownlint-cli2', { batchedArguments: ['/root/README.md', '/root/docs/guide.md'] }])
    );
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md'] }])
    );
  });

  // Given one file, linkinator served that file's own folder, so a staged `docs/write-up.md` 404'd its
  // `../THIRD-PARTY-NOTICES.md` link in the pre-commit hook while the whole-repo lint passed.
  it('should serve linkinator from the absolute root folder, so a lone file resolves links above its folder', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetRootFolder.mockReturnValue('/root');
    await lint({ paths: ['/root/docs/write-up.md'] });
    expect(mockExecFromRoot.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining(['linkinator', '--server-root', resolve('/root'), { batchedArguments: ['docs/write-up.md'] }])
    );
  });

  // `linkinator` with no location prints its usage and exits non-zero, failing the whole lint.
  it('should skip linkinator when linkCheckExcludeGlobs excludes every path', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGetRootFolder.mockReturnValue('/root');
    await lint({ linkCheckExcludeGlobs: ['docs/**'], paths: ['/root/docs/guide.md'] });
    expect(mockExecFromRoot).toHaveBeenCalledOnce();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['markdownlint-cli2', { batchedArguments: ['/root/docs/guide.md'] }])
    );
  });

  describe('LINK_CHECK_SKIP', () => {
    const skipConfigFolder = join('/tmp', 'link-check-skip-x');
    const skipConfigPath = join(skipConfigFolder, 'linkinator.config.json');

    beforeEach(() => {
      vi.stubEnv('LINK_CHECK_SKIP', 'mail.tm,unused.example');
      mockGetRootFolder.mockReturnValue('/root');
      mockMkdtemp.mockResolvedValue(skipConfigFolder);
      mockReadFile.mockImplementation(async (path) => {
        await noopAsync();
        return path.endsWith('linkinator.config.json') ? '{"recurse":true,"skip":"x"}' : '[faq](https://mail.tm/en/faq/)';
      });
    });

    function getLinkinatorCall(): unknown[] {
      return mockExecFromRoot.mock.calls[1]?.[0] as unknown[];
    }

    // The patterns go in a config file: as `--skip` arguments, the `|` in them broke the Windows `npx` shim chain.
    it('skips the entries through a temporary config file, warns, and removes the folder', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      mockExistsSync.mockImplementation((path) => !path.endsWith('linkinator.config.json'));
      await lint();
      expect(getLinkinatorCall()).toEqual(expect.arrayContaining(['--config', skipConfigPath]));
      expect(getLinkinatorCall()).not.toContain('--skip');
      const [writtenPath, content = ''] = mockWriteFile.mock.calls[0] ?? [];
      expect(writtenPath).toBe(skipConfigPath);
      expect(JSON.parse(content)).toEqual({ skip: [expect.stringContaining(String.raw`mail\.tm`), expect.stringContaining(String.raw`unused\.example`)] });
      expect(warn.mock.calls.map(([message]): unknown => message)).toEqual([
        'WARNING: LINK_CHECK_SKIP skips https://mail.tm/en/faq/ in README.md (entry mail.tm).',
        'WARNING: LINK_CHECK_SKIP entry unused.example matched no link; remove it.',
        expect.stringContaining('Set it for one command only')
      ]);
      expect(mockRm).toHaveBeenCalledWith(skipConfigFolder, { force: true, recursive: true });
    });

    it('carries the project linkinator.config.json over', async () => {
      vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      mockExistsSync.mockReturnValue(true);
      await lint();
      const content = mockWriteFile.mock.calls[0]?.[1] ?? '';
      expect(JSON.parse(content)).toEqual({ recurse: true, skip: ['x', expect.any(String), expect.any(String)] });
    });

    it('removes the folder when linkinator fails', async () => {
      vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      mockExistsSync.mockReturnValue(true);
      mockExecFromRoot.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('broken links'));
      await expect(lint()).rejects.toThrow('broken links');
      expect(mockRm).toHaveBeenCalledWith(skipConfigFolder, { force: true, recursive: true });
    });

    it('passes no config and writes nothing when the variable is unset', async () => {
      vi.stubEnv('LINK_CHECK_SKIP', '');
      mockExistsSync.mockReturnValue(true);
      await lint();
      expect(getLinkinatorCall()).not.toContain('--config');
      expect(mockMkdtemp).not.toHaveBeenCalled();
      expect(mockRm).not.toHaveBeenCalled();
    });
  });

  it('should handle multiple markdown files from glob', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlob.mockReturnValue((async function* generateMultipleMdFiles(): AsyncGenerator<string, void> {
      await noopAsync();
      yield 'README.md';
      yield 'CHANGELOG.md';
      yield 'docs/guide.md';
    })());
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['linkinator', { batchedArguments: ['README.md', 'CHANGELOG.md', 'docs/guide.md'] }])
    );
  });
});
