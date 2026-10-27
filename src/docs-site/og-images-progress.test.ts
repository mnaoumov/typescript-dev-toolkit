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
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { generateOgImages } from './og-images.ts';

vi.mock('./og-image.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./og-image.ts')>(),
  renderOgImage: vi.fn(() => Promise.resolve(Buffer.from('png')))
}));

const PAGE_COUNT = 101;

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('generateOgImages on a large site', () => {
  it('logs its progress every hundred cards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'og-images-progress-'));
    roots.push(root);
    mkdirSync(join(root, 'content'));
    for (let index = 0; index < PAGE_COUNT; index++) {
      writeFileSync(join(root, 'content', `page-${String(index)}.md`), `---\ntitle: Page ${String(index)}\n---\n`);
    }

    await generateOgImages({
      brandText: 'x',
      contentDocsDirectory: join(root, 'content'),
      faviconPath: join(root, 'favicon.svg'),
      fontsDirectory: join(import.meta.dirname, '..', '..', 'assets', 'docs-site', 'fonts'),
      outputDirectory: join(root, 'og')
    });

    expect(warn).toHaveBeenCalledWith('  100/101 images generated...');
  });
});
