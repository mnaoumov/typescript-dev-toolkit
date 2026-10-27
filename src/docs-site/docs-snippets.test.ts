import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  assertDocsSnippetsCompile,
  extractDocsSnippets,
  findDocsSnippetProblems,
  formatDocsSnippetProblems
} from './docs-snippets.ts';

const TSCONFIG = {
  compilerOptions: {
    lib: ['ES2022', 'DOM'],
    module: 'node16',
    moduleResolution: 'node16',
    noEmit: true,
    noUnusedLocals: true,
    strict: true,
    target: 'es2022',
    types: []
  }
};

describe('extractDocsSnippets', () => {
  it('should extract only the checked languages, with the line the code starts on', () => {
    const snippets = extractDocsSnippets(['# Title', '', '```ts', 'const a = 1;', '```', '', '```bash', 'npm test', '```', '', '```js', 'b();', '```'].join('\n'));
    expect(snippets.map((snippet) => [snippet.language, snippet.code, snippet.codeStartLine, snippet.isJavaScript])).toEqual([
      ['ts', 'const a = 1;', 4, false],
      ['js', 'b();', 12, true]
    ]);
  });

  it('should strip a blockquote prefix', () => {
    const [snippet] = extractDocsSnippets(['> ```ts', '> class A {}', '>', '> ```'].join('\n'));
    expect(snippet?.code).toBe('class A {}\n');
  });

  it('should strip the indentation of a fence in a list item', () => {
    const [snippet] = extractDocsSnippets(['1. Step:', '', '   ~~~TypeScript', '   const a = 1;', '   ~~~'].join('\n'));
    expect([snippet?.language, snippet?.code]).toEqual(['typescript', 'const a = 1;']);
  });

  it('should read the skip and context markers right above the fence', () => {
    const snippets = extractDocsSnippets([
      '<!-- snippet-check: skip pseudo-code -->',
      '',
      '```ts',
      'alpha();',
      '```',
      '<!-- snippet-check: context declare const x: number; -->',
      '<!-- snippet-check: context declare const y: number; -->',
      '```ts',
      'x + y;',
      '```',
      '<!-- snippet-check: skip: a reason after a colon -->',
      'Some prose in between.',
      '```ts',
      'z();',
      '```',
      '<!-- snippet-check: skip — a reason after a dash -->',
      '```ts',
      'w();',
      '```'
    ].join('\n'));
    expect(snippets.map((snippet) => [snippet.skipReason, snippet.context])).toEqual([
      ['pseudo-code', ''],
      [null, 'declare const x: number;\ndeclare const y: number;'],
      [null, ''],
      ['a reason after a dash', '']
    ]);
  });

  it('should report a skip marker without a reason as an empty reason', () => {
    const [snippet] = extractDocsSnippets(['<!-- snippet-check: skip -->', '```ts', 'a();', '```'].join('\n'));
    expect(snippet?.skipReason).toBe('');
  });

  it('should ignore an unknown marker kind', () => {
    const [snippet] = extractDocsSnippets(['<!-- snippet-check: other x -->', '```ts', 'a();', '```'].join('\n'));
    expect([snippet?.skipReason, snippet?.context]).toEqual([null, '']);
  });
});

