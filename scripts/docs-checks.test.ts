import {
  describe,
  expect,
  it
} from 'vitest';

import {
  findDocsSnippetProblems,
  formatDocsSnippetProblems
} from '../src/docs-site/docs-snippets.ts';
import {
  findOutdatedReferences,
  formatOutdatedReferences
} from '../src/docs-site/outdated-references.ts';
import { DOCS_SNIPPETS_PARAMS } from './docs-snippets-config.ts';

// Compiling every guide snippet builds one program over `src/`, which takes tens of seconds.
const FULL_CHECK_TIMEOUT_IN_MILLISECONDS = 180_000;

describe('this package', () => {
  it('should compile every snippet of its guides', { timeout: FULL_CHECK_TIMEOUT_IN_MILLISECONDS }, async () => {
    expect(formatDocsSnippetProblems(await findDocsSnippetProblems(DOCS_SNIPPETS_PARAMS))).toBe('');
  });

  it('should hold no outdated reference', async () => {
    expect(formatOutdatedReferences(await findOutdatedReferences(DOCS_SNIPPETS_PARAMS.rootDirectory))).toBe('');
  });
});
