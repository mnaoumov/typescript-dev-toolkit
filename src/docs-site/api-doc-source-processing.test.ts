import dedent from 'dedent';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join,
  relative
} from 'node:path';
import { Project } from 'ts-morph';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { TypeInfo } from './api-doc-types.ts';

import { configureTestApiDocs } from '../test-helpers/api-doc-fixtures.ts';
import { GENERIC_TYPE_PARAMS } from './api-doc-constants.ts';
import {
  collectFunctions,
  collectVariables,
  computeNamespace,
  findEntryFiles,
  processSourceFile,
  registerGenericTypeParams
} from './api-doc-source-processing.ts';

describe('api-doc source processing', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it('collects exported declarations and skips private implementation details', () => {
    const sourceFile = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      'alpha.ts',
      dedent`
        /** A function.
         * @param value - The input.
         * @returns - The output.
         */
        export function alpha(value: string): number { return value.length; }
        /** A value. */
        export const BRAVO = 'bravo';
        function hidden(): void {}
      `
    );
    const types = new Map<string, TypeInfo>();

    collectFunctions(sourceFile, types, 'alpha');
    collectVariables(sourceFile, types, 'alpha');

    expect(types).toMatchObject(
      new Map([
        ['alpha#alpha', { kind: 'function', methods: [{ parameters: [{ description: 'The input.', name: 'value' }], returnDescription: 'The output.', returnType: 'number' }] }],
        ['alpha#BRAVO', { kind: 'variable', variableKeyword: 'const', variableType: '"bravo"' }]
      ])
    );
  });

  it('processes classes, interfaces, enums, aliases, and generic type parameters', () => {
    const sourceFile = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      'bravo.ts',
      dedent`
        export class Alpha<T> {}
        export interface Bravo {}
        export enum Charlie { Delta }
        export type Echo<T> = T;
      `
    );
    const types = new Map<string, TypeInfo>();

    processSourceFile(sourceFile, types, 'bravo');
    registerGenericTypeParams(types);

    expect([...types.values()].map((info) => info.kind).sort()).toEqual(['class', 'enum', 'interface', 'type']);
    expect(types.has('bravo#T')).toBe(false);
    expect(computeNamespace('F:/repo/src', 'F:/repo/src/nested/alpha.ts')).toBe('nested/alpha');
  });

  it('registers the site\'s extra generic type parameter names', () => {
    configureTestApiDocs({ genericTypeParameters: ['TMockOnly'] });
    expect(GENERIC_TYPE_PARAMS.has('TMockOnly')).toBe(false);

    registerGenericTypeParams(new Map());

    expect(GENERIC_TYPE_PARAMS.has('TMockOnly')).toBe(true);
  });

  it('skips the extra directories a site excludes when it finds the entry files', () => {
    const root = mkdtempSync(join(tmpdir(), 'api-doc-entry-files-'));
    try {
      for (const directory of ['internal', 'jest', 'styles', 'public']) {
        mkdirSync(join(root, directory));
        writeFileSync(join(root, directory, 'alpha.ts'), '');
      }

      expect(findEntryFiles(root).map((path) => relative(root, path).replaceAll('\\', '/')).sort()).toEqual(['internal/alpha.ts', 'jest/alpha.ts', 'public/alpha.ts']);
      expect(findEntryFiles(root, ['internal', 'jest']).map((path) => relative(root, path).replaceAll('\\', '/'))).toEqual(['public/alpha.ts']);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
