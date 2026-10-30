/* eslint-disable no-template-curly-in-string -- The fixtures are source text, holding template literals and a literal `${`. */
import { RuleTester } from '@typescript-eslint/rule-tester';
import dedent from 'dedent';
import { Linter } from 'eslint';
import { runInNewContext } from 'node:vm';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import {
  MESSAGE_ID,
  preferDedent
} from './prefer-dedent.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();
const IMPORT = 'import dedent from \'dedent\';\n';

ruleTester.run('prefer-dedent', toRuleTesterModule(preferDedent), {
  invalid: [
    ...([
      [
        String.raw`const text = ['a', 'b'].join('\n');`,
        `${IMPORT}const text = dedent\`\n  a\n  b\n\`;`
      ],
      [
        'function f() {\n  return [\n    \'a\',\n    \'\',\n    \'  b\'\n  ].join(\'\\n\');\n}',
        `${IMPORT}function f() {\n  return dedent\`\n    a\n\n      b\n  \`;\n}`
      ],
      [
        String.raw`const text = ['a', 'b', ''].join('\n');`,
        `${IMPORT}const text = dedent\`\n  a\n  b\\n\n\`;`
      ],
      [
        String.raw`const text = ['', 'a', 'b'].join('\n');`,
        `${IMPORT}const text = dedent\`\n  \\na\n  b\n\`;`
      ],
      [
        String.raw`const text = ['a', 'b'].join('\r\n');`,
        `${IMPORT}const text = dedent\`\n  a\\r\n  b\n\`;`
      ],
      [
        'const text = [\'a `b`\', \'${c}\'].join("\\n");',
        `${IMPORT}const text = dedent\`\n  a \\\`b\\\`\n  \\\${c}\n\`;`
      ],
      [
        'const text = [`a`, \'b\'].join(`\\n`);',
        `${IMPORT}const text = dedent\`\n  a\n  b\n\`;`
      ],
      [
        String.raw`const text = ['a  ', 'b', ''].join('\n');`,
        `${IMPORT}const text = dedent\`\n  a  \n  b\\n\n\`;`
      ],
      [
        'import dedent from \'dedent\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import dedent from \'dedent\';\nconst text = dedent`\n  a\n  b\n`;'
      ],
      [
        'import trim from \'dedent\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import trim from \'dedent\';\nconst text = trim`\n  a\n  b\n`;'
      ],
      [
        'import { default as trim } from \'dedent\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import { default as trim } from \'dedent\';\nconst text = trim`\n  a\n  b\n`;'
      ],
      [
        'import { dedent } from \'other\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import dedent1 from \'dedent\';\nimport { dedent } from \'other\';\nconst text = dedent1`\n  a\n  b\n`;'
      ],
      [
        'import { type default as trim } from \'dedent\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import dedent from \'dedent\';\nimport { type default as trim } from \'dedent\';\nconst text = dedent`\n  a\n  b\n`;'
      ],
      [
        'import type trim from \'dedent\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        'import dedent from \'dedent\';\nimport type trim from \'dedent\';\nconst text = dedent`\n  a\n  b\n`;'
      ],
      [
        '\'use strict\';\nconst text = [\'a\', \'b\'].join(\'\\n\');',
        `'use strict';\n${IMPORT}const text = dedent\`\n  a\n  b\n\`;`
      ]
    ] as const).map(([code, output]) => ({ code, errors: [{ messageId: MESSAGE_ID }], output })),
    ...([
      [String.raw`const text = ['a\\b', 'c'].join('\n');`, 'a backslash, which dedent passes on raw'],
      [String.raw`const text = [' a', 'b'].join('\n');`, 'leading whitespace dedent would trim'],
      [String.raw`const text = ['a', 'b '].join('\n');`, 'trailing whitespace dedent would trim'],
      [String.raw`const text = ['', ''].join('\n');`, 'nothing but a line break'],
      ['const text = [`a${b}`, \'c\'].join(\'\\n\');', 'a template literal with an expression'],
      [String.raw`const text = ['a', /* b */ 'c'].join('\n');`, 'a comment inside the call']
    ] as const).map(([code, name]) => ({ code, errors: [{ messageId: MESSAGE_ID }], name, output: null })),
    {
      code: String.raw`var text = ['a', 'b'].join('\n');`,
      errors: [{ messageId: MESSAGE_ID }],
      languageOptions: { parserOptions: { sourceType: 'script' } },
      name: 'script cannot safely receive an ESM import',
      output: null
    },
    ...([
      [
        String.raw`evalInObsidian({ args: { text: ['a', 'b'].join('\n') } });`,
        `${IMPORT}evalInObsidian({ args: { text: dedent\`\n  a\n  b\n\` } });`,
        'an ignored call argument outside a function, which runs in the calling process'
      ],
      [
        String.raw`other(() => ['a', 'b'].join('\n'));`,
        `${IMPORT}other(() => dedent\`\n  a\n  b\n\`);`,
        'a callback of a call that is not ignored'
      ],
      [
        String.raw`function f() { return ['a', 'b'].join('\n'); }`,
        `${IMPORT}function f() { return dedent\`\n  a\n  b\n\`; }`,
        'a function outside any call'
      ],
      [
        String.raw`[() => ['a', 'b'].join('\n')].evalInObsidian();`,
        `${IMPORT}[() => dedent\`\n  a\n  b\n\`].evalInObsidian();`,
        'a function inside the callee of an ignored call'
      ],
      [
        String.raw`helpers['evalInObsidian'](() => ['a', 'b'].join('\n'));`,
        `${IMPORT}helpers['evalInObsidian'](() => dedent\`\n  a\n  b\n\`);`,
        'a computed member callee'
      ],
      [
        String.raw`factory()(() => ['a', 'b'].join('\n'));`,
        `${IMPORT}factory()(() => dedent\`\n  a\n  b\n\`);`,
        'a callee with no name'
      ]
    ] as const).map(([code, output, name]) => ({
      code,
      errors: [{ messageId: MESSAGE_ID }],
      name,
      options: [{ ignoreInsideCallsTo: ['evalInObsidian'] }] as const,
      output
    }))
  ],
  valid: [
    ...[
      [String.raw`const text = [a, 'b'].join('\n');`, 'a computed element'],
      [String.raw`const text = [...lines, 'b'].join('\n');`, 'a spread element'],
      [String.raw`const text = [, 'b'].join('\n');`, 'a hole'],
      [String.raw`const text = [1, 'b'].join('\n');`, 'a non-string literal'],
      ['const text = [\'a\', \'b\'].join(\', \');', 'another separator'],
      ['const text = [\'a\', \'b\'].join();', 'the default separator'],
      ['const text = [\'a\', \'b\'].join(separator);', 'a computed separator'],
      ['const text = [\'a\', \'b\'].join(...separators);', 'a spread separator'],
      ['const text = [\'a\', \'b\'].join(1);', 'a non-string separator'],
      ['const text = [\'a\', \'b\'].join(`${separator}`);', 'a template separator with an expression'],
      [String.raw`const text = ['a', 'b'].join('\n', extra);`, 'two arguments'],
      [String.raw`const text = ['a'].join('\n');`, 'a single element'],
      [String.raw`const text = lines.join('\n');`, 'an array that is not a literal'],
      [String.raw`const text = ['a', 'b']['join']('\n');`, 'a computed member'],
      [String.raw`const text = ['a', 'b']?.join('\n');`, 'an optional member'],
      [String.raw`const text = ['a', 'b'].join?.('\n');`, 'an optional call'],
      [String.raw`const text = ['a', 'b'].concat('\n');`, 'another method'],
      [String.raw`const text = join('\n');`, 'a plain call']
    ].map(([code = '', name = '']) => ({ code, name })),
    ...[
      [String.raw`evalInObsidian({ fn: () => ['a', 'b'].join('\n') });`, 'an arrow callback of an ignored call'],
      [String.raw`await evalInObsidian({ fn: async function () { return ['a', 'b'].join('\n'); } });`, 'a function expression callback'],
      [String.raw`pollInObsidian(() => { function g() { return ['a', 'b'].join('\n'); } return g(); });`, 'a function nested in a callback'],
      [String.raw`obsidian.evalInObsidian(() => ['a', 'b'].join('\n'));`, 'a member callee'],
      [String.raw`evalInObsidian(() => other(['a', 'b'].join('\n')));`, 'a call nested in a callback']
    ].map(([code = '', name = '']) => ({ code, name, options: [{ ignoreInsideCallsTo: ['evalInObsidian', 'pollInObsidian'] }] }))
  ]
});

