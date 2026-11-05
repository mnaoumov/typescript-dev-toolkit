import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  RewriteChangelogCommandResult,
  RewriteChangelogDependencies
} from './changelog-rewrite-cli.ts';

import {
  createNodeRewriteChangelogDependencies,
  parseRewriteChangelogArguments,
  runRewriteChangelogCli
} from './changelog-rewrite-cli.ts';

const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn()
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: mockSpawnSync
}));

const CHANGELOG = '# CHANGELOG\n\n## 3.0.0\n\n- fix: three\n\n## 2.0.0\n\n- fix: two\n\n## 1.0.0\n\nWritten by hand.\n\n## 0.1.0\n\n- feat: start\n';

interface FakeDependencies extends RewriteChangelogDependencies {
  readonly lines: string[];
  readonly written: Map<string, string>;
}

interface FakeOptions {
  readonly editExitCode?: number;
  readonly logExitCode?: number;
  readonly releaseBodies?: Record<string, string>;
  readonly releasesExitCode?: number;
  readonly tagExitCode?: number;
}

function fake(options: FakeOptions = {}): FakeDependencies {
  const lines: string[] = [];
  const written = new Map<string, string>();
  const releaseBodies = options.releaseBodies ?? {};
  return {
    exec(file, arguments_, input): RewriteChangelogCommandResult {
      const command = [file, ...arguments_].join(' ');
      if (command === 'git tag --list') {
        return { exitCode: options.tagExitCode ?? 0, stderr: 'not a git repository\n', stdout: '0.1.0\r\n2.0.0\n' };
      }
      if (command === 'git log --format=%B --first-parent -z 1.0.0..2.0.0') {
        throw new Error('2.0.0 has no tagged predecessor, so its range must not be read');
      }
      if (command.startsWith('git log')) {
        return { exitCode: options.logExitCode ?? 0, stderr: 'bad revision\n', stdout: 'feat: start\n\nRefs #1\n\0\n\0' };
      }
      if (command.startsWith('gh api --paginate repos/{owner}/{repo}/releases')) {
        const stdout = Object.entries(releaseBodies).map(([tag, body]) => `${JSON.stringify({ body, tag })}\r\n`).join('\n');
        return { exitCode: options.releasesExitCode ?? 0, stderr: 'HTTP 404\n', stdout };
      }
      lines.push(`${command} <<< ${String(input)}`);
      return { exitCode: options.editExitCode ?? 0, stderr: 'HTTP 403\n', stdout: '' };
    },
    lines,
    log(text): void {
      lines.push(text);
    },
    readFile(): string {
      return CHANGELOG;
    },
    writeFile(path, content): void {
      written.set(path, content);
    },
    written
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  mockSpawnSync.mockReset();
});

describe('parseRewriteChangelogArguments', () => {
  it('should default to a dry run of ./CHANGELOG.md', () => {
    expect(parseRewriteChangelogArguments([])).toEqual({ changelogPath: 'CHANGELOG.md', shouldOverwriteEditedReleases: false, shouldRewriteReleases: false, shouldWrite: false });
    expect(parseRewriteChangelogArguments(['--path='])).toEqual({ changelogPath: 'CHANGELOG.md', shouldOverwriteEditedReleases: false, shouldRewriteReleases: false, shouldWrite: false });
  });

  it('should read every option', () => {
    expect(parseRewriteChangelogArguments(['--write', '--releases', '--overwrite-edited-releases', '--path=docs/CHANGELOG.md'])).toEqual({
      changelogPath: 'docs/CHANGELOG.md',
      shouldOverwriteEditedReleases: true,
      shouldRewriteReleases: true,
      shouldWrite: true
    });
  });

  it('should refuse an unknown argument', () => {
    expect(() => parseRewriteChangelogArguments(['--dry-run', '-w'])).toThrow(
      'rewrite-changelog: unknown argument "--dry-run", "-w". Known: --write, --releases, --overwrite-edited-releases, --path=.'
    );
  });
});

