import { RuleTester } from '@typescript-eslint/rule-tester';
import { Linter } from 'eslint';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import { parser } from 'typescript-eslint';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  MESSAGE_ID,
  preferLogicalOperatorOverTernary
} from './prefer-logical-operator-over-ternary.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const SUGGESTION_MESSAGE_ID = 'prefer-logical-operator-over-ternary/suggestion';
const OPTIONAL_CHAIN_MESSAGE_ID = 'prefer-logical-operator-over-ternary/optional-chain-error';
const OPTIONAL_CHAIN_SUGGESTION_MESSAGE_ID = 'prefer-logical-operator-over-ternary/optional-chain-suggestion';

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

ruleTester.run('prefer-logical-operator-over-ternary', toRuleTesterModule(preferLogicalOperatorOverTernary), {
  invalid: [
    {
      code: 'declare const a: boolean; declare const b: boolean; const x = a ? false : b;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a false consequent negates the test under &&',
      output: 'declare const a: boolean; declare const b: boolean; const x = !a && b;'
    },
    {
      code: 'declare const a: number; declare const b: boolean; const x = a ? b : true;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a true alternate negates the test under ||',
      output: 'declare const a: number; declare const b: boolean; const x = !a || b;'
    },
    {
      code: 'declare const b: boolean; const x = 1 > 2 ? true : b;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a true consequent with a boolean test keeps the test under ||',
      output: 'declare const b: boolean; const x = 1 > 2 || b;'
    },
    {
      code: 'declare const b: boolean; const x = 1 > 2 ? b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a false alternate with a boolean test keeps the test under &&',
      output: 'declare const b: boolean; const x = 1 > 2 && b;'
    },
    {
      code: 'declare const a: string | null; declare const b: boolean; const x = a ? b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a test that is not boolean is coerced under &&, so a falsy test still yields false',
      output: 'declare const a: string | null; declare const b: boolean; const x = !!a && b;'
    },
    {
      code: 'declare const a: number; declare const b: boolean; const x = a ? true : b;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a test that is not boolean is coerced under ||',
      output: 'declare const a: number; declare const b: boolean; const x = !!a || b;'
    },
    {
      code: 'declare const a: number | undefined; declare const c: number; declare const b: boolean; const x = a ?? c ? b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a coerced test is parenthesized under !!',
      output: 'declare const a: number | undefined; declare const c: number; declare const b: boolean; const x = !!(a ?? c) && b;'
    },
    {
      code: 'declare const a: { b: boolean } | null; const x = a ? a.b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a coerced test still narrows the branch that reads it',
      output: 'declare const a: { b: boolean } | null; const x = !!a && a.b;'
    },
    {
      code: 'declare const a: number; declare const b: boolean; declare const c: boolean; const x = a > 1 ? false : b || c;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a binary test is parenthesized under ! and a lower-precedence branch under &&',
      output: 'declare const a: number; declare const b: boolean; declare const c: boolean; const x = !(a > 1) && (b || c);'
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = a && b ? false : c && a;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a logical test is parenthesized under ! and an && branch is not under &&',
      output: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = !(a && b) && c && a;'
    },
    {
      code: 'declare const b: boolean; declare const c: boolean | undefined; declare const d: boolean; const x = c ?? b ? true : d;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a ?? test is parenthesized under ||',
      output: 'declare const b: boolean; declare const c: boolean | undefined; declare const d: boolean; const x = (c ?? b) || d;'
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = 1 > 2 ? true : b && c;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'an && branch is not parenthesized under ||',
      output: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = 1 > 2 || b && c;'
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = 1 > 2 ? b || c : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'an || branch is parenthesized under &&',
      output: 'declare const a: boolean; declare const b: boolean; declare const c: boolean; const x = 1 > 2 && (b || c);'
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; const x = a ? false : (b = true);',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'an assignment branch is parenthesized',
      output: 'declare const a: boolean; declare const b: boolean; const x = !a && (b = true);'
    },
    {
      code: 'declare const a: boolean; declare function f(): boolean; const x = a ? false : f();',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a call branch is not parenthesized',
      output: 'declare const a: boolean; declare function f(): boolean; const x = !a && f();'
    },
    {
      code: 'declare const b: boolean; const x = [b] ? b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'an array test is not parenthesized under !!',
      output: 'declare const b: boolean; const x = !![b] && b;'
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; const x = a ? false /* why */ : b;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a comment inside the ternary leaves it unfixed',
      output: null
    },
    {
      code: 'declare const a: boolean; declare const b: boolean; const NO = false; const x = a ? NO : b;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a boolean constant that is not a literal leaves it unfixed',
      output: null
    },
    {
      code: 'declare const a: string; declare const b: string; const x = a ? a : b;',
      errors: [{
        messageId: MESSAGE_ID,
        suggestions: [
          {
            data: { operator: '??' },
            messageId: SUGGESTION_MESSAGE_ID,
            output: 'declare const a: string; declare const b: string; const x = a ?? b;'
          },
          {
            data: { operator: '||' },
            messageId: SUGGESTION_MESSAGE_ID,
            output: 'declare const a: string; declare const b: string; const x = a || b;'
          }
        ]
      }],
      name: 'a shape unicorn only suggests for is left to its suggestions',
      output: null
    },
    {
      code: 'declare const a: { b: number } | undefined; const x = a == null ? undefined : a.b;',
      errors: [{
        messageId: OPTIONAL_CHAIN_MESSAGE_ID,
        suggestions: [
          {
            messageId: OPTIONAL_CHAIN_SUGGESTION_MESSAGE_ID,
            output: 'declare const a: { b: number } | undefined; const x = a?.b;'
          }
        ]
      }],
      name: 'another unicorn message is passed through',
      output: null
    }
  ],
  valid: [
    {
      code: 'declare const a: boolean; declare const b: string; const x = !a && b;',
      name: 'already a logical expression'
    },
    {
      code: 'declare const a: boolean; const x = a ? false : true;',
      name: 'two literal branches are another rule\'s concern'
    }
  ]
});

