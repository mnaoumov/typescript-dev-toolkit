/**
 * @file
 *
 * Generates an Open Graph card for every documentation page, reusing the cards whose inputs did not change.
 */

import type { Font } from 'satori';

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import { dirname } from 'node:path/posix';
import { parse as parseYaml } from 'yaml';

import type { OgCardContent } from './og-image.ts';

import { getBulkConcurrency } from '../bulk-concurrency.ts';
import { getOgImagePageSlug } from './og-image-page.ts';
import {
  computeOgHash,
  loadFonts,
  loadLogoDataUri,
  renderOgImage
} from './og-image.ts';

/**
 * Options for {@link generateOgImages}.
 */
export interface GenerateOgImagesParams {
  /**
   * The text every card's footer carries, normally the package's name.
   */
  readonly brandText: string;

  /**
   * The documentation content root, normally `<docs>/src/content/docs`. Every `.md` / `.mdx` page under it with a
   * `title` gets a card.
   */
  readonly contentDocsDirectory: string;

  /**
   * The SVG logo drawn on every card. A missing file renders the cards without one.
   */
  readonly faviconPath: string;

  /**
   * The folder holding the fonts the cards are rendered with.
   */
  readonly fontsDirectory: string;

  /**
   * The folder the cards are written to, normally `<docs>/public/og`, served at `<base>/og/<slug>.png`.
   */
  readonly outputDirectory: string;
}

interface CacheManifest {
  // Each page's content hash, by slug.
  readonly cards: CardHashes;
  // The hash of the logo every card carries. The page hashes cannot see it, so a different logo drops them all.
  readonly logoHash: string;
}

type CardHashes = Partial<Record<string, string>>;

interface GenerateImagesWithPoolOptions {
  readonly brandText: string;
  readonly cards: CardHashes;
  readonly changedPages: PageEntry[];
  readonly fonts: Font[];
  readonly logoDataUri: null | string;
  readonly outputDirectory: string;
}

interface PageEntry {
  readonly hash: string;
  readonly params: OgCardContent;
  readonly slug: string;
}

const CONCURRENCY = 10;
const PROGRESS_LOG_INTERVAL = 100;
const MANIFEST_INDENT = 2;

