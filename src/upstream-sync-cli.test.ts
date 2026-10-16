import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SyncDependencies } from './upstream-sync.ts';

import {
  createNodeSyncDependencies,
  parseSyncUpstreamsArguments,
  runSyncUpstreamsCli
} from './upstream-sync-cli.ts';

const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn()
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: mockSpawnSync
}));

const HTTP_NOT_FOUND = 404;
const SIGNAL_EXIT_CODE = 1;

describe('parseSyncUpstreamsArguments', () => {
  it('defaults to every entry of ./upstreams.json, targeting main', () => {
    expect(parseSyncUpstreamsArguments([])).toEqual({ baseBranch: 'main', configPath: 'upstreams.json', dryRun: false, only: [] });
  });

  it('reads every option', () => {
    expect(parseSyncUpstreamsArguments(['--dry-run', '--only=a,,b', '--base=develop', '--config=tools/upstreams.json'])).toEqual({
      baseBranch: 'develop',
      configPath: 'tools/upstreams.json',
      dryRun: true,
      only: ['a', 'b']
    });
  });

  it('falls back to the defaults for an empty value, as a workflow passes one', () => {
    expect(parseSyncUpstreamsArguments(['--base=', '--config=', '--only='])).toEqual({ baseBranch: 'main', configPath: 'upstreams.json', dryRun: false, only: [] });
  });

  it('refuses an argument it does not know', () => {
    expect(() => parseSyncUpstreamsArguments(['--dry', '--base', 'x'])).toThrow('unknown argument "--dry", "--base", "x"');
  });
});

describe('createNodeSyncDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs an executable without a shell, adding the given environment', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stderr: 'warn\n', stdout: 'out\n' });
    expect(createNodeSyncDependencies().exec('git', ['status'], { EXTRA: '1' })).toEqual({ exitCode: 0, output: 'out\nwarn\n' });
    expect(mockSpawnSync).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ env: expect.objectContaining({ EXTRA: '1' }) as unknown }));
  });

  it('reports a command that could not start, or that a signal killed, as failed', () => {
    mockSpawnSync.mockReturnValueOnce({ error: new Error('spawn gh ENOENT'), status: null, stderr: '', stdout: '' });
    expect(createNodeSyncDependencies().exec('gh', [])).toEqual({ exitCode: 1, output: 'spawn gh ENOENT' });
    mockSpawnSync.mockReturnValueOnce({ status: null, stderr: '', stdout: '' });
    expect(createNodeSyncDependencies().exec('git', []).exitCode).toBe(SIGNAL_EXIT_CODE);
  });

  it('runs a handler through the shell and echoes it', () => {
    mockSpawnSync.mockReturnValue({ status: 2, stderr: 'boom\n', stdout: '' });
    expect(createNodeSyncDependencies().shell('npm run sync', { UPSTREAM_NAME: 'x' })).toEqual({ exitCode: 2, output: 'boom\n' });
    expect(mockSpawnSync).toHaveBeenCalledWith('npm run sync', expect.objectContaining({ shell: true }));
    expect(process.stdout.write).toHaveBeenCalledWith('> npm run sync\n');
    expect(process.stdout.write).toHaveBeenCalledWith('boom\n');
  });

  it('logs a line to stdout', () => {
    createNodeSyncDependencies().log('hello');
    expect(process.stdout.write).toHaveBeenCalledWith('hello\n');
  });

  it('sends GITHUB_TOKEN to the GitHub API only', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'secret');
    const mockFetch = vi.fn(() => Promise.resolve(new Response('{"ok":true}')));
    vi.stubGlobal('fetch', mockFetch);
    const dependencies = createNodeSyncDependencies();

    expect(await dependencies.fetchJson('https://api.github.com/repos/a/b')).toEqual({ ok: true });
    await dependencies.fetchJson('https://registry.npmjs.org/x');
    expect(mockFetch.mock.calls).toEqual([
      ['https://api.github.com/repos/a/b', { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer secret' } }],
      ['https://registry.npmjs.org/x', { headers: { Accept: 'application/vnd.github+json' } }]
    ]);
  });

  it('sends no token when none is set, and throws on an HTTP error', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const mockFetch = vi.fn(() => Promise.resolve(new Response('', { status: HTTP_NOT_FOUND })));
    vi.stubGlobal('fetch', mockFetch);

    await expect(createNodeSyncDependencies().fetchJson('https://api.github.com/x')).rejects.toThrow('GET https://api.github.com/x failed: HTTP 404.');
    expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/x', { headers: { Accept: 'application/vnd.github+json' } });
  });
});

describe('runSyncUpstreamsCli', () => {
  let directory = '';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'upstream-sync-cli-'));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  function createDependencies(head: string): SyncDependencies {
    return {
      exec: () => ({ exitCode: 0, output: '' }),
      fetchJson: async (url): Promise<unknown> => {
        await noopAsync();
        if (url.endsWith('/broken')) {
          throw new Error('offline');
        }
        return { 'dist-tags': { latest: head } };
      },
      log: vi.fn(),
      shell: () => ({ exitCode: 0, output: '' })
    };
  }

  it('exits 0 when every entry is current, and 1 when any entry failed', async () => {
    const configPath = join(directory, 'upstreams.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        upstreams: [
          { handler: 'h', name: 'lib', npm: 'lib', version: '1.0.0' },
          { handler: 'h', name: 'broken', npm: 'broken', version: '1.0.0' }
        ]
      })
    );

    expect(await runSyncUpstreamsCli([`--config=${configPath}`, '--only=lib'], createDependencies('1.0.0'))).toBe(0);
    expect(await runSyncUpstreamsCli([`--config=${configPath}`], createDependencies('1.0.0'))).toBe(1);
  });

  it('prints a wrong argument or config without a stack trace, and exits 1', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(await runSyncUpstreamsCli(['--bogus'], createDependencies('1.0.0'))).toBe(1);
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^sync-upstreams: unknown argument "--bogus"/) as unknown);
    expect(await runSyncUpstreamsCli([`--config=${join(directory, 'missing.json')}`], createDependencies('1.0.0'))).toBe(1);
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining('missing.json') as unknown);
    write.mockRestore();
  });

  it('prints a thrown non-error as it is', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const dependencies = createDependencies('1.0.0');
    const configPath = join(directory, 'upstreams.json');
    // The entry's own error report calls log again, so the throw escapes the sync.
    dependencies.log = (): void => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- The case under test.
      throw 'odd';
    };
    writeFileSync(configPath, JSON.stringify({ upstreams: [{ handler: 'h', name: 'lib', npm: 'lib', version: '1.0.0' }] }));
    expect(await runSyncUpstreamsCli([`--config=${configPath}`], dependencies)).toBe(1);
    expect(write).toHaveBeenCalledWith('odd\n');
    write.mockRestore();
  });

  it('uses the real outside world when given none', async () => {
    const configPath = join(directory, 'upstreams.json');
    writeFileSync(configPath, JSON.stringify({ upstreams: [] }));
    expect(await runSyncUpstreamsCli([`--config=${configPath}`])).toBe(0);
  });
});