describe('findDocsSnippetProblems', () => {
  let rootDirectory = '';

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'docs-snippets-'));
    writeFileSync(join(rootDirectory, 'tsconfig.json'), JSON.stringify(TSCONFIG));
    mkdirSync(join(rootDirectory, 'src'));
    writeFileSync(join(rootDirectory, 'src', 'lib.ts'), 'export function greet(name: string): string {\n  return name;\n}\n');
  });

  afterEach(() => {
    rmSync(rootDirectory, { force: true, recursive: true });
  });

  function writeGuide(relativePath: string, lines: readonly string[]): void {
    const path = join(rootDirectory, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, lines.join('\n'));
  }

  it('should report a type error on the guide line it is on', async () => {
    writeGuide('docs/src/content/docs/guides/a.md', [
      '# A',
      '',
      '<!-- snippet-check: context declare const count: number; -->',
      '```ts',
      'import { greet } from \'../../src/lib.ts\';',
      'const unused = 1;',
      'greet(count);',
      '```'
    ]);
    const problems = await findDocsSnippetProblems({ compilerOptions: { allowImportingTsExtensions: true }, rootDirectory });
    expect(problems).toEqual([
      expect.objectContaining({ filePath: 'docs/src/content/docs/guides/a.md', line: 7 })
    ]);
    expect(problems[0]?.message).toMatch(/^TS2345: /u);
  });

  it('should hold a JavaScript snippet to its typed members but not to implicit any', async () => {
    writeGuide('docs/src/content/docs/b.mdx', [
      '```js',
      'function f(x) { return x; }',
      'f(1);',
      'document.notAMember;',
      '```'
    ]);
    const problems = await findDocsSnippetProblems({ rootDirectory });
    expect(problems.map((problem) => [problem.line, problem.message.slice(0, 'TS0000'.length)])).toEqual([[4, 'TS2339']]);
  });

  it('should compile every snippet with the prelude', async () => {
    writeGuide('guides/c.md', ['```typescript', 'const n: number = preludeValue;', '```']);
    const prelude = 'declare global {\n  const preludeValue: number;\n}\nexport {};\n';
    expect(await findDocsSnippetProblems({ docsDirectory: 'guides', prelude, rootDirectory })).toEqual([]);
    const problemsWithoutPrelude = await findDocsSnippetProblems({ docsDirectory: 'guides', rootDirectory });
    expect(problemsWithoutPrelude.map((problem) => problem.message)).toEqual([
      expect.stringMatching(/^TS2304: /u)
    ]);
  });

  it('should skip a snippet with a reason, the API reference and other files, and refuse a skip without one', async () => {
    writeGuide('docs/src/content/docs/d.md', [
      '<!-- snippet-check: skip pseudo-code -->',
      '```ts',
      'not code at all',
      '```',
      '',
      '<!-- snippet-check: skip -->',
      '```ts',
      'also not code',
      '```'
    ]);
    writeGuide('docs/src/content/docs/api/e.md', ['```ts', 'broken(', '```']);
    writeGuide('docs/src/content/docs/notes.txt', ['```ts', 'broken(', '```']);
    expect(await findDocsSnippetProblems({ rootDirectory })).toEqual([
      { filePath: 'docs/src/content/docs/d.md', line: 7, message: 'A `snippet-check: skip` marker must give its reason.' }
    ]);
  });

  it('should throw when tsconfig.json cannot be read', async () => {
    rmSync(join(rootDirectory, 'tsconfig.json'));
    writeGuide('docs/src/content/docs/f.md', ['```ts', 'const a = 1;', '```']);
    await expect(findDocsSnippetProblems({ rootDirectory })).rejects.toThrow(/tsconfig\.json/u);
  });

  it('should throw listing the problems from assertDocsSnippetsCompile', async () => {
    writeGuide('docs/src/content/docs/g.md', ['```ts', 'const a: string = 1;', '```']);
    await expect(assertDocsSnippetsCompile({ rootDirectory })).rejects.toThrow(/^1 problem\(s\) in the documentation snippets:\ndocs\/src\/content\/docs\/g\.md:2 - TS2322: /u);
  });

  it('should pass assertDocsSnippetsCompile when every snippet compiles', async () => {
    writeGuide('docs/src/content/docs/h.md', ['```ts', 'const a: string = \'a\';', '```']);
    await expect(assertDocsSnippetsCompile({ rootDirectory })).resolves.toBeUndefined();
  });
});

describe('formatDocsSnippetProblems', () => {
  it('should format one problem per line', () => {
    expect(formatDocsSnippetProblems([
      { filePath: 'a.md', line: 1, message: 'one' },
      { filePath: 'b.md', line: 2, message: 'two' }
    ])).toBe('a.md:1 - one\nb.md:2 - two');
  });
});
