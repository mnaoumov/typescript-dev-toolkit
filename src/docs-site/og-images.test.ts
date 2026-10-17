import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { generateOgImages } from './og-images.ts';

const FONTS_DIRECTORY = join(import.meta.dirname, '..', '..', 'assets', 'docs-site', 'fonts');
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#8b6ff5"/></svg>';

interface Manifest {
  readonly cards: object;
  readonly logoHash: string;
}

const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createRoot(files: Readonly<Partial<Record<string, string>>>): string {
  const root = mkdtempSync(join(tmpdir(), 'og-images-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content ?? '');
  }
  return root;
}

function getOptions(root: string): Parameters<typeof generateOgImages>[0] {
  return {
    brandText: '@mnaoumov/typescript-lib',
    contentDocsDirectory: join(root, 'content'),
    faviconPath: join(root, 'favicon.svg'),
    fontsDirectory: FONTS_DIRECTORY,
    outputDirectory: join(root, 'og')
  };
}

describe('generateOgImages', () => {
  it('renders a card per titled page and reuses unchanged cards on the next run', async () => {
    const root = createRoot({
      'content/api/Alpha.mdx': '---\ntitle: Alpha\nslug: api/x/Alpha\nsignature: "function alpha(): void"\nsidebar:\n  badge:\n    text: New\n---\nBody',
      'content/empty.md': '---\n\n---\n',
      'content/guides/intro.md': '---\r\ntitle: Intro\r\ndescription: An intro.\r\n---\r\n',
      'content/index.mdx': '---\ntitle: Home\n---',
      'content/no-front-matter.md': 'Just text.',
      'content/notes.txt': 'ignored',
      'content/untitled.md': '---\ndescription: none\n---\n',
      'favicon.svg': FAVICON
    });
    const options = getOptions(root);

    await generateOgImages(options);

    expect(existsSync(join(options.outputDirectory, 'api/x/Alpha.png'))).toBe(true);
    expect(existsSync(join(options.outputDirectory, 'guides/intro.png'))).toBe(true);
    expect(existsSync(join(options.outputDirectory, 'index.png'))).toBe(true);
    expect(existsSync(join(options.outputDirectory, 'untitled.png'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(options.outputDirectory, '.cache-manifest.json'), 'utf-8')) as Manifest;
    expect(Object.keys(manifest.cards).sort()).toEqual(['api/x/Alpha', 'guides/intro', 'index']);
    expect(manifest.logoHash).toMatch(/^[0-9a-f]{64}$/);

    const modified = statSync(join(options.outputDirectory, 'index.png')).mtimeMs;
    await generateOgImages(options);
    expect(statSync(join(options.outputDirectory, 'index.png')).mtimeMs).toBe(modified);
    expect(console.warn).toHaveBeenCalledWith('All OG images up to date.');
  }, 60_000);

  it('re-renders every card when the logo changes', async () => {
    const root = createRoot({
      'content/a.md': '---\ntitle: A\n---\n',
      'content/b.md': '---\ntitle: B\n---\n',
      'favicon.svg': FAVICON
    });
    const options = getOptions(root);
    await generateOgImages(options);

    writeFileSync(options.faviconPath, FAVICON.replace('#8b6ff5', '#ff0000'));
    vi.mocked(console.warn).mockClear();
    await generateOgImages(options);

    expect(console.warn).toHaveBeenCalledWith('OG images: 2 changed / 2 total');
  }, 60_000);

  it('re-renders every card when the logo is removed', async () => {
    const root = createRoot({ 'content/a.md': '---\ntitle: A\n---\n', 'favicon.svg': FAVICON });
    const options = getOptions(root);
    await generateOgImages(options);

    rmSync(options.faviconPath);
    vi.mocked(console.warn).mockClear();
    await generateOgImages(options);

    expect(console.warn).toHaveBeenCalledWith('OG images: 1 changed / 1 total');
  }, 60_000);

  it.each([
    ['a flat manifest from before the logo was tracked', { index: 'stale' }],
    ['a manifest without cards', { logoHash: 'stale' }]
  ])('re-renders every card from %s', async (_name, manifest) => {
    const root = createRoot({
      'content/index.md': '---\ntitle: Home\n---\n',
      'favicon.svg': FAVICON,
      'og/.cache-manifest.json': JSON.stringify(manifest)
    });

    await generateOgImages(getOptions(root));

    expect(console.warn).toHaveBeenCalledWith('OG images: 1 changed / 1 total');
  }, 60_000);

  it('renders without a logo when the favicon is missing', async () => {
    const root = createRoot({ 'content/index.md': '---\ntitle: Home\n---\n' });

    await generateOgImages(getOptions(root));

    expect(existsSync(join(root, 'og', 'index.png'))).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('rendering cards without a logo'));
  });

  it('skips when the content folder is missing', async () => {
    const root = createRoot({});

    await generateOgImages(getOptions(root));

    expect(existsSync(join(root, 'og'))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('content dir not found'));
  });

  it('skips when no fonts are available', async () => {
    const root = createRoot({ 'content/index.md': '---\ntitle: Home\n---\n' });

    await generateOgImages({ ...getOptions(root), fontsDirectory: join(root, 'no-fonts') });

    expect(existsSync(join(root, 'og'))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no fonts available'));
  });
});
