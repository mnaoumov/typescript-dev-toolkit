import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { configureTestApiDocs } from '../test-helpers/api-doc-fixtures.ts';
import {
  clearPackageDeclarations,
  DEFAULT_PACKAGE_SITES,
  getPackageTypeUrl,
  registerPackageDeclaration
} from './api-doc-package-sites.ts';

describe('api-doc package sites', () => {
  beforeEach(() => {
    configureTestApiDocs();
    clearPackageDeclarations();
  });

  it('defaults to the five @mnaoumov sites', () => {
    expect([...DEFAULT_PACKAGE_SITES]).toEqual([
      ['@mnaoumov/obsidian-dev-toolkit', 'https://mnaoumov.dev/obsidian-dev-toolkit/'],
      ['@mnaoumov/obsidian-lib', 'https://mnaoumov.dev/obsidian-lib/'],
      ['@mnaoumov/typescript-dev-toolkit', 'https://mnaoumov.dev/typescript-dev-toolkit/'],
      ['@mnaoumov/typescript-lib', 'https://mnaoumov.dev/typescript-lib/'],
      ['@mnaoumov/typescript-test-toolkit', 'https://mnaoumov.dev/typescript-test-toolkit/']
    ]);
  });

  it('links a declaration in a documented package with the generator\'s slug rules', () => {
    registerPackageDeclaration('RemoteApp', String.raw`C:\repo\node_modules\@mnaoumov\obsidian-lib\dist\lib\cjs\modals\alert.d.cts`);

    expect(getPackageTypeUrl('RemoteApp')).toBe('https://mnaoumov.dev/obsidian-lib/api/modals/alert/RemoteApp/');
  });

  it('accepts a printed import path without an extension', () => {
    registerPackageDeclaration('RemoteApp', '/repo/node_modules/@mnaoumov/obsidian-lib/dist/lib/esm/app');

    expect(getPackageTypeUrl('RemoteApp')).toBe('https://mnaoumov.dev/obsidian-lib/api/app/RemoteApp/');
  });

  it('ignores declarations outside the documented packages, and the documented package itself', () => {
    registerPackageDeclaration('Local', '/repo/src/local.ts');
    registerPackageDeclaration('Other', '/repo/node_modules/other/dist/lib/esm/other.d.mts');
    registerPackageDeclaration('Own', '/repo/node_modules/@mnaoumov/typescript-lib/dist/lib/esm/own.d.mts');

    expect(getPackageTypeUrl('Local')).toBeUndefined();
    expect(getPackageTypeUrl('Other')).toBeUndefined();
    expect(getPackageTypeUrl('Own')).toBeUndefined();
  });

  it('never links a name two packages declare', () => {
    configureTestApiDocs({ packageSites: new Map([['@mnaoumov/a', 'https://a/'], ['@mnaoumov/b', 'https://b/']]) });
    registerPackageDeclaration('Twice', '/r/node_modules/@mnaoumov/a/dist/lib/esm/x.d.mts');
    registerPackageDeclaration('Twice', '/r/node_modules/@mnaoumov/a/dist/lib/esm/x.d.mts');
    expect(getPackageTypeUrl('Twice')).toBe('https://a/api/x/Twice/');

    registerPackageDeclaration('Twice', '/r/node_modules/@mnaoumov/b/dist/lib/esm/x.d.mts');
    expect(getPackageTypeUrl('Twice')).toBeUndefined();
  });
});