const ROUND_TRIP_ARRAYS: readonly (readonly string[])[] = [
  ['a', 'b'],
  ['a', '', 'b'],
  ['a', 'b', ''],
  ['a', 'b', '', ''],
  ['', 'a', 'b'],
  ['', '', 'a'],
  ['a', '  b', '\tc', '    d'],
  ['a', ' '.repeat(3), 'b'],
  ['a  ', 'b', ''],
  ['a\nb', 'c\n  d'],
  ['a `b` ${c} $d {e}', 'f'],
  ['a\r', 'b']
];

describe('prefer-dedent fix', () => {
  for (const separator of ['\n', '\r\n']) {
    for (const elements of ROUND_TRIP_ARRAYS) {
      it(`should produce the joined text for ${JSON.stringify(elements)} joined with ${JSON.stringify(separator)}`, () => {
        const code = `function f() {\n  return ${JSON.stringify(elements)}.join(${JSON.stringify(separator)});\n}`;
        const output = fix(code);
        const template = output.slice(output.indexOf('dedent`'), output.lastIndexOf('`') + 1);
        expect(runInNewContext(template, { dedent })).toBe(elements.join(separator));
      });
    }
  }

  it('should add one import for several reports and leave nothing to fix', () => {
    const output = fix('const a = [\'a\', \'b\'].join(\'\\n\');\nconst b = [\'c\', \'d\'].join(\'\\n\');');
    expect(output).toBe(`${IMPORT}const a = dedent\`\n  a\n  b\n\`;\nconst b = dedent\`\n  c\n  d\n\`;`);
  });
});

function fix(code: string): string {
  const linter = new Linter();
  const config = {
    plugins: { toolkit: { rules: { 'prefer-dedent': preferDedent } } },
    rules: { 'toolkit/prefer-dedent': 'error' as const }
  };
  const result = linter.verifyAndFix(code, config);
  expect(result.messages).toEqual([]);
  return result.output;
}
/* eslint-enable no-template-curly-in-string -- The fixtures end here. */
