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
  memberHref,
  registerMemberPages,
  registerRouteSegments
} from './api-doc-link-rendering.ts';
import {
  buildTypeParameterMap,
  parseTypeArguments,
  resolveInheritedMembers,
  substituteMemberTypes,
  substituteTypeParams
} from './api-doc-type-merging.ts';

describe('api-doc type merging', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it('parses nested generic arguments and maps parent parameters', () => {
    expect(parseTypeArguments('Alpha<Bravo<Charlie>, Delta>')).toEqual(['Bravo<Charlie>', 'Delta']);
    expect(buildTypeParameterMap(createTypeInfo({ typeParameters: ['T extends Base', 'U'] }), ['Bravo', 'Charlie'])).toEqual(new Map([['T', 'Bravo'], ['U', 'Charlie']]));
  });

  it('substitutes only whole type-parameter identifiers', () => {
    const mapping = new Map([['T', 'Bravo']]);
    expect(substituteTypeParams('T | TExtra | Array<T>', mapping)).toBe('Bravo | TExtra | Array<Bravo>');
    expect(substituteMemberTypes(createMemberInfo({ parameters: [{ description: '', name: 'value', type: 'T' }], returnType: 'T', signature: 'alpha(value: T)', type: 'T' }), mapping)).toMatchObject({
      parameters: [{ type: 'Bravo' }],
      returnType: 'Bravo',
      signature: 'alpha(value: Bravo)',
      type: 'Bravo'
    });
  });

  it('copies inherited members once and annotates their origin', () => {
    const base = createTypeInfo({ methods: [createMemberInfo({ name: 'alpha', returnType: 'T', signature: 'alpha(value: T)' })], name: 'Base', properties: [createMemberInfo({ name: 'value', type: 'T' })], typeParameters: ['T'] });
    const child = createTypeInfo({ baseTypes: ['Base<Bravo>'], name: 'Child' });
    const types = new Map([
      ['base', base],
      ['child', child]
    ]);

    resolveInheritedMembers(types);
    resolveInheritedMembers(types);

    expect(child.properties).toMatchObject([{ inheritedFrom: 'Base', name: 'value', type: 'Bravo' }]);
    expect(child.methods).toMatchObject([{ inheritedFrom: 'Base', name: 'alpha', returnType: 'Bravo', signature: 'alpha(value: Bravo)' }]);
  });
});

describe('api-doc type merging edge cases', () => {
  beforeEach(() => {
    configureTestApiDocs();
  });

  it.each([false, true])('resolves three levels and declaring pages regardless of processing order (%s)', (reverse) => {
    const grand = createTypeInfo({
      methods: [
        createMemberInfo({ name: 'read', overloadKey: 'read', parameters: [{ description: '', name: 'value', type: 'T' }], returnType: 'T', signature: 'read(value: T)' }),
        createMemberInfo({ name: 'read', overloadKey: 'read', parameters: [], returnType: 'T', signature: 'read()' })
      ],
      name: 'Grand',
      properties: [createMemberInfo({ name: 'value', type: 'T' })],
      typeParameters: ['T']
    });
    const parent = createTypeInfo({ baseTypes: ['Grand<U[]>'], name: 'Parent', typeParameters: ['U'] });
    const child = createTypeInfo({ baseTypes: ['Parent<string>'], name: 'Child' });
    const entries: [string, typeof grand][] = [['alpha#Grand', grand], ['alpha#Parent', parent], ['alpha#Child', child]];
    const types = new Map(reverse ? entries.reverse() : entries);

    resolveInheritedMembers(types);
    registerRouteSegments(types);
    registerMemberPages(types);

    expect(child.properties).toMatchObject([{ inheritedFrom: 'Parent', type: 'string[]' }]);
    expect(child.methods).toMatchObject([
      { parameters: [{ type: 'string[]' }], returnType: 'string[]' },
      { parameters: [], returnType: 'string[]' }
    ]);
    expect(memberHref('value', 'Parent', types, 'alpha')).toBe('/typescript-lib/api/alpha/Grand/value/');
    expect(memberHref('read', 'Parent', types, 'alpha')).toBe('/typescript-lib/api/alpha/Grand/read/');
    resolveInheritedMembers(types);
    expect(child.methods).toHaveLength(2);
  });

  it('terminates cyclic inheritance without creating member links to missing pages', () => {
    const first = createTypeInfo({ baseTypes: ['Second'], name: 'First' });
    const second = createTypeInfo({ baseTypes: ['First'], name: 'Second' });
    const types = new Map([['alpha#First', first], ['alpha#Second', second]]);
    resolveInheritedMembers(types);
    registerMemberPages(types);
    expect(memberHref('value', 'First', types)).toBe('');
  });

  it('skips a base type the site does not document', () => {
    const child = createTypeInfo({ baseTypes: ['Error'], name: 'Child' });
    const types = new Map([['alpha#Child', child]]);

    resolveInheritedMembers(types);

    expect(child.properties).toEqual([]);
  });

  it('reads no argument out of an empty argument list', () => {
    expect(parseTypeArguments('Foo<>')).toEqual([]);
  });

  it('leaves text and members alone when nothing is substituted', () => {
    const member = createMemberInfo({ type: 'T' });

    expect(substituteTypeParams('T', new Map())).toBe('T');
    expect(substituteMemberTypes(member, new Map())).toBe(member);
  });
});
