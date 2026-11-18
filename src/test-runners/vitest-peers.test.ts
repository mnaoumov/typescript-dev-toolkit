import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { InstalledVersionReader } from './vitest-peers.ts';

import {
  assertVitestPeerVersions,
  findVitestPeerProblems,
  readInstalledPackageVersion
} from './vitest-peers.ts';

function makeReader(versions: Readonly<Record<string, string>>): InstalledVersionReader {
  return (packageName) => versions[packageName] ?? null;
}

describe('findVitestPeerProblems', () => {
  it('finds nothing when both packages are at the same version', () => {
    expect(findVitestPeerProblems(makeReader({ '@vitest/coverage-v8': '5.1.0', 'vitest': '5.1.0' }))).toEqual([]);
  });

  it('finds nothing when either package is not installed', () => {
    expect(findVitestPeerProblems(makeReader({ vitest: '5.1.0' }))).toEqual([]);
    expect(findVitestPeerProblems(makeReader({ '@vitest/coverage-v8': '5.1.0' }))).toEqual([]);
  });

  it('asks for the coverage provider at vitest\'s version when they differ', () => {
    expect(findVitestPeerProblems(makeReader({ '@vitest/coverage-v8': '5.0.2', 'vitest': '5.1.0' }))).toEqual([{
      install: '@vitest/coverage-v8@5.1.0',
      message: '"@vitest/coverage-v8" 5.0.2 is installed next to "vitest" 5.1.0; the two must be the same version.'
    }]);
  });
});

describe('assertVitestPeerVersions', () => {
  it('returns when the versions fit', () => {
    expect(() => {
      assertVitestPeerVersions({ callerName: 'caller()', readInstalledVersion: makeReader({ '@vitest/coverage-v8': '5.1.0', 'vitest': '5.1.0' }) });
    }).not.toThrow();
  });

  it('throws one error naming the caller and the install line', () => {
    expect(() => {
      assertVitestPeerVersions({ callerName: 'caller()', readInstalledVersion: makeReader({ '@vitest/coverage-v8': '5.0.2', 'vitest': '5.1.0' }) });
    }).toThrow(
      'caller(): "@vitest/coverage-v8" 5.0.2 is installed next to "vitest" 5.1.0; the two must be the same version.\n'
        + 'Run: npm install --save-dev @vitest/coverage-v8@5.1.0'
    );
  });

  it('reads this repository\'s own installed versions by default, which match', () => {
    expect(() => {
      assertVitestPeerVersions({ callerName: 'caller()' });
    }).not.toThrow();
  });
});

describe('readInstalledPackageVersion', () => {
  const temporaryFolders: string[] = [];

  afterEach(() => {
    for (const folder of temporaryFolders.splice(0)) {
      rmSync(folder, { force: true, recursive: true });
    }
  });

  function makeTree(): string {
    const root = mkdtempSync(join(tmpdir(), 'vitest-peers-'));
    temporaryFolders.push(root);
    return root;
  }

  function installPackage(folder: string, packageName: string, packageJson: Readonly<Record<string, string>>): void {
    const packageFolder = join(folder, 'node_modules', packageName);
    mkdirSync(packageFolder, { recursive: true });
    writeFileSync(join(packageFolder, 'package.json'), JSON.stringify(packageJson));
  }

  it('reads a scoped package from the nearest node_modules up the tree', () => {
    const root = makeTree();
    installPackage(root, '@vitest/coverage-v8', { version: '5.0.2' });
    const nested = join(root, 'packages', 'inner');
    mkdirSync(nested, { recursive: true });

    expect(readInstalledPackageVersion('@vitest/coverage-v8', nested)).toBe('5.0.2');
  });

  it('prefers the nearer copy', () => {
    const root = makeTree();
    installPackage(root, 'vitest', { version: '5.0.0' });
    const nested = join(root, 'inner');
    installPackage(nested, 'vitest', { version: '5.1.0' });

    expect(readInstalledPackageVersion('vitest', nested)).toBe('5.1.0');
  });

  it('returns null for a package.json without a string version', () => {
    const root = makeTree();
    installPackage(root, 'vitest', { name: 'vitest' });

    expect(readInstalledPackageVersion('vitest', root)).toBeNull();
  });

  it('returns null when no folder up the tree holds the package', () => {
    expect(readInstalledPackageVersion('no-such-package-anywhere-xyz', makeTree())).toBeNull();
  });

  it('starts from the project root by default', () => {
    expect(readInstalledPackageVersion('vitest')).toMatch(/^\d+\.\d+\.\d+/);
  });
});
