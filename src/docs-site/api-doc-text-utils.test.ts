import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  configureTestApiDocs,
  createMemberInfo,
  createTypeInfo
} from '../test-helpers/api-doc-fixtures.ts';
import {
  computeOverloadKey,
  escapeMdxProse,
  foldTsDocParagraphs,
  getDisplayName,
  getImportStatement,
  memberRouteSegment,
  memberSlug,
  overloadRouteSegment,
  overloadSlug,
  segmentMarkdown,
  simplifyType,
  stripMarkdown,
  truncateSignature
} from './api-doc-text-utils.ts';

describe('api-doc text utilities', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it('keys event-method overloads by literal event name', () => {
    expect(computeOverloadKey(createMemberInfo({ name: 'on', parameters: [{ description: '', name: 'event', type: '"changed"' }] }))).toBe('on(\'changed\')');
    expect(computeOverloadKey(createMemberInfo({ name: 'on', parameters: [{ description: '', name: 'event', type: 'string' }] }))).toBe('on');
  });

  it('escapes only MDX-unsafe prose characters', () => {
    expect(escapeMdxProse('A < B {value}; `C<D` and [link](<url>)')).toBe('A \\< B \\{value\\}; `C<D` and [link](<url>)');
  });

  it('preserves fenced code while folding prose paragraphs', () => {
    expect(foldTsDocParagraphs('first\nline\n\n```ts\nconst alpha = 1;\n```\n\nlast\nline')).toBe('first line\n\n```ts\nconst alpha = 1;\n```\n\nlast line');
    expect(segmentMarkdown('prose\n~~~js\nconst alpha = 1;\n~~~\nend')).toEqual([
      { text: 'prose', type: 'prose' },
      { lang: 'js', text: 'const alpha = 1;', type: 'code' },
      { text: 'end', type: 'prose' }
    ]);
  });

  it('generates stable case-preserved routes and lowercase filenames', () => {
    expect(memberRouteSegment('showNotice')).toBe('showNotice');
    expect(memberSlug('showNotice')).toBe('shownotice');
    expect(memberRouteSegment('index')).toBe('index-member');
    expect(overloadRouteSegment('on("changed")')).toBe('on-changed');
    expect(overloadSlug('on("changed")')).toBe('on-changed');
  });

  it('renders API display and import metadata', () => {
    const typeInfo = createTypeInfo({ kind: 'interface', name: 'Alpha', namespace: 'nested/alpha', typeParameters: ['T extends Base', 'U'] });
    expect(getDisplayName('Alpha', typeInfo)).toBe('Alpha<T, U>');
    expect(getImportStatement(typeInfo)).toBe('import type { Alpha } from \'@mnaoumov/typescript-lib/nested/alpha\';');
    expect(getImportStatement(createTypeInfo({ kind: 'function', name: 'bravo', namespace: 'bravo' }))).toBe('import { bravo } from \'@mnaoumov/typescript-lib/bravo\';');
  });

  it('builds import statements with the site\'s hook, which may show none', () => {
    configureTestApiDocs({
      importStatement: ({ defaultImportStatement, isTypeOnly, kind, name, namespace }) => {
        if (namespace.startsWith('globals/')) {
          return;
        }
        if (namespace.startsWith('obsidian/')) {
          return `${isTypeOnly ? 'import type' : 'import'} { ${name} } from 'obsidian-test-mocks/obsidian'; // ${kind}`;
        }
        return defaultImportStatement;
      }
    });
    expect(getImportStatement(createTypeInfo({ kind: 'class', name: 'App', namespace: 'obsidian/App' }))).toBe('import { App } from \'obsidian-test-mocks/obsidian\'; // class');
    expect(getImportStatement(createTypeInfo({ kind: 'interface', name: 'Alpha', namespace: 'obsidian/Alpha' }))).toBe('import type { Alpha } from \'obsidian-test-mocks/obsidian\'; // interface');
    expect(getImportStatement(createTypeInfo({ kind: 'function', name: 'setup', namespace: 'globals/setup' }))).toBeUndefined();
    expect(getImportStatement(createTypeInfo({ kind: 'function', name: 'bravo', namespace: 'bravo' }))).toBe('import { bravo } from \'@mnaoumov/typescript-lib/bravo\';');
  });

  it('keeps trailing underscores, so members differing only by them get a page each', () => {
    expect(memberRouteSegment('create__')).toBe('create__');
    expect(memberRouteSegment('create')).toBe('create');
    expect(memberSlug('Create_')).toBe('create_');
    expect(memberRouteSegment('\'quoted_\'')).toBe('quoted_');
    expect(overloadRouteSegment('create__')).toBe('create__');
    expect(overloadSlug('Create__')).toBe('create__');
    expect(memberRouteSegment('__')).toBe('unnamed');
    expect(overloadRouteSegment('on(\'changed\')')).toBe('on-changed');
  });

  it('builds member routes with the site\'s hook where it returns a segment', () => {
    configureTestApiDocs({ memberRouteSegment: (name) => (name.endsWith('__') ? `${name.slice(0, -'__'.length)}-mock` : undefined) });
    expect(memberRouteSegment('create__')).toBe('create-mock');
    expect(memberSlug('Create__')).toBe('create-mock');
    expect(overloadRouteSegment('create__')).toBe('create-mock');
    expect(memberRouteSegment('create')).toBe('create');
    expect(memberRouteSegment('index')).toBe('index-member');
  });

  it('normalizes type and description text for generated pages', () => {
    expect(simplifyType('import("pkg").App | import(\'node:fs\').Stats')).toBe('App | Stats');
    const REPEATED_WORD_COUNT = 40;
    const MAX_SIGNATURE_LENGTH = 160;
    expect(truncateSignature(`  ${'alpha '.repeat(REPEATED_WORD_COUNT)}  `)).toHaveLength(MAX_SIGNATURE_LENGTH);
    expect(stripMarkdown('**Alpha** {@link Bravo | Bravo label} [Charlie](https://example.com)')).toBe('Alpha Bravo label Charlie');
    expect(stripMarkdown('It installs the {@link Bravo} and the {@link Bravo.charlie } it reports to.')).toBe('It installs the Bravo and the Bravo.charlie it reports to.');
  });

  it('truncates over-long descriptions at a word boundary', () => {
    const REPEATED_WORD_COUNT = 40;
    const MAX_DESCRIPTION_LENGTH = 160;
    const truncated = stripMarkdown(`${'alpha bravo '.repeat(REPEATED_WORD_COUNT)}charlie`);
    expect(truncated.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(truncated).toMatch(/(?:alpha|bravo)…$/);
  });
});

describe('api-doc text utility edge cases', () => {
  it('runs an unclosed fence to the end of the text', () => {
    expect(segmentMarkdown('before\n```ts\nconst x = 1;')).toEqual([
      { text: 'before', type: 'prose' },
      { lang: 'ts', text: 'const x = 1;', type: 'code' }
    ]);
  });

  it('names a member without letters or digits', () => {
    expect(memberRouteSegment('$')).toBe('unnamed');
    expect(overloadRouteSegment('index')).toBe('index-member');
  });

  it('clips a long description without spaces', () => {
    const MAX_DESCRIPTION_LENGTH = 160;
    expect(stripMarkdown('x'.repeat(MAX_DESCRIPTION_LENGTH * 2))).toBe(`${'x'.repeat(MAX_DESCRIPTION_LENGTH - 1)}…`);
  });
});