// Without type information no test can be proven boolean, so even a comparison is coerced.
new RuleTester().run('prefer-logical-operator-over-ternary without type information', toRuleTesterModule(preferLogicalOperatorOverTernary), {
  invalid: [
    {
      code: 'declare const b: boolean; const x = 1 > 2 ? b : false;',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'a test is coerced when the type checker is not there to prove it boolean',
      output: 'declare const b: boolean; const x = !!(1 > 2) && b;'
    }
  ],
  valid: []
});

describe('prefer-logical-operator-over-ternary in a JavaScript file', () => {
  it('keeps the fix unicorn makes itself', () => {
    const linter = new Linter();
    const result = linter.verifyAndFix(
      'const x = a ? false : b > 1;\n',
      [
        {
          files: ['**/*.js'],
          plugins: {
            'typescript-dev-toolkit': { rules: { 'prefer-logical-operator-over-ternary': preferLogicalOperatorOverTernary } }
          },
          rules: {
            'typescript-dev-toolkit/prefer-logical-operator-over-ternary': 'error'
          }
        }
      ],
      { filename: 'file.js' }
    );

    expect(result.messages).toEqual([]);
    expect(result.output).toBe('const x = !a && (b > 1);\n');
  });
});

describe('prefer-logical-operator-over-ternary with unicorn/prefer-ternary', () => {
  it('converges: fixing both leaves no finding', () => {
    const linter = new Linter();
    const result = linter.verifyAndFix(
      'export function f(a: boolean, b: boolean): boolean {\n  if (a) {\n    return false;\n  }\n  return b;\n}\n',
      [
        {
          files: ['**/*.ts'],
          languageOptions: { parser },
          plugins: {
            'typescript-dev-toolkit': { rules: { 'prefer-logical-operator-over-ternary': preferLogicalOperatorOverTernary } },
            'unicorn': eslintPluginUnicorn
          },
          rules: {
            'typescript-dev-toolkit/prefer-logical-operator-over-ternary': 'error',
            'unicorn/prefer-ternary': 'error'
          }
        }
      ],
      { filename: 'file.ts' }
    );

    expect(result.messages).toEqual([]);
    expect(result.output).toBe('export function f(a: boolean, b: boolean): boolean {\n  return !a && b;\n}\n');
  });
});
