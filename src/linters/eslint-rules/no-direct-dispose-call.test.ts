import { RuleTester } from '@typescript-eslint/rule-tester';
import {
  afterAll,
  describe,
  it
} from 'vitest';

import {
  ASYNC_DISPOSE_MESSAGE_ID,
  DISPOSE_MESSAGE_ID,
  noDirectDisposeCall,
  REGISTER_MESSAGE_ID
} from './no-direct-dispose-call.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();
const REGISTER_OPTIONS = [{ registerHelperName: 'registerDisposable' }];

ruleTester.run('no-direct-dispose-call', toRuleTesterModule(noDirectDisposeCall), {
  invalid: [
    {
      code: 'declare const x: Disposable; x[Symbol.dispose]();',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'declare const x: AsyncDisposable; await x[Symbol.asyncDispose]();',
      errors: [{ messageId: ASYNC_DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'declare const x: Disposable | undefined; x?.[Symbol.dispose]();',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'function release(x: Disposable): void { x[Symbol.dispose](); }',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'class A { close(x: Disposable): void { x[Symbol.dispose](); } }',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'class A { [key](x: Disposable): void { x[Symbol.dispose](); } }',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'const a = { \'dispose\'(x: Disposable): void { x[Symbol.dispose](); } };',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'component.register(() => x[Symbol.dispose]());',
      errors: [{ messageId: DISPOSE_MESSAGE_ID }]
    },
    {
      code: 'component.register(() => x[Symbol.dispose]());',
      errors: [{ data: { helper: 'registerDisposable', symbol: 'dispose' }, messageId: REGISTER_MESSAGE_ID }],
      options: REGISTER_OPTIONS
    },
    {
      code: 'this.register(() => x?.[Symbol.asyncDispose]());',
      errors: [{ data: { helper: 'registerDisposable', symbol: 'asyncDispose' }, messageId: REGISTER_MESSAGE_ID }],
      options: REGISTER_OPTIONS
    },
    ...[
      'component.register(() => { x[Symbol.dispose](); });',
      'component.register(() => x[Symbol.dispose](), 1);',
      'component.register(function () { return x[Symbol.dispose](); });',
      '(() => x[Symbol.dispose]())(1);',
      'register(() => x[Symbol.dispose]());',
      'component[\'register\'](() => x[Symbol.dispose]());',
      'component.on(() => x[Symbol.dispose]());',
      'class A { #register(f: () => void): void { f(); } m(): void { this.#register(() => x[Symbol.dispose]()); } }',
      'void x[Symbol.dispose]();'
    ].map((code) => ({
      code,
      errors: [{ messageId: DISPOSE_MESSAGE_ID }],
      options: REGISTER_OPTIONS
    }))
  ],
  valid: [
    'x.dispose();',
    'await x.asyncDispose();',
    'foo();',
    'x[key]();',
    'x[Symbol.iterator]();',
    'x[Symbol[\'dispose\']]();',
    'x[Foo.dispose]();',
    'x[a.Symbol.dispose]();',
    'class A { #dispose = 1; m(x: Disposable): void { x[Symbol.#dispose](); } }',
    'const Symbol = { dispose: \'d\' }; x[Symbol.dispose]();',
    'function f(Symbol: { dispose: string }): void { x[Symbol.dispose](); }',
    'class A { [Symbol.dispose](): void { this.inner[Symbol.dispose](); } }',
    'class A { async [Symbol.asyncDispose](): Promise<void> { await this.inner[Symbol.asyncDispose](); } }',
    'class A { dispose(): void { this[Symbol.dispose](); } }',
    'class A { asyncDispose = async (): Promise<void> => { await this[Symbol.asyncDispose](); }; }',
    'const a = { [Symbol.dispose](): void { inner[Symbol.dispose](); } };',
    'const a = { dispose: () => { inner[Symbol.dispose](); } };'
  ]
});
