import {
  describe,
  expect,
  it
} from 'vitest';

import {
  isDocumentedDirectoryName,
  isDocumentedFileName,
  isDocumentedModulePath
} from './api-doc-documented-files.ts';

describe('api-doc documented files', () => {
  it('excludes the @types, styles and test-helpers subtrees', () => {
    expect(isDocumentedDirectoryName('@types')).toBe(false);
    expect(isDocumentedDirectoryName('styles')).toBe(false);
    expect(isDocumentedDirectoryName('test-helpers')).toBe(false);
    expect(isDocumentedDirectoryName('linters')).toBe(true);
  });

  it('excludes the extra directories a site names, on top of the defaults', () => {
    expect(isDocumentedDirectoryName('internal', ['internal', 'jest'])).toBe(false);
    expect(isDocumentedDirectoryName('jest', ['internal', 'jest'])).toBe(false);
    expect(isDocumentedDirectoryName('styles', ['internal'])).toBe(false);
    expect(isDocumentedDirectoryName('linters', ['internal'])).toBe(true);
  });

  it('documents ordinary TypeScript modules only', () => {
    expect(isDocumentedFileName('eslint.ts')).toBe(true);
    for (const name of ['readme.md', 'types.d.ts', 'index.ts', '__merged.ts', 'setup.ts', 'vitest-setup.ts', 'a.test.ts', 'a.integration.test.ts']) {
      expect(isDocumentedFileName(name)).toBe(false);
    }
  });

  it('judges a module path by its folders and its file name', () => {
    expect(isDocumentedModulePath('linters/eslint')).toBe(true);
    expect(isDocumentedModulePath('app')).toBe(true);
    expect(isDocumentedModulePath('linters/markdownlint-types/@types/markdownlint-cli2-config-schema')).toBe(false);
    expect(isDocumentedModulePath('test-runners/vitest-setup')).toBe(false);
    expect(isDocumentedModulePath('index')).toBe(false);
  });
});
