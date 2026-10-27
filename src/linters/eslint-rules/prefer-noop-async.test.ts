import { RuleTester } from '@typescript-eslint/rule-tester';
import { Linter } from 'eslint';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  MESSAGE_ID,
  preferNoopAsync
} from './prefer-noop-async.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('prefer-noop-async', toRuleTesterModule(preferNoopAsync), {
  invalid: [
    ...([
      [
        '\'use client\'; await Promise.resolve();',
        '\'use client\'; import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nawait noopAsync();'
      ],
      [
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\'; await noopAsync();'
      ],
      [
        'import { noopAsync as pause } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync as pause } from \'@mnaoumov/typescript-lib/function\'; await pause();'
      ],
      [
        'const noopAsync = 42; const noopAsync1 = 1; await Promise.resolve();',
        'import { noopAsync as noopAsync2 } from \'@mnaoumov/typescript-lib/function\';\nconst noopAsync = 42; const noopAsync1 = 1; await noopAsync2();'
      ],
      [
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\'; function f(noopAsync) { return Promise.resolve(); }',
        'import { noopAsync as noopAsync1 } from \'@mnaoumov/typescript-lib/function\';\nimport { noopAsync } from \'@mnaoumov/typescript-lib/function\'; function f(noopAsync) { return noopAsync1(); }'
      ],
      [
        'import type { noopAsync } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync as noopAsync1 } from \'@mnaoumov/typescript-lib/function\';\nimport type { noopAsync } from \'@mnaoumov/typescript-lib/function\'; await noopAsync1();'
      ],
      [
        'import { type noopAsync } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync as noopAsync1 } from \'@mnaoumov/typescript-lib/function\';\nimport { type noopAsync } from \'@mnaoumov/typescript-lib/function\'; await noopAsync1();'
      ],
      [
        'import { noopAsync } from \'other\'; await Promise.resolve();',
        'import { noopAsync as noopAsync1 } from \'@mnaoumov/typescript-lib/function\';\nimport { noopAsync } from \'other\'; await noopAsync1();'
      ],
      [
        'import other from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nimport other from \'@mnaoumov/typescript-lib/function\'; await noopAsync();'
      ],
      [
        'import { identity } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nimport { identity } from \'@mnaoumov/typescript-lib/function\'; await noopAsync();'
      ],
      [
        'import { \'noopAsync\' as pause } from \'@mnaoumov/typescript-lib/function\'; await Promise.resolve();',
        'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nimport { \'noopAsync\' as pause } from \'@mnaoumov/typescript-lib/function\'; await noopAsync();'
      ],
      [
        'noopAsync(); await Promise.resolve();',
        'import { noopAsync as noopAsync1 } from \'@mnaoumov/typescript-lib/function\';\nnoopAsync(); await noopAsync1();'
      ],
      [
        '#!/usr/bin/env node\nawait Promise.resolve();',
        '#!/usr/bin/env node\nimport { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nawait noopAsync();'
      ]
    ] as const).map(([code, output]) => ({ code, errors: [{ messageId: MESSAGE_ID }], output })),
    {
      code: 'Promise.resolve();',
      errors: [{ messageId: MESSAGE_ID }],
      languageOptions: { parserOptions: { sourceType: 'script' } },
      name: 'script cannot safely receive an ESM import',
      output: null
    },
    {
      code: 'await Promise.resolve();',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'await Promise.resolve() should be noopAsync()',
      output: 'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nawait noopAsync();'
    },
    {
      code: 'const p = Promise.resolve();',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'Promise.resolve() assigned to variable',
      output: 'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nconst p = noopAsync();'
    },
    {
      code: 'return Promise.resolve();',
      errors: [{ messageId: MESSAGE_ID }],
      name: 'Promise.resolve() as return value',
      output: 'import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nreturn noopAsync();'
    }
  ],
  valid: [
    {
      code: 'await noopAsync();',
      name: 'already using noopAsync()'
    },
    {
      code: 'Promise.resolve(42);',
      name: 'Promise.resolve with argument (not a no-op)'
    },
    {
      code: 'Promise.resolve("hello");',
      name: 'Promise.resolve with string argument'
    },
    {
      code: 'Promise.all([]);',
      name: 'Promise.all (not Promise.resolve, has arguments)'
    },
    {
      code: 'Promise.reject();',
      name: 'Promise.reject (not resolve)'
    },
    {
      code: 'MyPromise.resolve();',
      name: 'non-standard Promise.resolve (different identifier)'
    }
  ]
});

it('fixes multiple calls with one import and leaves no unresolved bindings', () => {
  const linter = new Linter();
  const config = {
    languageOptions: { globals: { Promise: 'readonly' as const } },
    plugins: { toolkit: { rules: { 'prefer-noop-async': preferNoopAsync } } },
    rules: { 'no-undef': 'error' as const, 'toolkit/prefer-noop-async': 'error' as const }
  };
  const result = linter.verifyAndFix('await Promise.resolve(); await Promise.resolve();', config);
  expect(result.output).toBe('import { noopAsync } from \'@mnaoumov/typescript-lib/function\';\nawait noopAsync(); await noopAsync();');
  expect(result.messages).toEqual([]);
  expect(linter.verifyAndFix(result.output, config).fixed).toBe(false);
});
