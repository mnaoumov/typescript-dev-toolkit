import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type {
  CommandResult,
  GitUpstreamEntry,
  NpmUpstreamEntry,
  SyncDependencies,
  UpstreamsConfig
} from './upstream-sync.ts';

import {
  buildPrBody,
  cleanCommandOutput,
  compareWithUpstream,
  parseUpstreamsConfig,
  planSync,
  syncUpstreams
} from './upstream-sync.ts';

const SHA_LENGTH = 40;
const SHORT_SHA_LENGTH = 12;
const PIN = 'a'.repeat(SHA_LENGTH);
const HEAD = 'b'.repeat(SHA_LENGTH);
const REPO = 'acme/upstream';
const COMPARE_FILE_LIMIT = 300;
const JSON_INDENT_SPACES = 2;
const CREATED_PR_NUMBER = 7;
const OPEN_PR_NUMBER = 12;
const HANDLER_EXIT_CODE = 2;
/**
What git ls-remote --exit-code exits with when the branch does not exist.
*/
const NO_REMOTE_BRANCH_EXIT_CODE = 2;

const GIT_ENTRY: GitUpstreamEntry = { commit: PIN, handler: 'npm run sync:git', name: 'docs', paths: ['en/**/*.md'], ref: 'main', repo: REPO, verify: 'npm test' };
const NPM_ENTRY: NpmUpstreamEntry = { handler: 'npm run sync:npm', name: 'lib', npm: '@acme/lib', version: '1.0.0' };

const FIXTURE: UpstreamsConfig = {
  upstreams: [GIT_ENTRY, NPM_ENTRY],
  verify: 'npm run lint'
};

/**
One file of a GitHub compare, as the API spells it.
*/
interface CompareFile {
  readonly filename: string;

  readonly previous_filename?: string;
}

interface FakeWorld {
  readonly calls: string[];
  readonly dependencies: MutableSyncDependencies;
  readonly logs: string[];
}

interface FakeWorldOptions {
  /**
  Changed files the compare API reports.
  */
  readonly compareFiles?: readonly CompareFile[];
  /**
  The handler's exit code.
  */
  readonly handlerExitCode?: number;
  /**
  The open PR number `gh pr list` reports, or `''` for none.
  */
  readonly openPr?: string;
  /**
  Whether `upstream/<name>` already exists on origin with this exact tree.
  */
  readonly remoteBranchSame?: boolean;
}

// Each test replaces the dependencies needed for its scenario.
type MutableSyncDependencies = { -readonly [Key in keyof SyncDependencies]: SyncDependencies[Key] };

/**
Stands a fixture in for GitHub, npm, git and gh, recording every command run.
*/
function createFakeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const calls: string[] = [];
  const logs: string[] = [];
  const dependencies: MutableSyncDependencies = {
    exec(file, arguments_) {
      const line = `${file} ${arguments_.join(' ')}`;
      calls.push(line);
      if (line.startsWith('git ls-remote')) {
        return { exitCode: options.remoteBranchSame === undefined ? NO_REMOTE_BRANCH_EXIT_CODE : 0, output: '' };
      }
      if (line.startsWith('git diff --quiet')) {
        return { exitCode: options.remoteBranchSame ? 0 : 1, output: '' };
      }
      if (line.startsWith('git diff --stat')) {
        return ok(' templates/x.md | 2 +-\n 1 file changed\n');
      }
      if (line.startsWith('gh pr list')) {
        return ok(`${options.openPr ?? ''}\n`);
      }
      return line.startsWith('gh pr create') ? ok(`https://github.com/me/repo/pull/${String(CREATED_PR_NUMBER)}\n`) : ok();
    },
    fetchJson(url) {
      if (url === `https://api.github.com/repos/${REPO}/commits/main`) {
        return Promise.resolve({ sha: HEAD });
      }
      if (url === `https://api.github.com/repos/${REPO}/compare/${PIN}...${HEAD}`) {
        return Promise.resolve({ files: options.compareFiles ?? [{ filename: 'en/Plugins/Intro.md' }, { filename: 'README.md' }] });
      }
      return url === 'https://registry.npmjs.org/@acme%2flib' ? Promise.resolve({ 'dist-tags': { latest: '1.0.0' } }) : Promise.reject(new Error(`unexpected GET ${url}`));
    },
    log(text) {
      logs.push(text);
    },
    shell(command) {
      calls.push(`sh ${command}`);
      return command === 'npm run sync:git' && options.handlerExitCode !== undefined
        ? { exitCode: options.handlerExitCode, output: 'TS2304: Cannot find name \'Foo\'.\n' }
        : ok(`${command} ok\n`);
    }
  };
  return { calls, dependencies, logs };
}

