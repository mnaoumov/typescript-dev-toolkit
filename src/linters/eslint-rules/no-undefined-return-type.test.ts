import type { TestCaseError } from '@typescript-eslint/rule-tester';

import { RuleTester } from '@typescript-eslint/rule-tester';
import {
  afterAll,
  describe,
  it
} from 'vitest';

import {
  MESSAGE_ID,
  noUndefinedReturnType,
  SUGGESTION_MESSAGE_ID
} from './no-undefined-return-type.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ['*.ts'],
        defaultProject: 'tsconfig.eslint-test.json'
      }
    }
  }
});

/**
 * Builds the expected error of a case whose suggestion produces the given output.
 *
 * @param output - The code after the suggestion is applied.
 * @returns The expected errors.
 */
function reportedWith(output: string): readonly TestCaseError<string>[] {
  return [{ messageId: MESSAGE_ID, suggestions: [{ messageId: SUGGESTION_MESSAGE_ID, output }] }];
}

ruleTester.run('no-undefined-return-type', toRuleTesterModule(noUndefinedReturnType), {
  invalid: [
    {
      code: 'export function get(): string | undefined { return undefined; }',
      errors: reportedWith('export function get(): string | null { return undefined; }'),
      name: 'function declaration'
    },
    {
      code: 'export async function get(): Promise<string | undefined> { return undefined; }',
      errors: reportedWith('export async function get(): Promise<string | null> { return undefined; }'),
      name: 'Promise type argument'
    },
    {
      code: 'export function get(): PromiseLike<number | undefined> { return Promise.resolve(1); }',
      errors: reportedWith('export function get(): PromiseLike<number | null> { return Promise.resolve(1); }'),
      name: 'PromiseLike type argument'
    },
    {
      code: 'export const get = (): string | undefined => undefined;',
      errors: reportedWith('export const get = (): string | null => undefined;'),
      name: 'arrow with no contextual type'
    },
    {
      code: 'export const get = function(): string | undefined { return undefined; };',
      errors: reportedWith('export const get = function(): string | null { return undefined; };'),
      name: 'function expression with no contextual type'
    },
    {
      code: 'export function get(): null | string | undefined { return null; }',
      errors: reportedWith('export function get(): null | string { return null; }'),
      name: 'union already holding null drops undefined'
    },
    {
      code: 'export function get(): string | undefined /* none */ | number { return 1; }',
      errors: [{ messageId: MESSAGE_ID, suggestions: [] }],
      name: 'no suggestion when the union carries a comment'
    },
    {
      code: 'export function get(x: number): string | undefined;\nexport function get(x: string): string;\nexport function get(): string | undefined { return undefined; }',
      errors: [
        { messageId: MESSAGE_ID, suggestions: [{ messageId: SUGGESTION_MESSAGE_ID, output: 'export function get(x: number): string | null;\nexport function get(x: string): string;\nexport function get(): string | undefined { return undefined; }' }] },
        { messageId: MESSAGE_ID, suggestions: [{ messageId: SUGGESTION_MESSAGE_ID, output: 'export function get(x: number): string | undefined;\nexport function get(x: string): string;\nexport function get(): string | null { return undefined; }' }] }
      ],
      name: 'overload signature'
    },
    {
      code: 'export interface Store { get(key: string): string | undefined; }',
      errors: reportedWith('export interface Store { get(key: string): string | null; }'),
      name: 'interface method signature'
    },
    {
      code: 'export interface Store { readonly get: (key: string) => string | undefined; }',
      errors: reportedWith('export interface Store { readonly get: (key: string) => string | null; }'),
      name: 'function-typed property signature'
    },
    {
      code: 'export type Store = { get(key: string): string | undefined };',
      errors: reportedWith('export type Store = { get(key: string): string | null };'),
      name: 'type-literal method signature'
    },
    {
      code: 'export interface Getter { (key: string): string | undefined; }',
      errors: reportedWith('export interface Getter { (key: string): string | null; }'),
      name: 'call signature'
    },
    {
      code: 'export type Getter = () => string | undefined;',
      errors: reportedWith('export type Getter = () => string | null;'),
      name: 'function type alias'
    },
    {
      code: 'export function run(callback: () => string | undefined): void { callback(); }',
      errors: reportedWith('export function run(callback: () => string | null): void { callback(); }'),
      name: 'callback type we declare'
    },
    {
      code: 'export class Store { public get(): string | undefined { return undefined; } }',
      errors: reportedWith('export class Store { public get(): string | null { return undefined; } }'),
      name: 'class method'
    },
    {
      code: 'export class Store { #get(): string | undefined { return undefined; } public run(): void { this.#get(); } }',
      errors: reportedWith('export class Store { #get(): string | null { return undefined; } public run(): void { this.#get(); } }'),
      name: 'private class method'
    },
    {
      code: 'export class Store { public get value(): string | undefined { return undefined; } }',
      errors: reportedWith('export class Store { public get value(): string | null { return undefined; } }'),
      name: 'getter'
    },
    {
      code: 'export class Store { public readonly get = (): string | undefined => undefined; }',
      errors: reportedWith('export class Store { public readonly get = (): string | null => undefined; }'),
      name: 'arrow class property'
    },
    {
      code: 'export abstract class Store { public abstract get(): string | undefined; }',
      errors: reportedWith('export abstract class Store { public abstract get(): string | null; }'),
      name: 'abstract method'
    },
    {
      code: 'interface Base { other(): void }\nexport class Store implements Base { public other(): void {} public get(): string | undefined { return undefined; } }',
      errors: reportedWith('interface Base { other(): void }\nexport class Store implements Base { public other(): void {} public get(): string | null { return undefined; } }'),
      name: 'class member a base does not declare'
    },
    {
      code: 'export const store = { get(): string | undefined { return undefined; } };',
      errors: reportedWith('export const store = { get(): string | null { return undefined; } };'),
      name: 'object-literal method with no contextual type'
    },
    {
      code: 'declare function run(callback: () => unknown): void;\nrun((): string | undefined => undefined);',
      errors: reportedWith('declare function run(callback: () => unknown): void;\nrun((): string | null => undefined);'),
      name: 'callback whose contextual type does not return undefined'
    },
    {
      code: 'declare namespace Local { function get(): string | undefined; }',
      errors: reportedWith('declare namespace Local { function get(): string | null; }'),
      name: 'local namespace is ours'
    }
  ],
  valid: [
    {
      code: 'export function get(): null | string { return null; }',
      name: 'null union'
    },
    {
      code: 'export function get(): undefined { return undefined; }',
      name: 'bare undefined is not a union'
    },
    {
      code: 'export function get(): string | undefined | void { return undefined; }',
      name: 'void-style union'
    },
    {
      code: 'type MaybeReturn<T> = T | undefined | void;\nexport function get(): MaybeReturn<string> { return undefined; }',
      name: 'MaybeReturn alias'
    },
    {
      code: 'export function get(): Map<string, number | undefined> { return new Map(); }',
      name: 'type argument of a non-promise type'
    },
    {
      code: 'export interface Options { readonly value?: string | undefined; }',
      name: 'optional property, not a return type'
    },
    {
      code: 'export function get() { return undefined; }',
      name: 'no return annotation'
    },
    {
      code: 'declare function find<T>(predicate: (value: number) => T): void;\nfind<string | undefined>((): string | undefined => undefined);',
      name: 'callback whose contextual type returns undefined'
    },
    {
      code: 'declare function find<T>(predicate: (value: number) => T): void;\nfind<Promise<string | undefined>>(async (): Promise<string | undefined> => undefined);',
      name: 'async callback whose contextual type resolves to undefined'
    },
    {
      code: 'class Base { public get(): string | null { return null; } }\nexport class Store extends Base { public override get(): string | undefined { return undefined; } }',
      name: 'override member'
    },
    {
      code: 'interface Source { get(): string | undefined | void }\nexport class Store implements Source { public get(): string | undefined { return undefined; } }',
      name: 'implemented interface member'
    },
    {
      code: 'class Base { public get(): string | undefined | void { return undefined; } }\nexport class Store extends Base { public get(): string | undefined { return undefined; } }',
      name: 'base class member without override keyword'
    },
    {
      code: 'interface Source { get(): string | undefined | void }\nexport interface Store extends Source { get(): string | undefined; }',
      name: 'extended interface member'
    },
    {
      code: 'interface Source { get(): string | undefined | void }\nexport const store: Source = { get(): string | undefined { return undefined; } };',
      name: 'object-literal member its contextual type declares'
    },
    {
      code: 'import { vi } from \'vitest\';\nexport const read = vi.fn<(path: string) => string | undefined>();',
      name: 'function type as a type argument'
    },
    {
      code: 'interface Source { \'get-value\'(): string | undefined | void }\nexport class Store implements Source { public \'get-value\'(): string | undefined { return undefined; } }',
      name: 'string-literal key a base declares'
    },
    {
      code: 'export class Numbers { public [Symbol.iterator](): Iterator<number> | undefined { return undefined; } }',
      name: 'computed class member key'
    },
    {
      code: 'export const iterable = { [Symbol.iterator](): Iterator<number> | undefined { return undefined; } };',
      name: 'computed member key'
    },
    {
      code: 'declare module \'some-module\' { interface App { get(): string | undefined; } }',
      name: 'module augmentation'
    },
    {
      code: 'declare global { interface Window { get(): string | undefined; } }\nexport {};',
      name: 'global augmentation'
    }
  ]
});
