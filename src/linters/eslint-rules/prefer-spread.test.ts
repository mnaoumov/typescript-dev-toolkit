import { RuleTester } from '@typescript-eslint/rule-tester';
import { Linter } from 'eslint';
import { runInNewContext } from 'node:vm';
import { parser } from 'typescript-eslint';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import { preferSpread } from './prefer-spread.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

interface BinaryCopyResult {
  readonly copy: Uint8Array;
  readonly text: string;
}

const config = {
  files: ['**/*.ts'],
  languageOptions: {
    parser,
    parserOptions: {
      projectService: { allowDefaultProject: ['*.ts'], defaultProject: 'tsconfig.eslint-test.json' }
    }
  },
  plugins: { toolkit: { rules: { 'prefer-spread': preferSpread } } },
  rules: { 'toolkit/prefer-spread': 'error' }
} satisfies Linter.Config;

new RuleTester({ languageOptions: config.languageOptions }).run('prefer-spread', toRuleTesterModule(preferSpread), {
  invalid: [
    {
      code: 'declare const values: number[]; values.slice();',
      errors: [{ messageId: 'array-slice', suggestions: [{ messageId: 'spread', output: 'declare const values: number[]; [...values];' }] }],
      output: null
    },
    {
      code: 'declare const values: readonly number[]; values.slice(0);',
      errors: [{ messageId: 'array-slice', suggestions: [{ messageId: 'spread', output: 'declare const values: readonly number[]; [...values];' }] }],
      output: null
    },
    {
      code: 'declare const values: [number, string]; values.slice();',
      errors: [{ messageId: 'array-slice', suggestions: [{ messageId: 'spread', output: 'declare const values: [number, string]; [...values];' }] }],
      output: null
    },
    {
      code: 'declare const values: number[] | string[]; values.slice();',
      errors: [{ messageId: 'array-slice', suggestions: [{ messageId: 'spread', output: 'declare const values: number[] | string[]; [...values];' }] }],
      output: null
    },
    {
      code: 'function copy<T extends number[]>(values: T) { return values.slice(); }',
      errors: [{ messageId: 'array-slice', suggestions: [{ messageId: 'spread', output: 'function copy<T extends number[]>(values: T) { return [...values]; }' }] }],
      output: null
    },
    {
      code: 'Array.from(new Set([1, 2]));',
      errors: [{ messageId: 'array-from', suggestions: [{ messageId: 'spread', output: '[...new Set([1, 2])];' }] }],
      output: null
    }
  ],
  valid: [
    'declare const bytes: Uint8Array; bytes.slice(0).buffer;',
    'declare const bytes: Int16Array; bytes.slice();',
    'declare const bytes: Float64Array; bytes.slice();',
    'declare const bytes: BigInt64Array; bytes.slice();',
    'declare const bytes: Uint8Array | number[]; bytes.slice();',
    'declare const bytes: ArrayBuffer; bytes.slice(0);',
    'declare const bytes: { slice(): Uint8Array }; bytes.slice();',
    'declare const bytes: any; bytes.slice();',
    'function copy<T extends Uint8Array>(bytes: T) { return bytes.slice(); }'
  ]
});

new RuleTester().run('prefer-spread without type information', toRuleTesterModule(preferSpread), {
  invalid: [{ code: 'Array.from(new Set([1, 2]));', errors: [{ messageId: 'array-from' }], filename: 'file.js', output: '[...new Set([1, 2])];' }],
  valid: ['const bytes = new TextEncoder().encode("hello"); bytes.slice().buffer;']
});

describe('prefer-spread', () => {
  it.each([true, false])('preserves binary copies through repeated fixes (type information: %s)', (hasTypeInformation) => {
    const code = 'const bytes = new TextEncoder().encode("hello 🌍"); const copy = bytes.slice(); ({ copy, text: new TextDecoder().decode(copy.buffer) });';
    const linter = new Linter();
    const runtimeConfig = hasTypeInformation ? config : { ...config, languageOptions: { parser } };
    const first = linter.verifyAndFix(code, runtimeConfig, { filename: 'spread.ts' });
    expect(first.messages).toEqual([]);
    expect(first.output).toBe(code);
    const result = runInNewContext(first.output, { TextDecoder, TextEncoder, Uint8Array }) as BinaryCopyResult;
    expect(result.copy).toBeInstanceOf(Uint8Array);
    expect(result.text).toBe('hello 🌍');
    expect(linter.verifyAndFix(first.output, runtimeConfig, { filename: 'spread.ts' }).output).toBe(first.output);
  });
});
