/**
 * @file
 *
 * How this package's own guide snippets are type-checked, shared by `docs:check-snippets` and the gate test.
 *
 * The guides import this package by name, which it cannot install, so the check resolves that name onto `src/`
 * through its compiler options. A `tsconfig.json` `paths` entry would do the same for the whole project and let a
 * script import the package by name without anything failing.
 */

import { fileURLToPath } from 'node:url';

import type { FindDocsSnippetProblemsParams } from '../src/docs-site/docs-snippets.ts';

const ROOT_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/**
 * The parameters this package's guide snippets are checked with.
 */
export const DOCS_SNIPPETS_PARAMS: FindDocsSnippetProblemsParams = {
  compilerOptions: {
    paths: {
      '@mnaoumov/typescript-dev-toolkit/*': [fileURLToPath(new URL('../src/*.ts', import.meta.url))]
    }
  },
  rootDirectory: ROOT_DIRECTORY
};
