import dedent from 'dedent';
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
  DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS,
  validateDependencies
} from './validate-dependencies.ts';

const PACKAGE_JSON = {
  dependencies: { dependency: '^1.0.0' },
  devDependencies: { 'dev-only': '^1.0.0' },
  name: '@scope/self',
  optionalDependencies: { optional: '^1.0.0' },
  peerDependencies: { '@peer/scoped': '^1.0.0' }
};

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
  packageFolder = await mkdtemp(join(tmpdir(), 'validate-dependencies-'));
  process.chdir(packageFolder);
  await writeFiles({ 'package.json': JSON.stringify(PACKAGE_JSON) });
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(packageFolder, { force: true, recursive: true });
});

describe('validateDependencies', () => {
  it('scans dist/lib and bin by default', () => {
    expect(DEFAULT_VALIDATE_DEPENDENCIES_FOLDERS).toEqual(['dist/lib', 'bin']);
  });

  it('passes when the scanned folders do not exist', async () => {
    await expect(validateDependencies()).resolves.toBeUndefined();
  });

  it('passes for declared packages, the package itself, builtins and paths', async () => {
    await writeFiles({
      'bin/cli.mjs': 'import \'@scope/self/cli\';\n',
      'dist/lib/esm/a.d.mts': 'import type { Peer } from \'@peer/scoped/types\';\nexport declare const peer: Peer;\n',
      'dist/lib/esm/a.mjs': dedent`
        import { a } from 'dependency';
        import { b } from 'optional/sub';
        import { readFile } from 'node:fs';
        import { join } from 'path';
        import { c } from './c.mjs';
        import { d } from '/absolute/d.mjs';
        // import 'dev-only';
        const text = 'import "dev-only"';
      `,
      'dist/lib/esm/readme.md': 'import \'dev-only\';\n'
    });

    await expect(validateDependencies()).resolves.toBeUndefined();
  });

  it('throws naming every undeclared import with its file', async () => {
    await writeFiles({
      'bin/cli.mjs': 'import \'dev-only\';\n',
      'dist/lib/cjs/a.cjs': 'const x = require(\'@dev/scoped/sub\');\n',
      'dist/lib/cjs/a.d.cts': 'import type { X } from \'dev-only/types\';\nexport declare const x: X;\n'
    });

    await expect(validateDependencies()).rejects.toThrow(
      dedent`
        The published output imports packages that are not in dependencies, optionalDependencies or peerDependencies:
        dist/lib/cjs/a.cjs: @dev/scoped/sub
        dist/lib/cjs/a.d.cts: dev-only/types
        bin/cli.mjs: dev-only
      `
    );
  });

  it('passes for every node: specifier and for Electron builtins, which Node does not list', async () => {
    await writeFiles({
      'dist/lib/cjs/a.cjs': dedent`
        const fs = window.require('node:original-fs');
        const fs2 = require('original-fs');
        const { ipcRenderer } = require('electron');
        const { webUtils } = require('electron/renderer');
      `,
      'dist/lib/esm/a.d.mts': 'import type { App } from \'electron/main\';\nexport declare const app: App;\n'
    });

    await expect(validateDependencies()).resolves.toBeUndefined();
  });

  it('still reports a package whose name only starts like an Electron builtin', async () => {
    await writeFiles({
      'dist/lib/a.mjs': 'import \'electron-store\';\n'
    });

    await expect(validateDependencies()).rejects.toThrow(/:\ndist\/lib\/a\.mjs: electron-store$/u);
  });

  it('lets a declaration file import a package its @types package serves, and only a declaration file', async () => {
    await writeFiles({
      'dist/lib/a.d.ts': 'import type { Node } from \'estree\';\nimport type { X } from \'@typed/scoped\';\n',
      'dist/lib/a.mjs': 'import \'estree\';\n',
      'package.json': JSON.stringify({ dependencies: { '@types/estree': '^1.0.0', '@types/typed__scoped': '^1.0.0' } })
    });

    await expect(validateDependencies()).rejects.toThrow(/:\ndist\/lib\/a\.mjs: estree$/u);
  });

  it('scans only the given folders', async () => {
    await writeFiles({
      'dist/lib/a.mjs': 'import \'dev-only\';\n',
      'scripts/a.ts': 'import \'dependency\';\n'
    });

    await expect(validateDependencies({ folders: ['scripts'] })).resolves.toBeUndefined();
  });

  it('accepts a package.json with no dependency fields and no name', async () => {
    await writeFiles({
      'dist/lib/a.mjs': 'import \'node:path\';\n',
      'package.json': '{}'
    });

    await expect(validateDependencies()).resolves.toBeUndefined();
  });
});