function ok(output = ''): CommandResult {
  return { exitCode: 0, output };
}

let directory = '';
let configPath = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'upstream-sync-'));
  configPath = join(directory, 'upstreams.json');
  writeFileSync(configPath, `${JSON.stringify(FIXTURE, null, JSON_INDENT_SPACES)}\n`);
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

describe('parseUpstreamsConfig', () => {
  it('accepts git and npm entries', () => {
    const config = parseUpstreamsConfig(JSON.stringify(FIXTURE));
    expect(config.upstreams.map((entry) => entry.name)).toEqual(['docs', 'lib']);
    expect(config.verify).toBe('npm run lint');
  });

  it('refuses an entry without a handler, and a name used twice', () => {
    expect(() => parseUpstreamsConfig(JSON.stringify({ upstreams: [{ commit: PIN, name: 'x', paths: [], ref: 'main', repo: REPO }] }))).toThrow('"handler"');
    const entry = { handler: 'h', name: 'x', npm: 'x', version: '1.0.0' };
    expect(() => parseUpstreamsConfig(JSON.stringify({ upstreams: [entry, entry] }))).toThrow('used twice');
  });

  it('refuses a file without an upstreams array, a git entry without paths, and names an entry without a name', () => {
    expect(() => parseUpstreamsConfig('{}')).toThrow('no "upstreams" array');
    expect(() => parseUpstreamsConfig(JSON.stringify({ upstreams: [{ commit: PIN, handler: 'h', name: 'x', ref: 'main', repo: REPO }] }))).toThrow(
      'entry "x" needs a "paths" array'
    );
    expect(() => parseUpstreamsConfig(JSON.stringify({ upstreams: [{ handler: 'h', npm: 'x', version: '1.0.0' }] }))).toThrow(
      'entry with no name needs a string "name"'
    );
  });
});

describe('compareWithUpstream', () => {
  it('keeps only the watched paths a move changed, including a rename\'s old path', async () => {
    // eslint-disable-next-line camelcase -- The GitHub API's name.
    const renamed: CompareFile = { filename: 'docs/New.md', previous_filename: 'en/Old.md' };
    const { dependencies } = createFakeWorld({ compareFiles: [renamed, { filename: 'en/A.md' }] });
    const status = await compareWithUpstream(GIT_ENTRY, dependencies);
    expect(status.state).toBe('moved');
    expect(status.changedPaths).toEqual(['en/A.md', 'en/Old.md']);
    expect(status.compareUrl).toBe(`https://github.com/${REPO}/compare/${PIN}...${HEAD}`);
  });

  it('reports a move that touched no watched path as unwatched', async () => {
    const { dependencies } = createFakeWorld({ compareFiles: [{ filename: 'README.md' }] });
    const status = await compareWithUpstream(GIT_ENTRY, dependencies);
    expect(status.state).toBe('unwatched');
  });

  it('treats a truncated compare as moved, because a watched path may be past the limit', async () => {
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, index) => ({ filename: `other/${String(index)}.txt` }));
    const status = await compareWithUpstream(GIT_ENTRY, createFakeWorld({ compareFiles: files }).dependencies);
    expect(status.state).toBe('moved');
    expect(status.truncated).toBe(true);
  });

  it('follows an npm dist-tag', async () => {
    const status = await compareWithUpstream(NPM_ENTRY, createFakeWorld().dependencies);
    expect(status).toMatchObject({ head: '1.0.0', pin: '1.0.0', state: 'current' });
  });

  it('refuses an npm dist-tag the package does not have', async () => {
    await expect(compareWithUpstream({ ...NPM_ENTRY, tag: 'next' }, createFakeWorld().dependencies)).rejects.toThrow('no dist-tag "next"');
  });

  it('reports a git upstream at its pin as current, without asking for a compare', async () => {
    const status = await compareWithUpstream({ ...GIT_ENTRY, commit: HEAD }, createFakeWorld().dependencies);
    expect(status).toMatchObject({ changedPaths: [], state: 'current' });
  });

  it('reads a compare without a file list as touching nothing', async () => {
    const { dependencies } = createFakeWorld();
    const fetchJson = dependencies.fetchJson.bind(dependencies);
    dependencies.fetchJson = async (url): Promise<unknown> => url.includes('/compare/') ? {} : await fetchJson(url);
    const status = await compareWithUpstream(GIT_ENTRY, dependencies);
    expect(status.state).toBe('unwatched');
  });
});

