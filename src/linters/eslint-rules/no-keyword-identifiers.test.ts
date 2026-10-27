import { RuleTester } from '@typescript-eslint/rule-tester';
import {
  afterAll,
  describe,
  it
} from 'vitest';

import { noKeywordIdentifiers } from './no-keyword-identifiers.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('no-keyword-identifiers', toRuleTesterModule(noKeywordIdentifiers), {
  invalid: [
    ...['object', 'string', 'number', 'boolean', 'symbol', 'bigint', 'undefined', 'module', 'event'].map((name) => ({
      code: `function sample(${name}: unknown) { return () => ${name}; }`,
      errors: [{
        data: { name, replacement: `$${name}` },
        messageId: 'restricted',
        suggestions: [{ messageId: 'rename', output: `function sample($${name}: unknown) { return () => $${name}; }` }]
      }],
      output: null
    })),
    {
      code: 'function sample(arguments) { return arguments; }',
      errors: [{ messageId: 'restricted', suggestions: [{ messageId: 'rename', output: 'function sample($arguments) { return $arguments; }' }] }],
      languageOptions: { parserOptions: { sourceType: 'script' } },
      output: null
    },
    ...[
      'export function sample(object: unknown) { return object; }',
      'const object = 1; const value = { object };',
      'const { object } = source;',
      'import { object } from "pkg";',
      'const object = 1; export { object };',
      'class Sample { constructor(public object: unknown) {} }',
      'const object = 1; function nested($object: unknown) { return object; }',
      'function sample(object: unknown) { return [object, $object]; }'
    ].map((code) => ({ code, errors: [{ messageId: 'restricted', suggestions: [] }], output: null })),
    {
      code: 'class object { create() { return new object(); } } const value = new object();',
      errors: [{ messageId: 'restricted', suggestions: [] }],
      output: null
    },
    {
      code: 'const object: unknown = 1; type Value = typeof object;',
      errors: [{ messageId: 'restricted', suggestions: [{ messageId: 'rename', output: 'const $object: unknown = 1; type Value = typeof $object;' }] }],
      output: null
    },
    {
      code: 'try { sample(); } catch (event) { console.log(event); }',
      errors: [{ messageId: 'restricted', suggestions: [{ messageId: 'rename', output: 'try { sample(); } catch ($event) { console.log($event); }' }] }],
      output: null
    },
    {
      code: 'function object() { return object; } object();',
      errors: [{ messageId: 'restricted', suggestions: [{ messageId: 'rename', output: 'function $object() { return $object; } $object();' }] }],
      output: null
    }
  ],
  valid: [
    'function sample($object: object, objectPath: string) { return [$object, objectPath]; }',
    'const value = undefined; const kind = api.string; const schema = { string: 1, function() {} };',
    'interface Options { readonly object: object; readonly string: string; }',
    'import { object as $object } from "pkg";',
    'export { object } from "pkg";',
    'function sample() { return arguments; }',
    'type Sample = string | number | boolean | symbol | bigint | undefined;'
  ]
});
