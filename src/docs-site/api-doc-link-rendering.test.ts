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
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  configureTestApiDocs,
  createMemberInfo,
  createTypeInfo,
  createTypes
} from '../test-helpers/api-doc-fixtures.ts';
import {
  findType,
  linkBaseType,
  loadExternalTypeMaps,
  markdownToHtml,
  memberHref,
  registerMemberPages,
  registerRouteSegments,
  renderMdxProse,
  renderTypeWithLinks,
  resolveLinks,
  resolveTsUtilityUrl,
  resolveWebApiUrl,
  toTypeFileSegment,
  toTypeRouteSegment,
  typeLink
} from './api-doc-link-rendering.ts';
import {
  clearPackageDeclarations,
  registerPackageDeclaration
} from './api-doc-package-sites.ts';

describe('api-doc link rendering', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disambiguates case-only route collisions so slugs never collide on a case-insensitive filesystem', () => {
    const types = createTypes([
      createTypeInfo({ name: 'AbortSignalAny' }),
      createTypeInfo({ name: 'abortSignalAny' })
    ]);

    registerRouteSegments(types);

    // The two names lowercase to the same slug, so exactly one keeps the pretty case-preserved route
    // while the other is suffixed. Otherwise `/AbortSignalAny/` and `/abortSignalAny/` would overwrite
    // each other when Astro writes to a case-insensitive filesystem (Windows/macOS), 404-ing links.
    const routeSegments = new Set([toTypeRouteSegment('alpha', 'AbortSignalAny'), toTypeRouteSegment('alpha', 'abortSignalAny')]);
    expect(routeSegments).toEqual(new Set(['abortSignalAny', 'AbortSignalAny-2']));
    expect(new Set([...routeSegments].map((segment) => segment.toLowerCase()))).toEqual(new Set(['abortsignalany', 'abortsignalany-2']));
    expect(
      new Set([
        toTypeFileSegment('alpha', 'AbortSignalAny'),
        toTypeFileSegment('alpha', 'abortSignalAny')
      ])
    ).toEqual(new Set(['abortsignalany', 'abortsignalany-2']));
  });

  it('resolves same-namespace types but leaves ambiguous names unlinked', () => {
    const local = createTypeInfo({ name: 'Alpha', namespace: 'local' });
    const remote = createTypeInfo({ name: 'Alpha', namespace: 'remote' });
    const types = createTypes([local, remote]);
    registerRouteSegments(types);

    expect(findType(types, 'Alpha', 'local')).toBe(local);
    expect(findType(types, 'Alpha')).toBeUndefined();
    expect(renderTypeWithLinks('Alpha | Promise<string>', types, undefined, 'local')).toContain('[Alpha](/typescript-lib/api/local/Alpha/)');
    expect(renderTypeWithLinks('Alpha', types)).toBe('Alpha');
  });

  it('links only generated member pages and renders safe MDX prose', () => {
    const typeInfo = createTypeInfo({ methods: [createMemberInfo({ name: 'showNotice', overloadKey: 'showNotice' })], name: 'PluginNoticeComponent', properties: [createMemberInfo({ name: 'enabled' })] });
    const types = createTypes([typeInfo]);
    registerRouteSegments(types);
    registerMemberPages(types);

    expect(memberHref('showNotice', '', types, 'alpha')).toBe('./showNotice/');
    expect(resolveLinks('{@link PluginNoticeComponent.showNotice}', types, 'alpha')).toBe('[PluginNoticeComponent.showNotice](/typescript-lib/api/alpha/PluginNoticeComponent/showNotice/)');
    expect(renderMdxProse('Use <Alpha> and {@link PluginNoticeComponent}.', types, 'alpha')).toBe(String.raw`Use \<Alpha> and [PluginNoticeComponent](/typescript-lib/api/alpha/PluginNoticeComponent/).`);
  });

  it('converts inline Markdown without emitting unsafe relative links', () => {
    expect(markdownToHtml('[Guide](/guide) [image](image.png) `code`')).toBe('<a href="/guide">Guide</a> <code>[image](image.png)</code> <code>code</code>');
  });
});