describe('syncUpstreams', () => {
  it('prints the PR a fixture upstream behind its pin asks for, and runs nothing, in a dry run', async () => {
    const world = createFakeWorld();
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: true, only: [] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'planned' }, { name: 'lib', outcome: 'current' }]);
    expect(world.calls).toEqual([]);
    const output = world.logs.join('\n');
    expect(output).toContain('Would push upstream/docs');
    expect(output).toContain(`title: chore(upstream): sync docs to ${HEAD.slice(0, SHORT_SHA_LENGTH)}`);
    expect(output).toContain(`  | Upstream \`docs\` moved: \`${REPO}@main\` from \`${PIN}\` to \`${HEAD}\`.`);
    expect(output).toContain('  | - `en/Plugins/Intro.md`');
    expect(output).not.toContain('README.md');
    expect(output).toContain('`npm run sync:git`: not run (dry run).');
    expect(readFileSync(configPath, 'utf-8')).toContain(PIN);
  });

  it('runs the handler and verify, pins the head, and opens a PR', async () => {
    const world = createFakeWorld();
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'opened', prNumber: CREATED_PR_NUMBER }]);
    const firstCalls = [
      'git status --porcelain',
      'git fetch origin main',
      'git checkout -B upstream/docs origin/main',
      'sh npm run sync:git',
      'sh npm test'
    ];
    expect(world.calls.slice(0, firstCalls.length)).toEqual(firstCalls);
    expect(world.calls).toContain('git push --force origin HEAD:refs/heads/upstream/docs');
    const create = world.calls.find((call) => call.startsWith('gh pr create')) ?? '';
    expect(create).not.toContain('--draft');
    expect(create).toContain('### Generated changes');
    const lastCalls = ['git checkout --force main', 'git branch --delete --force upstream/docs'];
    expect(world.calls.slice(-lastCalls.length)).toEqual(lastCalls);
    expect(readFileSync(configPath, 'utf-8')).toContain(HEAD);
  });

  it('opens a draft carrying the failure when the handler fails', async () => {
    const world = createFakeWorld({ handlerExitCode: HANDLER_EXIT_CODE });
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    const create = world.calls.find((call) => call.startsWith('gh pr create')) ?? '';
    expect(create).toContain('--draft');
    expect(create).toContain(`\`npm run sync:git\`: **FAILED** (exit ${String(HANDLER_EXIT_CODE)}).`);
    expect(create).toContain('TS2304');
  });

  it('updates the open PR, and turns it back into a draft when a step fails', async () => {
    const world = createFakeWorld({ handlerExitCode: 1, openPr: String(OPEN_PR_NUMBER), remoteBranchSame: false });
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'updated', prNumber: OPEN_PR_NUMBER }]);
    expect(world.calls).toContain(`gh pr ready ${String(OPEN_PR_NUMBER)} --undo`);
    expect(world.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
  });

  it('pushes nothing when the update branch already holds the same result', async () => {
    const world = createFakeWorld({ remoteBranchSame: true });
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'unchanged' }]);
    expect(world.calls.some((call) => call.startsWith('git push'))).toBe(false);
    expect(world.calls.some((call) => call.startsWith('gh pr edit'))).toBe(false);
  });

  it('still rewrites the open PR\'s body when the update branch already holds the same result', async () => {
    const world = createFakeWorld({ openPr: String(OPEN_PR_NUMBER), remoteBranchSame: true });
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'unchanged' }]);
    expect(world.calls.some((call) => call.startsWith('git push'))).toBe(false);
    expect(world.calls.some((call) => call.startsWith(`gh pr edit ${String(OPEN_PR_NUMBER)} --body Upstream`))).toBe(true);
    expect(world.logs).toContain(`docs: upstream/docs already holds this result; nothing pushed, PR #${String(OPEN_PR_NUMBER)}'s body rewritten.`);
  });

  it('runs the handler and verify without color', async () => {
    const world = createFakeWorld();
    const environments: (Readonly<Record<string, string>> | undefined)[] = [];
    const shell = world.dependencies.shell.bind(world.dependencies);
    world.dependencies.shell = (command, env): CommandResult => {
      environments.push(env);
      return shell(command, env);
    };
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(environments).toHaveLength(2);
    for (const env of environments) {
      expect(env).toMatchObject({ FORCE_COLOR: '0', NO_COLOR: '1', UPSTREAM_NAME: 'docs', UPSTREAM_TARGET: HEAD });
    }
  });

  it('opens a failed step\'s section with the lines reporting the failure, cleaned of color codes', async () => {
    const world = createFakeWorld();
    const shell = world.dependencies.shell.bind(world.dependencies);
    const green = Array.from({ length: 80 }, (_, index) => ` ^[[32m✓^[[39m src/t${String(index)}.test.ts`);
    world.dependencies.shell = (command, env): CommandResult =>
      command === 'npm test'
        ? { exitCode: 1, output: ['[install] step-failed', '/bin/sh: 1: bun: not found', ...green, ''].join('\n') }
        : shell(command, env);
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    const create = world.calls.find((call) => call.startsWith('gh pr create')) ?? '';
    const verify = create.slice(create.indexOf('### Verify'));
    expect(verify).toContain('Lines reporting the failure:\n\n```text\n[install] step-failed\n/bin/sh: 1: bun: not found\n```');
    expect(verify.indexOf('Lines reporting the failure')).toBeLessThan(verify.indexOf('<details open>'));
    expect(verify).not.toContain('^[');
    expect(verify).toContain(' ✓ src/t79.test.ts');
    expect(create.slice(0, create.indexOf('### Verify'))).not.toContain('Lines reporting the failure');
  });

  it('refuses to commit over a dirty working tree, and goes on to the next entry', async () => {
    const world = createFakeWorld();
    const exec = world.dependencies.exec.bind(world.dependencies);
    world.dependencies.exec = (file, arguments_, env): CommandResult => arguments_[0] === 'status' ? { exitCode: 0, output: '?? stray.txt\n' } : exec(file, arguments_, env);
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: [] }, world.dependencies);

    expect(results[0]).toMatchObject({ name: 'docs', outcome: 'error' });
    expect(results[0]?.error).toContain('stray.txt');
    expect(results[1]).toEqual({ name: 'lib', outcome: 'current' });
  });

  it('opens nothing for a move that touched no watched path', async () => {
    const world = createFakeWorld({ compareFiles: [{ filename: 'README.md' }] });
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'unwatched' }]);
    expect(world.calls).toEqual([]);
  });

  it('updates the open PR and marks it ready when every step passes', async () => {
    const world = createFakeWorld({ openPr: String(OPEN_PR_NUMBER), remoteBranchSame: false });
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(world.calls).toContain(`gh pr ready ${String(OPEN_PR_NUMBER)}`);
    expect(world.logs).toContain(`docs: updated PR #${String(OPEN_PR_NUMBER)}.`);
  });

  it('runs the file\'s verify for an entry without its own, and pins an npm upstream\'s version', async () => {
    writeFileSync(configPath, JSON.stringify({ ...FIXTURE, upstreams: [{ ...NPM_ENTRY, version: '0.9.0' }] }));
    const world = createFakeWorld();
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: [] }, world.dependencies);

    expect(world.calls).toContain('sh npm run lint');
    expect(readFileSync(configPath, 'utf-8')).toContain('"version": "1.0.0"');
  });

  it('runs no verify when neither the entry nor the file names one', async () => {
    writeFileSync(configPath, JSON.stringify({ upstreams: [{ ...NPM_ENTRY, version: '0.9.0' }] }));
    const world = createFakeWorld();
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: [] }, world.dependencies);

    expect(world.calls.filter((call) => call.startsWith('sh '))).toEqual(['sh npm run sync:npm']);
    const create = world.calls.find((call) => call.startsWith('gh pr create')) ?? '';
    expect(create).not.toContain('### Verify');
  });

  it('keeps a pin the handler already moved', async () => {
    const world = createFakeWorld();
    const shell = world.dependencies.shell.bind(world.dependencies);
    world.dependencies.shell = (command, env): CommandResult => {
      if (command === 'npm run sync:git') {
        writeFileSync(configPath, readFileSync(configPath, 'utf-8').replace(PIN, 'c'.repeat(SHA_LENGTH)));
      }
      return shell(command, env);
    };
    await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(readFileSync(configPath, 'utf-8')).toContain('c'.repeat(SHA_LENGTH));
    expect(readFileSync(configPath, 'utf-8')).not.toContain(HEAD);
  });

  it('reports a created PR whose URL carries no number without one', async () => {
    const world = createFakeWorld();
    const exec = world.dependencies.exec.bind(world.dependencies);
    world.dependencies.exec = (file, arguments_, env): CommandResult => arguments_[1] === 'create' ? ok('created\n') : exec(file, arguments_, env);
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ name: 'docs', outcome: 'opened' }]);
  });

  it('reports a failed git command as the entry\'s error', async () => {
    const world = createFakeWorld();
    const exec = world.dependencies.exec.bind(world.dependencies);
    world.dependencies.exec = (file, arguments_, env): CommandResult => arguments_[0] === 'fetch' ? { exitCode: 128, output: 'fatal: no remote\n' } : exec(file, arguments_, env);
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: false, only: ['docs'] }, world.dependencies);

    expect(results).toEqual([{ error: 'git fetch origin main failed (exit 128): fatal: no remote', name: 'docs', outcome: 'error' }]);
  });

  it('reports a thrown non-error as the entry\'s error', async () => {
    const world = createFakeWorld();
    world.dependencies.fetchJson = async (): Promise<unknown> => {
      await noopAsync();
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- The case under test.
      throw 'offline';
    };
    const results = await syncUpstreams({ baseBranch: 'main', configPath, dryRun: true, only: ['lib'] }, world.dependencies);

    expect(results).toEqual([{ error: 'offline', name: 'lib', outcome: 'error' }]);
  });

  it('refuses an --only name that is not in the file', async () => {
    await expect(syncUpstreams({ baseBranch: 'main', configPath, dryRun: true, only: ['nope'] }, createFakeWorld().dependencies)).rejects.toThrow('"nope"');
  });
});