describe('runRewriteChangelogCli', () => {
  it('should report and write nothing on a dry run', async () => {
    const dependencies = fake({ releaseBodies: { '0.1.0': '- feat: start\n\n**Full Changelog**: https://example.com/commits/0.1.0' } });

    expect(await runRewriteChangelogCli(['--releases'], dependencies)).toBe(0);

    expect(dependencies.written.size).toBe(0);
    expect(dependencies.lines).toEqual([
      '3.0.0: rewritten, 0 of 1 bullets matched to commits, no tag, so grouped from the bullets alone',
      '2.0.0: rewritten, 0 of 1 bullets matched to commits',
      '0.1.0: rewritten, 1 of 1 bullets matched to commits',
      '1.0.0: kept, the section is not a plain bullet list, so a person wrote or edited it',
      'CHANGELOG.md: dry run, nothing written (pass --write to apply)',
      'release 2.0.0: left alone, the repository has no GitHub release for it',
      'release 0.1.0: would be rewritten'
    ]);
  });

  it('should write the changelog and edit the releases whose notes are unchanged', async () => {
    const dependencies = fake({
      releaseBodies: {
        '0.1.0': '- feat: start\n\n**Full Changelog**: https://example.com/commits/0.1.0',
        '2.0.0': '- fix: two, explained later'
      }
    });

    expect(await runRewriteChangelogCli(['--write', '--releases'], dependencies)).toBe(0);

    expect(dependencies.written.get('CHANGELOG.md')).toBe(
      '# CHANGELOG\n\n## 3.0.0\n\nThis release has 1 fix.\n\n### Fixed\n\n- three\n\n## 2.0.0\n\nThis release has 1 fix.\n\n### Fixed\n\n- two\n\n## 1.0.0\n\nWritten by hand.\n\n## 0.1.0\n\nThis release has 1 new feature.\n\n### New\n\n- start (#1)\n'
    );
    expect(dependencies.lines.slice(4)).toEqual([
      'CHANGELOG.md: written',
      'release 2.0.0: left alone, its notes are not the changelog section as it was (--overwrite-edited-releases rewrites it)',
      'gh release edit 0.1.0 --notes-file - <<< This release has 1 new feature.\n\n### New\n\n- start (#1)\n\n**Full Changelog**: https://example.com/commits/0.1.0',
      'release 0.1.0: rewritten'
    ]);
  });

  it('should read the range between two tagged sections', async () => {
    const dependencies = { ...fake(), readFile: (): string => '## 2.0.0\n\n- feat: start\n\n## 0.1.0\n\n- feat: start\n' };

    expect(await runRewriteChangelogCli([], dependencies)).toBe(0);

    expect(dependencies.lines.slice(0, 2)).toEqual([
      '2.0.0: rewritten, 1 of 1 bullets matched to commits',
      '0.1.0: rewritten, 1 of 1 bullets matched to commits'
    ]);
  });

  it('should rewrite a release edited after publishing when asked to', async () => {
    const dependencies = fake({ releaseBodies: { '2.0.0': '- fix: two, explained later' } });

    expect(await runRewriteChangelogCli(['--write', '--releases', '--overwrite-edited-releases'], dependencies)).toBe(0);

    expect(dependencies.lines).toContain('gh release edit 2.0.0 --notes-file - <<< This release has 1 fix.\n\n### Fixed\n\n- two');
  });

  it('should fail when a release edit fails, and leave the releases alone without --releases', async () => {
    const failing = fake({ editExitCode: 1, releaseBodies: { '0.1.0': '- feat: start' } });
    expect(await runRewriteChangelogCli(['--write', '--releases'], failing)).toBe(1);
    expect(failing.lines.at(-1)).toBe('release 0.1.0: the edit FAILED: HTTP 403');

    const withoutReleases = fake({ releaseBodies: { '0.1.0': '- feat: start' } });
    expect(await runRewriteChangelogCli(['--write'], withoutReleases)).toBe(0);
    expect(withoutReleases.lines.some((line) => line.startsWith('release '))).toBe(false);
  });

  it('should report a git failure or a wrong argument as a message and exit 1', async () => {
    const stderrTexts: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((text) => {
      stderrTexts.push(String(text));
      return true;
    });

    expect(await runRewriteChangelogCli([], fake({ tagExitCode: 128 }))).toBe(1);
    expect(await runRewriteChangelogCli([], fake({ logExitCode: 128 }))).toBe(1);
    expect(await runRewriteChangelogCli(['--releases'], fake({ releasesExitCode: 1 }))).toBe(1);
    expect(await runRewriteChangelogCli(['--bogus'], fake())).toBe(1);
    const throwing = {
      ...fake(),
      readFile: (): string => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- The case under test.
        throw 'unreadable';
      }
    };
    expect(await runRewriteChangelogCli([], throwing)).toBe(1);

    expect(stderrTexts).toEqual([
      'rewrite-changelog: git tag --list failed: not a git repository\n',
      'rewrite-changelog: git log --format=%B --first-parent -z 0.1.0 failed: bad revision\n',
      'rewrite-changelog: gh api --paginate repos/{owner}/{repo}/releases?per_page=100 --jq .[] | {tag: .tag_name, body: (.body // "")} failed: HTTP 404\n',
      'rewrite-changelog: unknown argument "--bogus". Known: --write, --releases, --overwrite-edited-releases, --path=.\n',
      'unreadable\n'
    ]);
  });
});

describe('createNodeRewriteChangelogDependencies', () => {
  it('should run commands through spawnSync and turn its result into a command result', () => {
    const dependencies = createNodeRewriteChangelogDependencies();

    mockSpawnSync.mockReturnValueOnce({ status: 0, stderr: 'warn', stdout: 'out' });
    expect(dependencies.exec('git', ['tag'], 'in')).toEqual({ exitCode: 0, stderr: 'warn', stdout: 'out' });
    expect(mockSpawnSync).toHaveBeenCalledWith('git', ['tag'], { encoding: 'utf-8', input: 'in', maxBuffer: Number.MAX_SAFE_INTEGER });

    mockSpawnSync.mockReturnValueOnce({ status: null, stderr: '', stdout: '' });
    expect(dependencies.exec('git', [])).toEqual({ exitCode: 1, stderr: '', stdout: '' });

    mockSpawnSync.mockReturnValueOnce({ error: new Error('spawn gh ENOENT') });
    expect(dependencies.exec('gh', [])).toEqual({ exitCode: 1, stderr: 'spawn gh ENOENT', stdout: '' });
  });

  it('should read and write files and log to stdout', () => {
    const stdoutTexts: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
      stdoutTexts.push(String(text));
      return true;
    });
    const directory = mkdtempSync(join(tmpdir(), 'rewrite-changelog-'));
    try {
      const dependencies = createNodeRewriteChangelogDependencies();
      const path = join(directory, 'CHANGELOG.md');
      dependencies.writeFile(path, '# CHANGELOG\n');
      expect(readFileSync(path, 'utf-8')).toBe('# CHANGELOG\n');
      expect(dependencies.readFile(path)).toBe('# CHANGELOG\n');
      dependencies.log('line');
      expect(stdoutTexts).toEqual(['line\n']);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
