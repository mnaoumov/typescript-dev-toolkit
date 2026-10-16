import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import { detectTestRunner } from './test-runners/auto.ts';
import { defineJestConfig } from './test-runners/jest-config.ts';
import {
  test,
  testCoverage
} from './test-runners/jest.ts';

// Real jest, run through the runner on a throwaway ESM package. What a mock cannot show is whether the whole chain
// holds together: the configuration `defineJestConfig` writes loads ts-jest as ESM, a `.ts` import resolves, the
// runner's `--experimental-vm-modules` reaches jest, and its JSON `--coverageThreshold` survives the shell. The last
// one is what the failing-threshold case is for: an argument mangled on the way would make jest refuse to start,
// which fails the run for a reason the assertion below does not accept.
const REPOSITORY_NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const JEST_RUN_TIMEOUT_IN_MILLISECONDS = 120_000;

let fixtureFolder = '';
let originalCwd = '';

function writeFixtureFile(relativePath: string, content: string): void {
  const path = join(fixtureFolder, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeAll(() => {
  originalCwd = process.cwd();
  fixtureFolder = mkdtempSync(join(tmpdir(), 'jest-runner-'));
  // A junction, so ts-jest and jest resolve from the fixture without an install; Windows needs no privilege for one.
  symlinkSync(REPOSITORY_NODE_MODULES, join(fixtureFolder, 'node_modules'), 'junction');
  writeFixtureFile('package.json', JSON.stringify({ name: 'jest-runner-fixture', type: 'module' }));
  writeFixtureFile(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'nodenext',
        noEmit: true,
        rewriteRelativeImportExtensions: true,
        strict: true,
        target: 'es2022',
        types: []
      },
      include: ['src']
    })
  );
  writeFixtureFile('src/sum.ts', 'export function sum(a: number, b: number): number {\n  return a + b;\n}\n');
  writeFixtureFile('src/untested.ts', 'export function untested(): number {\n  return 1;\n}\n');
  writeFixtureFile(
    'src/sum.test.ts',
    'import { expect, it } from \'@jest/globals\';\n\nimport { sum } from \'./sum.ts\';\n\nit(\'adds\', () => {\n  expect(sum(1, 2)).toBe(3);\n});\n'
  );
  process.chdir(fixtureFolder);
  writeFixtureFile('jest.config.json', JSON.stringify(defineJestConfig()));
});

afterAll(() => {
  process.chdir(originalCwd);
  // The link alone, before the folder: the repository's own `node_modules` is on the other side of it.
  unlinkSync(join(fixtureFolder, 'node_modules'));
  rmSync(fixtureFolder, { force: true, recursive: true });
});

describe('the jest runner', () => {
  it('should detect jest from the configuration file', async () => {
    expect(await detectTestRunner()).toBe('jest');
  });

  it('should run an ESM TypeScript suite', async () => {
    await expect(test()).resolves.toBeUndefined();
  }, JEST_RUN_TIMEOUT_IN_MILLISECONDS);

  it('should pass a threshold the suite meets', async () => {
    await expect(testCoverage({ minCoverageInPercents: 50 })).resolves.toBeUndefined();
  }, JEST_RUN_TIMEOUT_IN_MILLISECONDS);

  it('should fail a threshold the suite misses', async () => {
    await expect(testCoverage({ minCoverageInPercents: 100 })).rejects.toThrow(/Coverage for lines \(50%\) does not meet "global" threshold \(100%\)/);
  }, JEST_RUN_TIMEOUT_IN_MILLISECONDS);
});