describe('cleanCommandOutput', () => {
  const ESC = '\u{1B}';

  it('removes color codes sent as ESC bytes', () => {
    expect(cleanCommandOutput(`${ESC}[32m✓${ESC}[39m a ${ESC}[2m(${ESC}[22m1 test${ESC}[2m)${ESC}[22m`)).toBe('✓ a (1 test)');
  });

  it('removes color codes rendered as caret text', () => {
    expect(cleanCommandOutput(' ^[[32m✓^[[39m a ^[[2m(^[[22m^[[2m16 tests^[[22m^[[2m)^[[22m^[[32m 40^[[2mms^[[22m^[[39m')).toBe(' ✓ a (16 tests) 40ms');
  });

  it('removes cursor moves, OSC hyperlinks ended by BEL or ST, and two-character escapes', () => {
    expect(cleanCommandOutput(`${ESC}[2K${ESC}[1Ga${ESC}]8;;https://x.test${ESC}\\link${ESC}]8;;\u{7}${ESC}Mb`)).toBe('alinkb');
    expect(cleanCommandOutput(String.raw`^[]0;title^Gx^[]8;;u^[\y`)).toBe('xy');
  });

  it('keeps caret text that is not a control sequence', () => {
    expect(cleanCommandOutput('match ^[A-Z] and ^G')).toBe('match ^[A-Z] and ^G');
  });

  it('keeps the last state of a line a progress display rewrote, and turns CRLF into LF', () => {
    expect(cleanCommandOutput('10%\r50%\r100%\ndone\r\nnext\r')).toBe('100%\ndone\nnext');
    expect(cleanCommandOutput('\r\r')).toBe('');
  });
});

describe('buildPrBody', () => {
  it('describes an npm upstream by its package and tag', async () => {
    const status = await compareWithUpstream({ ...NPM_ENTRY, version: '0.9.0' }, createFakeWorld().dependencies);
    const body = buildPrBody(planSync(status), null, null);
    expect(body).toContain('npm `@acme/lib@latest` from `0.9.0` to `1.0.0`');
    expect(body).toContain('https://www.npmjs.com/package/@acme/lib/v/1.0.0');
    expect(body).not.toContain('### Changed upstream files');
  });

  it('says when GitHub truncated the compare\'s file list', async () => {
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, index) => ({ filename: `other/${String(index)}.txt` }));
    const status = await compareWithUpstream(GIT_ENTRY, createFakeWorld({ compareFiles: files }).dependencies);
    expect(buildPrBody(planSync(status), null, null)).toContain(`GitHub lists at most ${String(COMPARE_FILE_LIMIT)} files`);
  });

  it('keeps an npm version whole in the title', async () => {
    const status = await compareWithUpstream({ ...NPM_ENTRY, version: '0.9.0' }, createFakeWorld().dependencies);
    expect(planSync(status).title).toBe('chore(upstream): sync lib to 1.0.0');
  });
});
