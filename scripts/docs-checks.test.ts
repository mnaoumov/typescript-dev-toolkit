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

describe('this package', () => {
  it('should compile every snippet of its guides', async () => {
    expect(formatDocsSnippetProblems(await findDocsSnippetProblems(DOCS_SNIPPETS_PARAMS))).toBe('');
  });

  it('should hold no outdated reference', async () => {
    expect(formatOutdatedReferences(await findOutdatedReferences(DOCS_SNIPPETS_PARAMS.rootDirectory))).toBe('');
  });
});
