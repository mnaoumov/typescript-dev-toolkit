import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PageContent } from './api-doc-types.ts';

import {
  configureTestApiDocs,
  createMemberInfo,
  createTypeInfo,
  createTypes
} from '../test-helpers/api-doc-fixtures.ts';
import { registerRouteSegments } from './api-doc-link-rendering.ts';
import {
  buildBacklinksFromContent,
  buildSidebarTree,
  computeOverviewSignature,
  renderConstructorMdx,
  renderFrontMatter,
  renderFunctionPage,
  renderMethodOverloadMdx,
  renderTypeAliasPage,
  renderVariablePage,
  sidebarTreeToEntries
} from './api-doc-page-generation.ts';

describe('api-doc page generation', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it('builds backlinks using case-preserved route segments', () => {
    const alpha = createTypeInfo({ name: 'Alpha', namespace: 'alpha' });
    const bravo = createTypeInfo({ name: 'abortSignalAny', namespace: 'abort-controller' });
    const types = createTypes([alpha, bravo]);
    registerRouteSegments(types);
    const pages = new Map<string, PageContent>([
      ['abort-controller#abortSignalAny', { content: '', filePath: 'bravo.mdx' }],
      ['alpha#Alpha', { content: '[bravo](/typescript-lib/api/abort-controller/abortSignalAny/)', filePath: 'alpha.mdx' }]
    ]);

    expect(buildBacklinksFromContent(pages, types)).toEqual(new Map([['abort-controller#abortSignalAny', ['alpha#Alpha']]]));
  });

  it('creates sorted nested sidebar entries without a duplicated base path', () => {
    const types = createTypes([
      createTypeInfo({ name: 'Bravo', namespace: 'nested/charlie' }),
      createTypeInfo({ name: 'Alpha', namespace: 'nested/charlie' })
    ]);
    registerRouteSegments(types);

    const entries = sidebarTreeToEntries(buildSidebarTree(types), 'root');

    expect(entries).toMatchObject({
      items: [{ items: [{ items: [{ label: 'Overview', link: '/api/nested/charlie/' }, { label: 'Alpha', link: '/api/nested/charlie/Alpha/' }, { label: 'Bravo', link: '/api/nested/charlie/Bravo/' }], label: 'charlie' }], label: 'nested' }],
      label: 'root'
    });
  });

  it('emits description frontmatter whenever a page has one, so its OG card is never title-only', () => {
    expect(renderFrontMatter({ description: 'Array utilities.', sidebarLabel: 'array', slug: 'api/array', title: 'array' })).toEqual([
      '---',
      'title: "array"',
      'slug: "api/array"',
      'description: "Array utilities."',
      'editUrl: false',
      'sidebar:',
      '  label: "array"',
      '---',
      ''
    ]);
  });

  it('strips markdown and escapes quotes in frontmatter values', () => {
    expect(renderFrontMatter({
      description: 'Wraps `alpha` and the "bravo" [link](https://example.com).',
      sidebarLabel: 'Alpha.charlie',
      signature: 'function  charlie(value:   string): void',
      slug: 'api/alpha/charlie',
      title: 'Alpha.charlie method'
    })).toEqual([
      '---',
      'title: "Alpha.charlie method"',
      'slug: "api/alpha/charlie"',
      String.raw`description: "Wraps alpha and the \"bravo\" link."`,
      'signature: "function charlie(value: string): void"',
      'editUrl: false',
      'sidebar:',
      '  label: "Alpha.charlie"',
      '---',
      ''
    ]);
  });

  it('omits description and signature when the page has neither', () => {
    expect(renderFrontMatter({ sidebarLabel: 'Alpha', slug: 'api/alpha/Alpha', title: 'Alpha' })).toEqual([
      '---',
      'title: "Alpha"',
      'slug: "api/alpha/Alpha"',
      'editUrl: false',
      'sidebar:',
      '  label: "Alpha"',
      '---',
      ''
    ]);
  });

  it('computes overview signatures only for single-signature kinds', () => {
    expect(computeOverviewSignature('alpha', createTypeInfo({ kind: 'function', methods: [createMemberInfo({ returnType: 'Bravo', signature: 'alpha(value: Bravo)' })] }))).toBe('function alpha(value: Bravo): Bravo');
    expect(computeOverviewSignature('Alpha', createTypeInfo({ kind: 'type', name: 'Alpha', typeAliasText: 'Bravo' }))).toBe('type Alpha = Bravo');
    expect(computeOverviewSignature('alpha', createTypeInfo({ kind: 'variable', variableKeyword: 'const', variableType: 'Bravo' }))).toBe('const alpha: Bravo');
    expect(computeOverviewSignature('Alpha', createTypeInfo())).toBeUndefined();
  });
});

describe('api-doc page generation fallbacks', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it('sorts sibling module groups by name', () => {
    const types = createTypes([createTypeInfo({ name: 'Alpha', namespace: 'root/zulu' }), createTypeInfo({ name: 'Bravo', namespace: 'root/alpha' })]);
    registerRouteSegments(types);

    const entries = sidebarTreeToEntries(buildSidebarTree(types), 'all');

    expect(entries.items[0]).toMatchObject({ items: [{ label: 'alpha' }, { label: 'zulu' }], label: 'root' });
  });

  it('falls back when a declaration is missing its parts', () => {
    expect(computeOverviewSignature('alpha', createTypeInfo({ kind: 'function' }))).toBeUndefined();
    expect(computeOverviewSignature('Alpha', createTypeInfo({ kind: 'type', name: 'Alpha' }))).toBe('type Alpha = unknown');
    expect(computeOverviewSignature('alpha', createTypeInfo({ kind: 'variable' }))).toBe('let alpha: unknown');

    const lines: string[] = [];
    renderFunctionPage(lines, createTypeInfo({ kind: 'function' }), new Map());
    renderTypeAliasPage(lines, createTypeInfo({ kind: 'type', name: 'Alpha' }), new Map());
    renderVariablePage(lines, 'alpha', createTypeInfo({ kind: 'variable' }), new Map());
    renderConstructorMdx(lines, 'Alpha', createTypeInfo({ constructorInfo: createMemberInfo({ signature: '()' }) }), new Map());
    expect(lines).toContain('type Alpha = unknown');
    expect(lines).toContain('let alpha: unknown');
    expect(lines).toContain('<ConstructorBlock signature="new Alpha()" />');
  });

  it('escapes the braces of an inferred object return type, so MDX does not open an expression', () => {
    const lines: string[] = [];
    const codeSpan = '`{ watch }`';
    renderFunctionPage(
      lines,
      createTypeInfo({
        kind: 'function',
        methods: [createMemberInfo({ returnDescription: `The ${codeSpan} config, or {}.`, returnType: '{ watch?: Alpha; }', signature: 'alpha()' })]
      }),
      new Map()
    );
    expect(lines.find((line) => line.startsWith('**Returns:**'))).toBe(String.raw`**Returns:** \{ watch?: Alpha; \} — The ${codeSpan} config, or \{\}.`);
  });

  it('marks an undocumented optional parameter as optional and leaves a required one blank', () => {
    const lines: string[] = [];
    renderMethodOverloadMdx(
      lines,
      createMemberInfo({
        isStatic: true,
        parameters: [{ description: '', name: 'value?', type: 'string' }, { description: '', name: 'other', type: 'string' }]
      }),
      'Alpha',
      'alpha',
      new Map()
    );

    expect(lines[0]).toContain('isStatic={true}');
    expect(lines[0]).toContain('*(Optional)*');
    expect(lines[0]).toContain('{"description":"","name":"other"');
  });
});