// Frontmatter is parsed here rather than with `gray-matter`. Its `lib/engines.js` binds js-yaml's
// `safeLoad`/`safeDump` at MODULE-LOAD time, and both were removed in js-yaml v4 — so merely
// IMPORTING `gray-matter` throws `Cannot read properties of undefined (reading 'bind')`, before an
// `engines` option could override the default. Only the frontmatter object is needed here.
const FRONT_MATTER_REG_EXP = /^---\r?\n(?<FrontMatter>[\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Generates the Open Graph cards.
 *
 * A card is re-rendered only when its title, description, signature or badge changed, tracked by a hash manifest
 * beside the cards. A different logo file re-renders every card. Missing content or fonts skip the step with a warning rather than failing the build.
 *
 * @param options - The options.
 */
export async function generateOgImages(options: GenerateOgImagesParams): Promise<void> {
  const { brandText, contentDocsDirectory, faviconPath, fontsDirectory, outputDirectory } = options;
  const manifestPath = `${outputDirectory}/.cache-manifest.json`;

  if (!existsSync(contentDocsDirectory)) {
    console.warn(`OG images: content dir not found (${contentDocsDirectory}); skipping.`);
    return;
  }

  // Load fonts first — satori cannot render without them.
  const fonts = await loadFonts(fontsDirectory);
  if (!fonts) {
    console.warn(`OG images: no fonts available in ${fontsDirectory}; skipping OG image generation.`);
    return;
  }

  const pages: PageEntry[] = [];
  await walkDirectory(contentDocsDirectory, contentDocsDirectory, pages);
  console.warn(`OG images: found ${String(pages.length)} pages`);

  const logoHash = await computeLogoHash(faviconPath);
  const manifest = await loadCacheManifest(manifestPath);
  const cards = manifest?.logoHash === logoHash ? { ...manifest.cards } : {};
  const changedPages = pages.filter((page) => cards[page.slug] !== page.hash);
  console.warn(`OG images: ${String(changedPages.length)} changed / ${String(pages.length)} total`);

  if (changedPages.length === 0) {
    console.warn('All OG images up to date.');
    return;
  }

  // Rasterize the site logo once (shared across every card); degrade gracefully if absent.
  const logoDataUri = await loadLogoDataUri(faviconPath);
  if (!logoDataUri) {
    console.warn(`OG images: favicon not found (${faviconPath}); rendering cards without a logo.`);
  }

  await generateImagesWithPool({ brandText, cards, changedPages, fonts, logoDataUri, outputDirectory });

  const newManifest: CacheManifest = { cards, logoHash };
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(newManifest, null, MANIFEST_INDENT));
  console.warn(`OG images: done. Generated ${String(changedPages.length)} images.`);
}

async function computeLogoHash(faviconPath: string): Promise<string> {
  return existsSync(faviconPath) ? createHash('sha256').update(await readFile(faviconPath)).digest('hex') : '';
}

async function generateImagesWithPool(options: GenerateImagesWithPoolOptions): Promise<void> {
  const { brandText, cards, changedPages, fonts, logoDataUri, outputDirectory } = options;
  let completed = 0;
  let index = 0;

  async function processNext(): Promise<void> {
    for (let page = changedPages[index++]; page !== undefined; page = changedPages[index++]) {
      const outputPath = `${outputDirectory}/${page.slug}.png`;
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, await renderOgImage(page.params, { brandText, fonts, logoDataUri }));
      cards[page.slug] = page.hash;
      completed++;
      if (completed % PROGRESS_LOG_INTERVAL === 0) {
        console.warn(`  ${String(completed)}/${String(changedPages.length)} images generated...`);
      }
    }
  }

  await Promise.all(Array.from({ length: getBulkConcurrency(CONCURRENCY) }, async () => {
    await processNext();
  }));
}

async function loadCacheManifest(manifestPath: string): Promise<CacheManifest | null> {
  if (!existsSync(manifestPath)) {
    return null;
  }
  // A manifest written before the logo was tracked is a flat slug-to-hash map: it has no `logoHash`, so every card
  // re-renders once.
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Partial<CacheManifest>;
  return typeof manifest.logoHash === 'string' && typeof manifest.cards === 'object'
    ? { cards: manifest.cards, logoHash: manifest.logoHash }
    : null;
}

function parseFrontMatter(content: string): Partial<Record<string, unknown>> {
  const frontMatter = FRONT_MATTER_REG_EXP.exec(content)?.groups?.['FrontMatter'];
  return frontMatter === undefined ? {} : (parseYaml(frontMatter) as null | Partial<Record<string, unknown>>) ?? {};
}

async function parsePage(filePath: string, contentDocsDirectory: string): Promise<null | PageEntry> {
  const data = parseFrontMatter(await readFile(filePath, 'utf-8'));

  const title = toOptionalString(data['title']);
  if (!title) {
    return null;
  }

  const badge = data['sidebar'] as Partial<Record<string, Partial<Record<string, unknown>>>> | undefined;
  const params: OgCardContent = {
    badge: toOptionalString(badge?.['badge']?.['text']),
    description: toOptionalString(data['description']) ?? '',
    signature: toOptionalString(data['signature']) ?? '',
    title
  };

  return {
    hash: computeOgHash(params),
    params,
    slug: getOgImagePageSlug(data, filePath, contentDocsDirectory)
  };
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function walkDirectory(directory: string, contentDocsDirectory: string, pages: PageEntry[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, contentDocsDirectory, pages);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const page = await parsePage(fullPath, contentDocsDirectory);
      if (page) {
        pages.push(page);
      }
    }
  }
}
