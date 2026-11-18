// Cspell:ignore gpgsign

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { assertReproducibleBuild } from './reproducible-build.ts';

// The build of every fixture: `dist/out.js` holds `src/input.txt`, plus whatever the optional inputs add.
const BUILD_SCRIPT = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

let output = readFileSync('src/input.txt', 'utf-8');
if (existsSync('read-local.flag')) {
  output += readFileSync('local.txt', 'utf-8');
}
if (existsSync('write-cwd.flag')) {
  output += process.cwd();
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/out.js', output);
`;

const BUILD_COMMAND = ['node', 'build.mjs'];

let repositoryFolder = '';

beforeEach(() => {
  repositoryFolder = mkdtempSync(join(tmpdir(), 'reproducible-build-fixture-'));
  mkdirSync(join(repositoryFolder, 'hooks'));
  runGit(['init', '--quiet']);
});

afterEach(() => {
  rmSync(repositoryFolder, { force: true, recursive: true });
});

function commitAll(): void {
  runGit(['add', '-A']);
  runGit(['commit', '--quiet', '-m', 'fixture']);
}

function runGit(gitArguments: readonly string[]): void {
  // An empty hooks folder and no signing, so the machine's own git setup cannot reach the fixture.
  const result = spawnSync('git', [
    '-C',
    repositoryFolder,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${join(repositoryFolder, 'hooks')}`,
    ...gitArguments
  ], { encoding: 'utf-8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed: ${result.stderr}`);
  }
}

function writeProject(projectFolder: string, files: Readonly<Record<string, string>>): void {
  const allFiles: Readonly<Record<string, string>> = { '.gitignore': 'dist/\nhooks/\nlocal.txt\n', 'build.mjs': BUILD_SCRIPT, 'src/input.txt': 'input', ...files };
  for (const [path, content] of Object.entries(allFiles)) {
    const fullPath = join(projectFolder, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

describe('assertReproducibleBuild with real git and tar', () => {
  it('passes when the build reads only committed files', async () => {
    writeProject(repositoryFolder, {});
    commitAll();

    await expect(assertReproducibleBuild({ buildCommand: BUILD_COMMAND, outputPaths: ['dist'], projectFolder: repositoryFolder })).resolves.toBeUndefined();
  });

  it('archives only the project subfolder of a repository', async () => {
    const projectFolder = join(repositoryFolder, 'packages', 'one');
    writeProject(projectFolder, {});
    writeFileSync(join(repositoryFolder, 'outside.txt'), 'outside');
    commitAll();

    await expect(assertReproducibleBuild({ buildCommand: BUILD_COMMAND, outputPaths: ['dist'], projectFolder })).resolves.toBeUndefined();
  });

  it('fails when the build reads a file git ignores', async () => {
    writeProject(repositoryFolder, { 'local.txt': 'machine-only', 'read-local.flag': '' });
    commitAll();

    await expect(assertReproducibleBuild({ buildCommand: BUILD_COMMAND, outputPaths: ['dist'], projectFolder: repositoryFolder }))
      .rejects.toThrow(/the committed tree \(HEAD [0-9a-f]+\) does not build: node build\.mjs exited with 1\.\nThe committed tree does not build/);
  });

  it('fails when the output holds the folder it was built in', async () => {
    writeProject(repositoryFolder, { 'write-cwd.flag': '' });
    commitAll();

    await expect(assertReproducibleBuild({ buildCommand: BUILD_COMMAND, outputPaths: ['dist'], projectFolder: repositoryFolder }))
      .rejects.toThrow(/- dist\/out\.js differs: first at byte \d+ \(line 1, column \d+\)/);
  });

  it('fails on an uncommitted change and names it', async () => {
    writeProject(repositoryFolder, {});
    commitAll();
    writeFileSync(join(repositoryFolder, 'src', 'input.txt'), 'changed');

    await expect(assertReproducibleBuild({ buildCommand: BUILD_COMMAND, outputPaths: ['dist'], projectFolder: repositoryFolder }))
      .rejects.toThrow(/The working tree has 1 uncommitted change\(s\) \(M src\/input\.txt\)/);
  });
});
