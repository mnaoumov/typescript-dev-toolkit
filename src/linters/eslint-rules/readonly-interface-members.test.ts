import { RuleTester } from '@typescript-eslint/rule-tester';
import {
  afterAll,
  describe,
  it
} from 'vitest';

import {
  MESSAGE_ID,
  readonlyInterfaceMembers
} from './readonly-interface-members.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('readonly-interface-members', toRuleTesterModule(readonlyInterfaceMembers), {
  invalid: [
    {
      code: 'interface Subscription { handler: () => void; install?: () => void; }',
      errors: [{ messageId: MESSAGE_ID }, { messageId: MESSAGE_ID }],
      name: 'callback properties are readonly regardless of interface name',
      output: 'interface Subscription { readonly handler: () => void; readonly install?: () => void; }'
    },
    {
      code: 'type State = { nested: { value: string }; } & { [key: string]: unknown };',
      errors: [{ messageId: MESSAGE_ID }, { messageId: MESSAGE_ID }],
      name: 'nested properties of object type aliases are readonly',
      output: 'type State = { readonly nested: { readonly value: string }; } & { [key: string]: unknown };'
    },
    {
      code: 'interface State { [Symbol.iterator]: () => Iterator<string>; "value"?: string; }',
      errors: [{ messageId: MESSAGE_ID }, { messageId: MESSAGE_ID }],
      name: 'computed and quoted property names keep their syntax',
      output: 'interface State { readonly [Symbol.iterator]: () => Iterator<string>; readonly "value"?: string; }'
    },
    {
      code: 'interface FooParams { bar: string; }',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in *Params interface',
      output: 'interface FooParams { readonly bar: string; }'
    },
    {
      code: 'interface FooOptions { bar: string; }',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in *Options interface',
      output: 'interface FooOptions { readonly bar: string; }'
    },
    {
      code: 'interface FooResult { bar: string; }',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in *Result interface',
      output: 'interface FooResult { readonly bar: string; }'
    },
    {
      code: 'interface FooParams { readonly a: string; b: number; }',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'mixed readonly and non-readonly in *Params',
      output: 'interface FooParams { readonly a: string; readonly b: number; }'
    },
    {
      code: 'interface FooParams { a: string; b: number; }',
      errors: [
        { messageId: MESSAGE_ID },
        { messageId: MESSAGE_ID }
      ],
      name: 'multiple non-readonly properties in *Params',
      output: 'interface FooParams { readonly a: string; readonly b: number; }'
    },
    {
      code: 'type BarOptions = { baz: boolean; };',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in *Options type alias',
      output: 'type BarOptions = { readonly baz: boolean; };'
    },
    {
      code: 'type BarResult = { baz: boolean; };',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in *Result type alias',
      output: 'type BarResult = { readonly baz: boolean; };'
    },
    {
      code: 'interface ConstructorParams extends BaseParams { extra: string; }',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'non-readonly property in extended *Params interface',
      output: 'interface ConstructorParams extends BaseParams { readonly extra: string; }'
    }
  ],
  valid: [
    {
      code: 'interface Methods { run(): void; new (): Methods; [key: string]: unknown; }',
      name: 'methods, constructors and index signatures are outside property enforcement'
    },
    {
      code: 'const state: { value: number } = { value: 1 }; state.value++;',
      name: 'local object annotations may describe mutable implementation state'
    },
    {
      code: 'type State = { readonly value: number };',
      name: 'readonly object type alias without a bag suffix'
    },
    {
      code: 'interface State {\n// eslint-disable-next-line @rule-tester/readonly-interface-members -- The counter changes.\ncount: number;\n}',
      name: 'mutable members can carry an explicit exception',
      // RuleTester supplies its own rule name, independent of the registered plugin name.
      options: []
    },
    {
      code: 'interface FooParams { readonly bar: string; }',
      name: 'all readonly in *Params interface'
    },
    {
      code: 'interface FooOptions { readonly bar: string; readonly baz: number; }',
      name: 'all readonly in *Options interface'
    },
    {
      code: 'interface FooResult { readonly bar: string; }',
      name: 'all readonly in *Result interface'
    },
    {
      code: 'interface Foo { readonly bar: string; }',
      name: 'readonly properties are valid regardless of interface name'
    },
    {
      code: 'type BarOptions = { readonly baz: boolean; };',
      name: 'all readonly in *Options type alias'
    },
    {
      code: 'interface EmptyParams {}',
      name: 'empty *Params interface is valid'
    }
  ]
});
