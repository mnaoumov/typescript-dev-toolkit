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

import type { PackSmokeTypedModule } from './pack-smoke-types.ts';

import { typeCheckPackSmokeImports } from './pack-smoke-types.ts';

interface FixturePackage {
  readonly exports: unknown;
  readonly files: Readonly<Record<string, string>>;
  readonly type?: string;
}

const DECLARATION = 'export declare const ok: boolean;\n';

let smokeFolder = '';

beforeEach(() => {
  smokeFolder = mkdtempSync(join(tmpdir(), 'pack-smoke-types-test-'));
});

afterEach(() => {
  rmSync(smokeFolder, { force: true, recursive: true });
});

function install(fixture: FixturePackage): string {
  const packageFolder = join(smokeFolder, 'node_modules', 'fixture');
  const files: Readonly<Record<string, string>> = {
    ...fixture.files,
    'package.json': JSON.stringify({ exports: fixture.exports, name: 'fixture', type: fixture.type })
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(packageFolder, path)), { recursive: true });
    writeFileSync(join(packageFolder, path), content);
  }
  return packageFolder;
}

function typed(packageFolder: string, specifier: string, runtimeFile: string): PackSmokeTypedModule {
  return { runtimeFile: join(packageFolder, runtimeFile), specifier };
}

describe('typeCheckPackSmokeImports', () => {
  it('passes a dual package whose every condition carries types of its own format', async () => {
    const packageFolder = install({
      exports: {
        // Condition order is meaning: `types` must come before `default`, or `default` wins.
        // eslint-disable-next-line perfectionist/sort-objects -- condition order decides resolution.
        '.': { import: { types: './index.d.mts', default: './index.mjs' }, require: { types: './index.d.cts', default: './index.cjs' } },
        // eslint-disable-next-line perfectionist/sort-objects -- condition order decides resolution.
        './js': { types: './js.d.ts', default: './js.js' }
      },
      files: { 'index.d.cts': DECLARATION, 'index.d.mts': DECLARATION, 'js.d.ts': DECLARATION },
      type: 'module'
    });

    const result = await typeCheckPackSmokeImports({
      cjsModules: [typed(packageFolder, 'fixture', 'index.cjs')],
      esmModules: [typed(packageFolder, 'fixture', 'index.mjs'), typed(packageFolder, 'fixture/js', 'js.js')],
      packageType: 'module',
      smokeFolder
    });

    expect(result).toEqual({ isUntyped: false, problems: [], summary: '2 under node16 ESM, 1 under node16 CJS, 2 under bundler' });
  });

  it('reports types in the wrong format, missing types and an import the compiler refuses', async () => {
    const packageFolder = install({
      exports: {
        // eslint-disable-next-line perfectionist/sort-objects -- condition order decides resolution.
        '.': { import: { types: './index.d.cts', default: './index.mjs' }, require: { types: './index.d.ts', default: './index.cjs' } },
        './untyped': { default: './untyped.js' }
      },
      files: { 'index.d.cts': DECLARATION, 'index.d.ts': DECLARATION, 'untyped.js': '' },
      type: 'module'
    });

    const result = await typeCheckPackSmokeImports({
      cjsModules: [typed(packageFolder, 'fixture', 'index.cjs')],
      esmModules: [typed(packageFolder, 'fixture', 'index.mjs'), typed(packageFolder, 'fixture/untyped', 'untyped.js')],
      packageType: 'module',
      smokeFolder
    });

    expect(result.isUntyped).toBe(false);
    expect(result.problems).toEqual([
      'types node16 ESM fixture: the types (index.d.cts) are CommonJS, but Node loads index.mjs, which is an ES module (masquerading as CJS)',
      expect.stringMatching(/^types node16 ESM fixture\/untyped: TS7016 Could not find a declaration file for module 'fixture\/untyped'\./) as unknown,
      'types node16 CJS fixture: the types (index.d.ts) are an ES module, but Node loads index.cjs, which is CommonJS (masquerading as ESM)',
      expect.stringMatching(/^types node16 CJS fixture: TS1479 /) as unknown,
      expect.stringMatching(/^types bundler fixture\/untyped: TS7016 /) as unknown
    ]);
  });

  it('reports a package that ships no declarations as untyped, with nothing checked', async () => {
    const packageFolder = install({ exports: { '.': './index.js' }, files: { 'index.js': '' } });

    const result = await typeCheckPackSmokeImports({
      cjsModules: [typed(packageFolder, 'fixture', 'index.js')],
      esmModules: [typed(packageFolder, 'fixture', 'index.js')],
      packageType: undefined,
      smokeFolder
    });

    expect(result).toEqual({ isUntyped: true, problems: [], summary: '' });
  });

  it('reads a .js file and a .d.ts file of a package without a type as CommonJS', async () => {
    const packageFolder = install({
      // eslint-disable-next-line perfectionist/sort-objects -- condition order decides resolution.
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
      files: { 'index.d.ts': DECLARATION }
    });

    const result = await typeCheckPackSmokeImports({
      cjsModules: [typed(packageFolder, 'fixture', 'index.js')],
      esmModules: [typed(packageFolder, 'fixture', 'index.js')],
      packageType: undefined,
      smokeFolder
    });

    expect(result.problems).toEqual([]);
  });
});
