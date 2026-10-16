import type { Linter } from 'eslint';

// eslint-disable-next-line import-x/no-rename-default -- The default export name `plugin` is too confusing.
import stylistic from '@stylistic/eslint-plugin';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { parser } from 'typescript-eslint';
import {
  describe,
  expect,
  it
} from 'vitest';

import { defineEslintConfigs } from './linters/eslint-config.ts';

// The real dprint and the real ESLint run here, because the only thing worth proving is what a mock replaces: that
// dprint's output and the shared config's `@stylistic` rules agree. Each fixture is formatted, fixed with every
// `@stylistic` rule the shared config enables, and formatted again. A rule that fights dprint shows up as a second
// format that changes the fixed text, or as a report left after it — which is how `wrap-iife` and `jsx-quotes`
// were found, one gate failure at a time, before this test existed.
const REPOSITORY_ROOT = join(import.meta.dirname, '..');
const DPRINT_JSON_PATH = join(REPOSITORY_ROOT, 'dprint.json');
const DPRINT_BIN_PATH = join(REPOSITORY_ROOT, 'node_modules/dprint/bin.cjs');

const TS_FIXTURE = `import {a1} from 'm1';
import { b1, b2 } from 'm2';
export {d1, d2};
const arr = [ 1, 2 ];
const arrowParens = x => x;
const asyncArrow = async x => x;
function blockSpacing() {return 1;}
if(a){
  b();
}
else {
  c();
}
const keySpacing = {a:1, b :2, 'c': 3};
class LinesBetween {
  m1() {}
  m2() {
    return 1;
  }
  m3() {
    return 2;
  }
}
interface MemberDelim {
  a: string,
  b: number
}
const multilineTernary = a ? b
  : c;
const newParens = new Foo;
const opLinebreak = a +
  b;
const opLinebreakAssign
  = 1;
function paddedBlocks() {

  return 1;

}
const dq = "x";
const plainTemplate = \`plain\`;
const iife = function () {
  return 1;
}();
const iifeOuter = (function () {
  return 1;
})();
//comment
/*block*/
let typeAnno:string;
type Gen = Array< string >;
function* yieldStar() {
  yield *other();
}
const generatorSpacing = function *() {};
const chain = foo
  .bar()
    .baz();
`;

const TSX_FIXTURE = `const closingBracket = (
  <div
    a="1"
    b='2'
    />
);
const curlyPresence = <A p={'x'}>{'child'}</A>;
const curlySpacing = <A p={ x }>{ y }</A>;
const firstProp = (
  <A p="1"
    q="2"
  />
);
const tagSpacing = <A/>;
const wrap = <div>
  <span />
</div>;
`;

function createStylisticEslint(rules: Linter.RulesRecord, shouldFix: boolean): ESLint {
  return new ESLint({
    cwd: REPOSITORY_ROOT,
    fix: shouldFix,
    overrideConfig: [{
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parser,
        parserOptions: {
          ecmaFeatures: {
            jsx: true
          }
        }
      },
      plugins: {
        '@stylistic': stylistic
      },
      rules
    }],
    overrideConfigFile: true
  });
}

function formatWithDprint(text: string, fileName: string): string {
  const result = spawnSync(process.execPath, [DPRINT_BIN_PATH, 'fmt', '--config', DPRINT_JSON_PATH, '--stdin', fileName], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf-8',
    input: text
  });
  if (result.status !== 0) {
    throw new Error(`dprint failed on ${fileName}: ${result.stderr}`);
  }
  return result.stdout;
}

async function getEnabledStylisticRules(): Promise<Linter.RulesRecord> {
  const eslint = new ESLint({ cwd: REPOSITORY_ROOT, overrideConfig: defineEslintConfigs(), overrideConfigFile: true });
  const config = await eslint.calculateConfigForFile(join(REPOSITORY_ROOT, 'src/fixture.tsx')) as Linter.Config;
  const rules: Linter.RulesRecord = {};
  for (const [ruleId, entry] of Object.entries(config.rules ?? {})) {
    const severity = Array.isArray(entry) ? entry[0] : entry;
    if (entry !== undefined && ruleId.startsWith('@stylistic/') && severity !== 0 && severity !== 'off') {
      rules[ruleId] = entry;
    }
  }
  return rules;
}

describe('the shared ESLint config against the shared dprint.json', () => {
  it.each([
    { fileName: 'fixture.ts', fixture: TS_FIXTURE },
    { fileName: 'fixture.tsx', fixture: TSX_FIXTURE }
  ])('should leave no @stylistic report and nothing for dprint to undo in $fileName', async ({ fileName, fixture }) => {
    const rules = await getEnabledStylisticRules();
    expect(Object.keys(rules)).not.toHaveLength(0);
    const filePath = join(REPOSITORY_ROOT, 'src', fileName);

    const formatted = formatWithDprint(fixture, fileName);
    const [fixResult] = await createStylisticEslint(rules, true).lintText(formatted, { filePath });
    const fixed = fixResult?.output ?? formatted;
    const reformatted = formatWithDprint(fixed, fileName);
    expect(reformatted).toBe(fixed);

    const [lintResult] = await createStylisticEslint(rules, false).lintText(reformatted, { filePath });
    expect(lintResult?.messages.map((message) => `${String(message.line)}: ${message.ruleId ?? ''} ${message.message}`)).toEqual([]);
  });
});
