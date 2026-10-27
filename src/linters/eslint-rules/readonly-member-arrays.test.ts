import { RuleTester } from '@typescript-eslint/rule-tester';
import {
  afterAll,
  describe,
  it
} from 'vitest';

import { readonlyMemberArrays } from './readonly-member-arrays.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('readonly-member-arrays', toRuleTesterModule(readonlyMemberArrays), {
  invalid: [
    {
      code: 'interface State { values: Array<string,>; }',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'interface State { values: ReadonlyArray<string,>; }' }] }],
      name: 'generic array suggestions preserve trailing comma syntax',
      output: null
    },
    {
      code: 'type ReadonlyArray<T> = { custom: T }; interface State { values: Array<string>; }',
      errors: [{ messageId: 'readonly', suggestions: [] }],
      name: 'shadowed ReadonlyArray cannot receive a suggestion that changes type identity',
      output: null
    },
    {
      code: 'interface State { values: (string | number)[] & { label: string }; }',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'interface State { values: readonly (string | number)[] & { label: string }; }' }] }],
      name: 'parenthesized elements and intersection members keep their syntax',
      output: null
    },
    {
      code: 'interface State { values: Array</* element */ string>; }',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'interface State { values: ReadonlyArray</* element */ string>; }' }] }],
      name: 'generic array suggestions preserve comments',
      output: null
    },
    {
      code: 'interface State { readonly values: string[]; }',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'interface State { readonly values: readonly string[]; }' }] }],
      name: 'readonly property references still expose mutable arrays',
      output: null
    },
    {
      code: 'type State = { nested: { values?: number[] | undefined } };',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'type State = { nested: { values?: readonly number[] | undefined } };' }] }],
      name: 'nested alias properties and nullable arrays require review',
      output: null
    },
    {
      code: 'interface State { values: Array<string | number>; }',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'interface State { values: ReadonlyArray<string | number>; }' }] }],
      name: 'generic Array becomes the readonly builtin when neither name is shadowed',
      output: null
    },
    {
      code: 'type State = { values: string[][] };',
      errors: [{ messageId: 'readonly', suggestions: [{ messageId: 'review', output: 'type State = { values: readonly string[][] };' }] }],
      name: 'only the member array is changed, without promising deep immutability',
      output: null
    }
  ],
  valid: [
    'interface State { values; }',
    'interface State { values: string; other: NS.Array<string>; bare: Array; }',
    'interface State<Array> { values: Array<string>; }',
    'interface State { values: readonly string[]; generic: ReadonlyArray<string>; }',
    'interface State { values: readonly string[][]; }',
    'interface State { create(): string[]; callback: (values: string[]) => number[]; }',
    'const state: { values: string[] } = { values: [] };',
    'type Array<T> = { custom: T }; interface State { values: Array<string>; }',
    'type State<Array> = { values: Array };',
    'interface State { values: Promise<string[]>; tuple: [string, number]; }',
    'type Values = string[];',
    'interface State {\n// eslint-disable-next-line @rule-tester/readonly-member-arrays -- Accumulated during collection.\nvalues: string[];\n}'
  ]
});
