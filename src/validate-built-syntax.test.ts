import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  DEFAULT_VALIDATE_BUILT_SYNTAX_FOLDERS,
  findSyntaxProblem,
  validateBuiltSyntax
} from './validate-built-syntax.ts';

let originalCwd: string;
let packageFolder: string;

async function writeFiles(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

beforeEach(async () => {
  originalCwd = process.cwd();
  packageFolder = await mkdtemp(join(tmpdir(), 'validate-built-syntax-'));
  process.chdir(packageFolder);
  await writeFiles({ 'package.json': '{"name":"self"}' });
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(packageFolder, { force: true, recursive: true });
});

describe('findSyntaxProblem', () => {
  it('accepts a valid ES module', () => {
    expect(findSyntaxProblem('a.mjs', 'export const a = await import("./b.mjs");')).toBeNull();
  });

  it('accepts a CommonJS module with a top-level return and a hashbang', () => {
    expect(findSyntaxProblem('a.cjs', '#!/usr/bin/env node\nif (x) { return; }\nmodule.exports = 1;')).toBeNull();
  });

  it('reads a .js file as CommonJS by default and as an ES module when asked', () => {
    expect(findSyntaxProblem('a.js', 'return;')).toBeNull();
    expect(findSyntaxProblem('a.js', 'export {};')).not.toBeNull();
    expect(findSyntaxProblem('a.js', 'export {};', { isJsEsm: true })).toBeNull();
    expect(findSyntaxProblem('a.js', 'return;', { isJsEsm: true })).not.toBeNull();
  });

  it('reports a string ended early by a re-quoted import(), with its position', () => {
    expect(findSyntaxProblem('rule.mjs', 'const message = "A dynamic `import("{{specifier}}")` stays";')).toMatch(
      /\(1:\d+\)/u
    );
  });
});

describe('validateBuiltSyntax', () => {
  it('scans dist/lib and bin by default', () => {
    expect(DEFAULT_VALIDATE_BUILT_SYNTAX_FOLDERS).toEqual(['dist/lib', 'bin']);
  });

  it('passes when the scanned folders do not exist', async () => {
    await expect(validateBuiltSyntax()).resolves.toBeUndefined();
  });

  it('passes when every module parses, and skips files that are not modules', async () => {
    await writeFiles({
      'bin/cli.mjs': '#!/usr/bin/env node\nimport \'./x.mjs\';\n',
      'dist/lib/cjs/a.cjs': 'module.exports = 1;\n',
      'dist/lib/cjs/a.d.cts': 'const = 1;\n',
      'dist/lib/esm/a.mjs': 'export const a = 1;\n',
      'dist/lib/esm/script.js': 'return;\n'
    });

    await expect(validateBuiltSyntax()).resolves.toBeUndefined();
  });

  it('reads a .js file as an ES module in a "type": "module" package', async () => {
    await writeFiles({
      'dist/lib/a.js': 'export const a = 1;\n',
      'package.json': '{"name":"self","type":"module"}'
    });

    await expect(validateBuiltSyntax()).resolves.toBeUndefined();
  });

  it('lists every module that does not parse, relative to the root', async () => {
    await writeFiles({
      'bin/cli.mjs': 'export {};\n',
      'dist/lib/esm/bad.mjs': 'const = 1;\n',
      'dist/lib/esm/nested/bad.cjs': 'module.exports = ;\n',
      'other/bad.mjs': 'const = 1;\n'
    });

    const promise = validateBuiltSyntax();
    await expect(promise).rejects.toThrow(/^2 of 3 emitted module\(s\) do not parse:\n/u);
    await expect(promise).rejects.toThrow(/\ndist\/lib\/esm\/bad\.mjs: .+\ndist\/lib\/esm\/nested\/bad\.cjs: /u);
  });

  it('scans only the given folders', async () => {
    await writeFiles({
      'dist/lib/bad.mjs': 'const = 1;\n',
      'other/bad.mjs': 'const = 1;\n'
    });

    await expect(validateBuiltSyntax({ folders: ['dist/lib'] })).rejects.toThrow(/^1 of 1 /u);
  });
});