describe('api-doc link rendering edge cases', () => {
  beforeEach(() => {
    configureTestApiDocs({ externalTypeLinks: new Map([['App', 'https://example.com/app']]) });
    clearPackageDeclarations();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links a complex base type as a whole', () => {
    const types = createTypes([createTypeInfo({ name: 'Alpha' })]);
    registerRouteSegments(types);

    expect(linkBaseType('Alpha & { extra: true }', types)).toBe('`Alpha & { extra: true }`');
    expect(linkBaseType('Alpha', types)).toBe('[Alpha](/typescript-lib/api/alpha/Alpha/)');
    expect(typeLink('Alpha<string>', types)).toBe(String.raw`[Alpha\<string\>](/typescript-lib/api/alpha/Alpha/)`);
    expect(typeLink('Unknown', types)).toBe('`Unknown`');
  });

  it('leaves an inherited member unlinked when its declaring type has no page for it', () => {
    const parent = createTypeInfo({ name: 'Parent', properties: [createMemberInfo({ inheritedFrom: 'Grand', name: 'value' })] });
    const types = createTypes([parent]);
    registerRouteSegments(types);
    registerMemberPages(types);

    expect(memberHref('value', 'Parent', types)).toBe('');
    expect(memberHref('value', 'Missing', types)).toBe('');
  });

  it('links an inherited member to its declaring type\'s page', () => {
    const parent = createTypeInfo({ name: 'Parent', properties: [createMemberInfo({ name: 'value' })] });
    const types = createTypes([parent]);
    registerRouteSegments(types);
    registerMemberPages(types);

    expect(memberHref('value', 'Parent', types)).toBe('/typescript-lib/api/alpha/Parent/value/');
  });

  it('labels a fenced code block that names no language as TypeScript', () => {
    expect(renderMdxProse('```\nconst x = 1;\n```', new Map())).toBe('```ts\nconst x = 1;\n```');
    expect(renderMdxProse('```js\nconst x = 1;\n```', new Map())).toBe('```js\nconst x = 1;\n```');
  });

  it('links Object methods to MDN and keeps existing links', () => {
    const rendered = renderTypeWithLinks('Object.keys | [Kept](https://kept)', new Map());

    expect(rendered).toContain('[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object).[keys](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/keys)');
    expect(rendered).toContain('[Kept](https://kept)');
  });

  it('links site-mapped and other-package types, and leaves the rest as text', () => {
    registerPackageDeclaration('RemoteApp', '/r/node_modules/@mnaoumov/obsidian-lib/dist/lib/esm/app.d.mts');

    expect(renderTypeWithLinks('App | RemoteApp | Nowhere | this', new Map())).toBe('[App](https://example.com/app) | [RemoteApp](https://mnaoumov.dev/obsidian-lib/api/app/RemoteApp/) | Nowhere | this');
    expect(resolveLinks('{@link App} {@link RemoteApp | the app} {@link Nowhere}', new Map())).toBe('[App](https://example.com/app) [the app](https://mnaoumov.dev/obsidian-lib/api/app/RemoteApp/) `Nowhere`');
  });

  it('links each type argument of a generic link display', () => {
    const types = createTypes([createTypeInfo({ name: 'Alpha' })]);
    registerRouteSegments(types);

    expect(resolveLinks('{@link Alpha | Alpha<string>} {@link Alpha | the alpha} {@link Alpha.missing}', types)).toBe('[Alpha](/typescript-lib/api/alpha/Alpha/)<[string](https://www.typescriptlang.org/docs/handbook/basic-types.html#string)> [the alpha](/typescript-lib/api/alpha/Alpha/) `Alpha.missing`');
  });

  it('resolves TypeScript utility types to the right handbook page', () => {
    expect(resolveTsUtilityUrl('Iterable')).toBe('https://www.typescriptlang.org/docs/handbook/iterators-and-generators.html#iterable-interface');
    expect(resolveTsUtilityUrl('Capitalize')).toBe('https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html#capitalizestringtype');
    expect(resolveTsUtilityUrl('Partial')).toBe('https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype');
    expect(resolveTsUtilityUrl('Nope')).toBeUndefined();
    expect(resolveWebApiUrl('Nope')).toBeUndefined();
    expect(renderTypeWithLinks('this', new Map(), 'Missing')).toBe('this');
  });

  it('falls back to the bare slug rules for an unregistered type', () => {
    expect(toTypeFileSegment('nowhere', 'Some Type')).toBe('some type');
    expect(toTypeRouteSegment('nowhere', 'Some Type')).toBe('Some-Type');
  });

  it('warns about two members that map to one route', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const types = createTypes([createTypeInfo({
      methods: [createMemberInfo({ name: 'on', overloadKey: 'on("a-b")' }), createMemberInfo({ name: 'on', overloadKey: 'on("ab")' })],
      name: 'Alpha',
      properties: [createMemberInfo({ name: 'value?' }), createMemberInfo({ name: 'value' })]
    })]);

    registerRouteSegments(types);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Member route collision'));
  });
});

describe('api-doc Web API links', () => {
  it('reads string and object entries and ignores anything else', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'web-api-'));
    try {
      mkdirSync(join(root, 'node_modules/typedoc-plugin-mdn-links/data'), { recursive: true });
      writeFileSync(join(root, 'node_modules/typedoc-plugin-mdn-links/data/web-api.json'), JSON.stringify({ Broken: 1, Null: null, Plain: 'https://p', WithoutUrl: {}, WithUrl: { url: 'https://w' } }));

      loadExternalTypeMaps(root);

      expect(resolveWebApiUrl('Plain')).toBe('https://p');
      expect(resolveWebApiUrl('WithUrl')).toBe('https://w');
      expect(resolveWebApiUrl('WithoutUrl')).toBeUndefined();
      expect(resolveWebApiUrl('Null')).toBeUndefined();
      expect(resolveWebApiUrl('Broken')).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
      vi.restoreAllMocks();
    }
  });
});
