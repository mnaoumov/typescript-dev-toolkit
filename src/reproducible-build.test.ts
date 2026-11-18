import { noopAsync } from '@mnaoumov/typescript-lib/function';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  AssertReproducibleBuildParams,
  ReproducibleBuildCommandResult,
  ReproducibleBuildDependencies,
  ReproducibleBuildRunOptions
} from './reproducible-build.ts';

import { exec } from './exec.ts';
import {
  assertReproducibleBuild,
  createNodeReproducibleBuildDependencies,
  findFirstDifference
} from './reproducible-build.ts';

vi.mock('./exec.ts', () => ({ exec: vi.fn() }));

interface CheckOutcome {
  readonly error: Error | null;
  readonly fake: FakeDependencies;
}

interface FakeDependencies extends ReproducibleBuildDependencies {
  readonly calls: RecordedCall[];
  readonly lines: string[];
}

interface FakeWorld {
  readonly archiveExitCode?: number;
  readonly commitExitCode?: number;
  readonly commitStdout?: string;
  // The files each build writes, by path relative to the folder it runs in.
  readonly copyBuild?: Readonly<Record<string, string>>;
  readonly copyBuildExitCode?: number;
  readonly status?: string;
  // The files the extracted archive holds.
  readonly tree?: Readonly<Record<string, string>>;
  readonly workingBuild?: Readonly<Record<string, string>>;
  readonly workingBuildExitCode?: number;
}

interface RecordedCall {
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>> | undefined;
  readonly hadNodeModulesLink: boolean;
}

const COMMIT = 'abc1234';

let projectFolder = '';

beforeEach(() => {
  projectFolder = mkdtempSync(join(tmpdir(), 'reproducible-build-test-'));
});

