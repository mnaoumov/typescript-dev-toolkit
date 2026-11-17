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

import type { PackSmokeDependencies } from './pack-smoke.ts';

import {
  createNodePackSmokeDependencies,
  smokePack
} from './pack-smoke.ts';

// A package with no dependencies, so the real `npm pack` and `npm install` run offline in seconds.
const FIXTURE_FILES: ReadonlyMap<string, string> = new Map([
  ['bin/hello.mjs', 'process.exitCode = process.argv.includes(\'--help\') ? 0 : 1;\n'],
  ['cjs/index.cjs', 'exports.hello = \'hello\';\n'],
  ['cjs/site/page.cjs', 'require(\'optional-renderer\');\n'],
  ['esm/index.mjs', 'export const hello = \'hello\';\n'],
  ['esm/site/page.mjs', 'import \'optional-renderer\';\n'],
  ['extra.mjs', 'export const extra = 1;\n']
]);

let projectFolder = '';

beforeEach(() => {
  projectFolder = mkdtempSync(join(tmpdir(), 'pack-smoke-fixture-'));
  for (const [path, content] of FIXTURE_FILES) {
    mkdirSync(dirname(join(projectFolder, path)), { recursive: true });
    writeFileSync(join(projectFolder, path), content);
  }
});

afterEach(() => {
  rmSync(projectFolder, { force: true, recursive: true });
});

function createQuietDependencies(lines: string[]): PackSmokeDependencies {
  return {
    ...createNodePackSmokeDependencies(),
    log(text): void {
      lines.push(text);
    }
  };
}

function writePackageJson(files: readonly string[]): void {
  writeFileSync(
    join(projectFolder, 'package.json'),
    JSON.stringify({
      bin: { hello: './bin/hello.mjs' },
      exports: {
        '.': { import: './esm/index.mjs', require: './cjs/index.cjs' },
        './*': { import: './esm/*.mjs', require: './cjs/*.cjs' },
        './extra': './extra.mjs'
      },
      files,
      name: '@pack-smoke/fixture',
      peerDependencies: { 'optional-renderer': '^1.0.0' },
      peerDependenciesMeta: { 'optional-renderer': { optional: true } },
      version: '1.0.0'
    })
  );
}

describe('smokePack', () => {
  it('passes a package that installs, loads both ways and runs its bin', async () => {
    writePackageJson(['bin/', 'cjs/', 'esm/', 'extra.mjs']);
    const lines: string[] = [];

    await smokePack({ dependencies: createQuietDependencies(lines), peerBoundModules: ['site/**'], projectFolder });

    expect(lines).toContain('pack smoke: imported 3 module(s), 1 of them peer-bound and stopped by a missing optional peer');
    // `./extra` has no `require` condition of its own, but its plain string target serves both.
    expect(lines).toContain('pack smoke: required 3 module(s), 1 of them peer-bound and stopped by a missing optional peer');
    expect(lines).toContain('pack smoke: running hello --help');
    expect(lines.at(-1)).toBe('pack smoke: @pack-smoke/fixture passed');
  });

  it('fails a package whose exports name a file the tarball leaves out', async () => {
    writePackageJson(['bin/', 'cjs/', 'esm/']);

    await expect(smokePack({ dependencies: createQuietDependencies([]), peerBoundModules: ['site/**'], projectFolder })).rejects.toThrow(
      /The pack smoke found 2 problem\(s\):\n- import @pack-smoke\/fixture\/extra: ERR_MODULE_NOT_FOUND .*\n- require @pack-smoke\/fixture\/extra: MODULE_NOT_FOUND /
    );
  });
});
