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
  assertNoOutdatedReferences,
  findOutdatedReferences,
  findOutdatedReferencesInText,
  formatOutdatedReferences
} from './outdated-references.ts';

// Assembled, so this file is not itself an outdated reference to whatever scans it.
const RETIRED = ['obsidian', 'dev', 'utils'].join('-');

describe('findOutdatedReferencesInText', () => {
  it('should flag the retired package used as an address', () => {
    const text = [
      `See \`${RETIRED}/obsidian/markdown\`.`,
      `import { loop } from '${RETIRED}';`,
      '__obsidianDevUtils.sharedAbortController.value.abort();',
      `https://github.com/mnaoumov/${RETIRED}/releases/latest/download/styles.css`
    ].join('\n');
    expect(findOutdatedReferencesInText('a.md', text).map((reference) => reference.line)).toEqual([1, 2, 3, 4]);
  });

  it('should not flag the wire names that are kept', () => {
    const text = [
      `window.DEBUG.enable('*:${RETIRED}:*');`,
      `.alpha-bravo.${RETIRED} :invalid {`,
      `It replaces [\`${RETIRED}\`](https://github.com/mnaoumov/${RETIRED}).`,
      'globalThis.__obsidianDevUtils.pluginApiRegistry.value.records[pluginId]'
    ].join('\n');
    expect(findOutdatedReferencesInText('a.md', text)).toEqual([]);
  });

  it('should honour the allow marker on the same line', () => {
    expect(findOutdatedReferencesInText('a.md', `Was \`${RETIRED}/obsidian/loop\`. <!-- outdated-reference-ok -->`)).toEqual([]);
  });
});

describe('findOutdatedReferences', () => {
  let rootDirectory = '';

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'outdated-references-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { force: true, recursive: true });
  });

  function writeFile(relativePath: string, text: string): void {
    const path = join(rootDirectory, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }

  it('should find nothing in a package with none of the scanned files', async () => {
    expect(await findOutdatedReferences(rootDirectory)).toEqual([]);
    await expect(assertNoOutdatedReferences(rootDirectory)).resolves.toBeUndefined();
  });

  it('should scan the README, the guides and the sources, and skip the rest', async () => {
    const reference = `\`${RETIRED}/x\``;
    writeFile('README.md', reference);
    writeFile('CHANGELOG.md', reference);
    writeFile('docs/src/content/docs/guides/a.md', reference);
    writeFile('docs/src/content/docs/api/b.md', reference);
    writeFile('src/c.ts', reference);
    writeFile('src/c.test.ts', reference);
    writeFile('src/c.d.ts', reference);
    writeFile('src/__merged.ts', reference);
    writeFile('scripts/nested/d.ts', reference);
    const references = await findOutdatedReferences(rootDirectory);
    expect(references.map((found) => found.filePath)).toEqual([
      'README.md',
      'docs/src/content/docs/guides/a.md',
      'src/c.ts',
      'scripts/nested/d.ts'
    ]);
  });

  it('should throw listing the references from assertNoOutdatedReferences', async () => {
    writeFile('src/a.ts', `import { x } from '${RETIRED}';\n`);
    await expect(assertNoOutdatedReferences(rootDirectory)).rejects.toThrow(/^1 outdated reference\(s\):\nsrc\/a\.ts:1 - import/u);
  });
});

describe('formatOutdatedReferences', () => {
  it('should format one reference per line', () => {
    expect(formatOutdatedReferences([{ filePath: 'a.md', hint: 'h', line: 2, text: 't' }])).toBe('a.md:2 - t (h)');
  });
});
