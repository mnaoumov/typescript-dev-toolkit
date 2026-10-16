import type { Linter } from 'eslint';

// eslint-disable-next-line import-x/no-rename-default -- The default export name `plugin` is too confusing.
import stylistic from '@stylistic/eslint-plugin';
import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { parser } from 'typescript-eslint';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import { defineEslintConfigs } from './linters/eslint-config.ts';

// The real formatters and the real ESLint run here, because the only thing worth proving is what a mock replaces: that
// each formatter's output, with its shared configuration, and the shared config's `@stylistic` rules agree. Each
// fixture is formatted, fixed with every `@stylistic` rule the shared config enables, and formatted again. A rule that
// fights the formatter shows up as a second format that changes the fixed text, or as a report left after it — which
// is how `wrap-iife` and `jsx-quotes` were found against dprint, one gate failure at a time, before this test existed.
const REPOSITORY_ROOT = join(import.meta.dirname, '..');
const DPRINT_JSON_PATH = join(REPOSITORY_ROOT, 'dprint.json');
const DPRINT_BIN_PATH = join(REPOSITORY_ROOT, 'node_modules/dprint/bin.cjs');
const PRETTIER_JSON_PATH = join(REPOSITORY_ROOT, 'assets/prettier.json');
const PRETTIER_BIN_PATH = join(REPOSITORY_ROOT, 'node_modules/prettier/bin/prettier.cjs');
const BIOME_JSON_PATH = join(REPOSITORY_ROOT, 'assets/biome.json');
const BIOME_BIN_PATH = join(REPOSITORY_ROOT, 'node_modules/@biomejs/biome/bin/biome');

// Biome resolves a configuration's VCS root against the folder of the configuration it was handed, so the shared one
// is extended from a project of its own, as a consumer's `biome.json` does.
const BIOME_PROJECT_FOLDER = mkdtempSync(join(tmpdir(), 'biome-project-'));
// The shared configuration reads `.gitignore`, and Biome looks for it only inside a git repository.
spawnSync('git', ['init', '--quiet'], { cwd: BIOME_PROJECT_FOLDER });
writeFileSync(join(BIOME_PROJECT_FOLDER, '.gitignore'), '');
writeFileSync(join(BIOME_PROJECT_FOLDER, 'biome.json'), JSON.stringify({ extends: [BIOME_JSON_PATH.replaceAll('\\', '/')] }));

afterAll(() => {
  rmSync(BIOME_PROJECT_FOLDER, { force: true, recursive: true });
});

interface FormatterCase {
  readonly format: (text: string, fileName: string) => string;
  readonly name: string;
}

const FORMATTERS: readonly FormatterCase[] = [
  {
    format: (text, fileName) => runFormatter([DPRINT_BIN_PATH, 'fmt', '--config', DPRINT_JSON_PATH, '--stdin', fileName], REPOSITORY_ROOT, text),
    name: 'dprint'
  },
  {
    format: (text, fileName) => runFormatter([PRETTIER_BIN_PATH, '--config', PRETTIER_JSON_PATH, '--stdin-filepath', fileName], REPOSITORY_ROOT, text),
    name: 'prettier'
  },
  {
    format: (text, fileName) => runFormatter([BIOME_BIN_PATH, 'format', '--stdin-file-path', fileName], BIOME_PROJECT_FOLDER, text),
    name: 'biome'
  }
];

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

function runFormatter(arguments_: string[], cwd: string, text: string): string {
  const result = spawnSync(process.execPath, arguments_, {
    cwd,
    encoding: 'utf-8',
    input: text
  });
  if (result.status !== 0) {
    throw new Error(`Formatting failed: ${arguments_.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

describe.each(FORMATTERS)('the shared ESLint config against the shared $name configuration', ({ format }) => {
  it.each([
    { fileName: 'fixture.ts', fixture: TS_FIXTURE },
    { fileName: 'fixture.tsx', fixture: TSX_FIXTURE }
  ])('should leave no @stylistic report and nothing for the formatter to undo in $fileName', async ({ fileName, fixture }) => {
    const rules = await getEnabledStylisticRules();
    expect(Object.keys(rules)).not.toHaveLength(0);
    const filePath = join(REPOSITORY_ROOT, 'src', fileName);

    const formatted = format(fixture, fileName);
    const [fixResult] = await createStylisticEslint(rules, true).lintText(formatted, { filePath });
    const fixed = fixResult?.output ?? formatted;
    const reformatted = format(fixed, fileName);
    expect(reformatted).toBe(fixed);

    const [lintResult] = await createStylisticEslint(rules, false).lintText(reformatted, { filePath });
    expect(lintResult?.messages.map((message) => `${String(message.line)}: ${message.ruleId ?? ''} ${message.message}`)).toEqual([]);
  });
});