afterEach(() => {
  rmSync(projectFolder, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function createFake(world: FakeWorld): FakeDependencies {
  const calls: RecordedCall[] = [];
  const lines: string[] = [];

  function result(exitCode: number, stdout = '', stderr = ''): ReproducibleBuildCommandResult {
    return { exitCode, stderr, stdout };
  }

  return {
    calls,
    lines,
    log(text): void {
      lines.push(text);
    },
    async run(command: readonly string[], options: ReproducibleBuildRunOptions): Promise<ReproducibleBuildCommandResult> {
      const text = command.join(' ');
      calls.push({ command: text, cwd: options.cwd, env: options.env, hadNodeModulesLink: existsSync(join(options.cwd, 'node_modules')) });
      await noopAsync();
      if (text.startsWith('git rev-parse')) {
        return result(world.commitExitCode ?? 0, world.commitStdout ?? `${COMMIT}\n`);
      }

      if (text.startsWith('git --no-optional-locks status')) {
        return result(0, world.status ?? '');
      }

      if (text.startsWith('git archive')) {
        return result(world.archiveExitCode ?? 0, '', world.archiveExitCode ? 'fatal: archive failed\n' : '');
      }

      if (text.startsWith('tar')) {
        writeFiles(options.cwd, world.tree ?? {});
        return result(0);
      }

      const isCopy = basename(options.cwd) === 'tree';
      const exitCode = (isCopy ? world.copyBuildExitCode : world.workingBuildExitCode) ?? 0;
      if (exitCode !== 0) {
        return result(exitCode, 'line one\nline two', 'Could not resolve "./secret.ts"');
      }
      writeFiles(options.cwd, (isCopy ? world.copyBuild : world.workingBuild) ?? {});
      return result(0);
    }
  };
}

async function runCheck(world: FakeWorld, options: Partial<AssertReproducibleBuildParams> = {}): Promise<CheckOutcome> {
  const fake = createFake(world);
  try {
    await assertReproducibleBuild({ dependencies: fake, outputPaths: ['dist'], projectFolder, ...options });
    return { error: null, fake };
  } catch (error) {
    return { error: error as Error, fake };
  }
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

describe('findFirstDifference', () => {
  it('returns null for equal bytes', () => {
    expect(findFirstDifference(Buffer.from('abc'), Buffer.from('abc'))).toBeNull();
    expect(findFirstDifference(Buffer.from(''), Buffer.from(''))).toBeNull();
  });

  it('reports the offset, line and column of the first differing byte', () => {
    expect(findFirstDifference(Buffer.from('one\ntwo\nthree'), Buffer.from('one\ntwo\nthrEe'))).toEqual({
      column: 4,
      firstContext: '"one\\ntwo\\nthree"',
      line: 3,
      offset: 11,
      secondContext: '"one\\ntwo\\nthrEe"'
    });
  });

  it('reports the end of the shorter file when one is a prefix of the other', () => {
    expect(findFirstDifference(Buffer.from('abc'), Buffer.from('abcd'))).toMatchObject({ column: 4, line: 1, offset: 3 });
    expect(findFirstDifference(Buffer.from('abcd'), Buffer.from('abc'))).toMatchObject({ offset: 3 });
  });

  it('shows only the bytes around the difference', () => {
    const first = Buffer.from(`${'a'.repeat(50)}X${'b'.repeat(50)}`);
    const second = Buffer.from(`${'a'.repeat(50)}Y${'b'.repeat(50)}`);
    expect(findFirstDifference(first, second)).toMatchObject({
      firstContext: JSON.stringify(`${'a'.repeat(20)}X${'b'.repeat(19)}`),
      offset: 50
    });
  });
});

describe('assertReproducibleBuild', () => {
  it('refuses an empty list of output paths', async () => {
    const { error } = await runCheck({}, { outputPaths: [] });
    expect(error?.message).toContain('at least one output path');
  });

  it('refuses a ref that names no commit', async () => {
    const failedLookup = await runCheck({ commitExitCode: 1 }, { ref: 'v9' });
    expect(failedLookup.error?.message).toContain('v9 does not name a commit');
    const emptyLookup = await runCheck({ commitStdout: '\n' });
    expect(emptyLookup.error?.message).toContain('HEAD does not name a commit');
  });

  it('passes when both builds write the same bytes, and cleans up after itself', async () => {
    mkdirSync(join(projectFolder, 'node_modules'));
    const build = { 'dist/a.js': 'a', 'dist/sub/b.js': 'b' };
    const { error, fake } = await runCheck({ copyBuild: build, workingBuild: build }, { outputPaths: ['dist/'] });

    expect(error).toBeNull();
    expect(fake.lines.at(-1)).toBe(`2 output file(s) identical byte for byte between the working tree and the committed tree (HEAD ${COMMIT}).`);
    const copyBuild = fake.calls.find((call) => call.command === 'npm run build' && basename(call.cwd) === 'tree');
    expect(copyBuild).toMatchObject({ env: { NODE_PRESERVE_SYMLINKS: '1' }, hadNodeModulesLink: true });
    const archive = fake.calls.find((call) => call.command.startsWith('git archive'));
    expect(archive?.command).toMatch(new RegExp(`--format=tar -o .*tree\\.tar ${COMMIT}$`));
    expect(archive?.cwd).toBe(projectFolder);
    expect(existsSync(dirname(copyBuild?.cwd ?? ''))).toBe(false);
    expect(existsSync(join(projectFolder, 'node_modules'))).toBe(true);
  });

  it('compares a single output file', async () => {
    const { error } = await runCheck({ copyBuild: { 'main.js': 'same' }, workingBuild: { 'main.js': 'same' } }, { outputPaths: ['main.js'] });
    expect(error).toBeNull();
  });

  it('does not link node_modules when the project has none, or when the commit holds one', async () => {
    const withoutModules = await runCheck({ copyBuild: { 'dist/a.js': 'a' }, workingBuild: { 'dist/a.js': 'a' } });
    expect(withoutModules.fake.calls.find((call) => call.command === 'npm run build' && basename(call.cwd) === 'tree')?.hadNodeModulesLink).toBe(false);

    mkdirSync(join(projectFolder, 'node_modules'));
    const committed = await runCheck({ copyBuild: { 'dist/a.js': 'a' }, tree: { 'node_modules/x/index.js': 'x' }, workingBuild: { 'dist/a.js': 'a' } });
    expect(committed.error).toBeNull();
  });

  it('compares the existing output without building the working tree when asked', async () => {
    writeFiles(projectFolder, { 'dist/a.js': 'a' });
    const { error, fake } = await runCheck({ copyBuild: { 'dist/a.js': 'a' } }, { shouldBuildWorkingTree: false });
    expect(error).toBeNull();
    expect(fake.calls.filter((call) => call.command === 'npm run build')).toHaveLength(1);
  });

  it('reports every difference, with the causes and the uncommitted changes', async () => {
    const { error } = await runCheck({
      copyBuild: { 'dist/a.js': 'const root = "/tmp/copy";', 'dist/copy-only.js': 'c' },
      status: ' M src/a.ts\n?? secret.ts\n M src/b.ts\n M src/c.ts\n',
      workingBuild: { 'dist/a.js': 'const root = "/home/me";', 'dist/working-only.js': 'w' }
    }, { buildCommand: ['node', 'build.mjs'] });

    const message = error?.message ?? '';
    expect(message).toContain(`The build is not reproducible from the committed tree (HEAD ${COMMIT}):`);
    expect(message).toContain('- dist/a.js differs: first at byte 15 (line 1, column 16), 24 and 25 bytes');
    expect(message).toContain('- dist/copy-only.js is built from the committed tree but not from the working tree.');
    expect(message).toContain('- dist/working-only.js is built from the working tree but not from the committed tree.');
    expect(message).toContain('Likely causes:');
    expect(message).toContain('The working tree has 4 uncommitted change(s) (M src/a.ts, ?? secret.ts, M src/b.ts, ...)');
  });

  it('lists every uncommitted change when there are few, and names an output neither build produced', async () => {
    const { error } = await runCheck({ status: '?? secret.ts\n' }, { outputPaths: ['dist'] });
    expect(error?.message).toContain('- dist was produced by neither build.');
    expect(error?.message).toContain('(?? secret.ts): commit them first');
  });

  it('says nothing about uncommitted changes when the tree is clean', async () => {
    const { error } = await runCheck({ copyBuild: { 'dist/a.js': 'b' }, workingBuild: { 'dist/a.js': 'a' } });
    expect(error?.message).not.toContain('commit them first');
  });

  it('fails when the working tree does not build', async () => {
    const { error } = await runCheck({ workingBuildExitCode: 2 });
    expect(error?.message).toBe('the working tree does not build: npm run build exited with 2.\nline one\nline two\nCould not resolve "./secret.ts"');
  });

  it('fails with the missing-input hint when only the committed tree does not build', async () => {
    const { error } = await runCheck({ copyBuildExitCode: 1, workingBuild: { 'dist/a.js': 'a' } });
    expect(error?.message).toContain(`the committed tree (HEAD ${COMMIT}) does not build: npm run build exited with 1.`);
    expect(error?.message).toContain('an input of the build is not in the commit');
  });

  it('fails when the archive cannot be made', async () => {
    const { error } = await runCheck({ archiveExitCode: 128, workingBuild: { 'dist/a.js': 'a' } });
    expect(error?.message).toMatch(/^git archive .* exited with 128: fatal: archive failed$/);
  });
});

describe('createNodeReproducibleBuildDependencies', () => {
  it('writes progress to stdout', () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    createNodeReproducibleBuildDependencies().log('hello');
    expect(process.stdout.write).toHaveBeenCalledWith('hello\n');
  });

  it('runs commands through exec without throwing on the exit code', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 3, exitSignal: null, stderr: 'e', stdout: 'o' });
    const dependencies = createNodeReproducibleBuildDependencies();

    const result = await dependencies.run(['git', 'status'], { cwd: 'C:/x' });
    expect(result).toEqual({ exitCode: 3, stderr: 'e', stdout: 'o' });
    expect(exec).toHaveBeenLastCalledWith(['git', 'status'], { cwd: 'C:/x', env: {}, isQuiet: true, shouldIgnoreExitCode: true, shouldIncludeDetails: true });

    await dependencies.run(['npm', 'run', 'build'], { cwd: 'C:/y', env: { NODE_PRESERVE_SYMLINKS: '1' } });
    expect(exec).toHaveBeenLastCalledWith(['npm', 'run', 'build'], expect.objectContaining({ env: { NODE_PRESERVE_SYMLINKS: '1' } }));
  });
});
