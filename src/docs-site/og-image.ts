/**
 * @file
 *
 * Renders a page's Open Graph card: satori lays it out as SVG, resvg rasterizes it to PNG.
 */

import type { Font } from 'satori';

import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  readdir,
  readFile
} from 'node:fs/promises';
import satori from 'satori';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const BACKGROUND_COLOR = '#111213';
// The violet accent, matching the docs theme (`--sl-color-accent`).
const ACCENT_COLOR = '#8b6ff5';
const ACCENT_BG = 'rgba(103, 172, 172, 0.18)';
const TITLE_COLOR = '#ffffff';
const DESCRIPTION_COLOR = '#9CA3AF';
const BRAND_COLOR = '#8b6ff5';
const BORDER_WIDTH = 8;
const PADDING_X = 80;
const PADDING_TOP = 70;
const PADDING_BOTTOM = 60;
const TITLE_FONT_SIZE = 56;
const DESCRIPTION_FONT_SIZE = 26;
const BADGE_FONT_SIZE = 18;
const BADGE_FONT_WEIGHT = 600;
const BRAND_FONT_SIZE = 28;
const FONT_WEIGHT_REGULAR = 400;
const FONT_WEIGHT_BOLD = 700;
const TITLE_LINE_HEIGHT = 1.2;
const DESCRIPTION_LINE_HEIGHT = 1.5;
// Signature code block (violet accent on a subtle darker rounded panel).
const SIGNATURE_FONT_SIZE = 24;
const SIGNATURE_LINE_HEIGHT = 1.4;
const SIGNATURE_BG = 'rgba(0, 0, 0, 0.35)';
const SIGNATURE_MAX_LINES = 2;
// Site logo (favicon), rasterized once and embedded as a data URI.
const LOGO_DISPLAY_SIZE = 76;
const LOGO_RASTER_SIZE = 152;

/**
 * What one Open Graph card shows: a title, and optionally a description, a code signature and a badge.
 */
export interface OgCardContent {
  readonly badge?: string | undefined;
  readonly description?: string | undefined;
  readonly signature?: string | undefined;
  readonly title: string;
}

/**
 * The per-site part of every card: the fonts, the logo and the brand text in the footer.
 */
export interface RenderOgImageOptions {
  /**
   * The text the footer carries, normally the package's name.
   */
  readonly brandText: string;

  /**
   * The fonts satori renders the text with.
   */
  readonly fonts: Font[];

  /**
   * The site logo as a PNG data URI, or `null` to render the card without one.
   */
  readonly logoDataUri: null | string;
}

/**
 * Hashes a card's content, so an unchanged card is not rendered again.
 *
 * @param params - The card's content.
 * @returns A 16-character hex digest.
 */
export function computeOgHash(params: OgCardContent): string {
  const input = JSON.stringify({
    badge: params.badge ?? '',
    description: params.description ?? '',
    signature: params.signature ?? '',
    title: params.title
  });
  const HASH_LENGTH = 16;
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Loads the fonts satori needs to render text.
 *
 * This package ships `inter-latin-400-normal.ttf` / `inter-latin-700-normal.ttf` under
 * `assets/docs-site/fonts`; this falls back to any other `.ttf`/`.otf` in `fontsDirectory` and
 * returns `null` when the directory holds none, so the caller can skip OG generation instead of
 * crashing the build.
 *
 * @param fontsDirectory - The folder holding the fonts.
 * @returns The fonts, or `null` when the folder holds none.
 */
export async function loadFonts(fontsDirectory: string): Promise<Font[] | null> {
  const regularPath = `${fontsDirectory}/inter-latin-400-normal.ttf`;
  const boldPath = `${fontsDirectory}/inter-latin-700-normal.ttf`;

  if (existsSync(regularPath) && existsSync(boldPath)) {
    const [regularData, boldData] = await Promise.all([
      readFile(regularPath),
      readFile(boldPath)
    ]);
    return [
      { data: regularData, name: 'Inter', style: 'normal' as const, weight: FONT_WEIGHT_REGULAR },
      { data: boldData, name: 'Inter', style: 'normal' as const, weight: FONT_WEIGHT_BOLD }
    ];
  }

  // Fallback: reuse any single font file in the directory for both weights.
  if (existsSync(fontsDirectory)) {
    const entries = await readdir(fontsDirectory);
    const fontFile = entries.find((name) => name.endsWith('.ttf') || name.endsWith('.otf'));
    if (fontFile) {
      const data = await readFile(`${fontsDirectory}/${fontFile}`);
      return [
        { data, name: 'Inter', style: 'normal' as const, weight: FONT_WEIGHT_REGULAR },
        { data, name: 'Inter', style: 'normal' as const, weight: FONT_WEIGHT_BOLD }
      ];
    }
  }

  return null;
}

/**
 * Rasterize an SVG favicon to a PNG data URI via resvg for embedding in the satori layout (satori's
 * `<img>` needs a raster/data-URI source). Returns `null` when the file is missing so the caller can
 * render the card without a logo. Call this ONCE and reuse the result across all cards.
 *
 * @param faviconPath - The SVG favicon's path.
 * @returns The PNG data URI, or `null` when the favicon is missing.
 */
export async function loadLogoDataUri(faviconPath: string): Promise<null | string> {
  if (!existsSync(faviconPath)) {
    return null;
  }
  const svg = await readFile(faviconPath, 'utf-8');
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: LOGO_RASTER_SIZE } });
  const png = resvg.render().asPng();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Renders a page's card to a PNG.
 *
 * @param params - The card's content.
 * @param options - The fonts, logo and brand text every card shares.
 * @returns The PNG.
 */
export async function renderOgImage(params: OgCardContent, options: RenderOgImageOptions): Promise<Buffer> {
  const markup = buildOgImageMarkup(params, options);
  const svg = await satori(markup, {
    fonts: options.fonts,
    height: OG_HEIGHT,
    width: OG_WIDTH
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH }
  });
  return resvg.render().asPng();
}

function buildBadgeMarkup(badge: string): Record<string, unknown> {
  return {
    props: {
      children: badge,
      style: {
        alignItems: 'center',
        background: ACCENT_BG,
        borderRadius: '20px',
        color: ACCENT_COLOR,
        display: 'flex',
        fontSize: `${String(BADGE_FONT_SIZE)}px`,
        fontWeight: BADGE_FONT_WEIGHT,
        padding: '6px 14px'
      }
    },
    type: 'div'
  };
}

function buildLogoMarkup(logoDataUri: string): Record<string, unknown> {
  return {
    props: {
      height: LOGO_DISPLAY_SIZE,
      src: logoDataUri,
      style: {
        height: `${String(LOGO_DISPLAY_SIZE)}px`,
        width: `${String(LOGO_DISPLAY_SIZE)}px`
      },
      width: LOGO_DISPLAY_SIZE
    },
    type: 'img'
  };
}

function buildOgImageMarkup(params: OgCardContent, options: RenderOgImageOptions): Record<string, unknown> {
  const badgeNode = params.badge ? buildBadgeMarkup(params.badge) : null;
  const logoNode = options.logoDataUri ? buildLogoMarkup(options.logoDataUri) : null;

  // Top row: logo on the left, badge on the right.
  const topRowChildren: Record<string, unknown>[] = [
    ...(logoNode ? [logoNode] : []),
    { props: { style: { flex: 1 } }, type: 'div' },
    ...(badgeNode ? [badgeNode] : [])
  ];
  const topRow = {
    props: {
      children: topRowChildren,
      style: {
        alignItems: 'center',
        display: 'flex',
        marginBottom: '24px'
      }
    },
    type: 'div'
  };

  // Title
  const title = {
    props: {
      children: params.title,
      style: {
        color: TITLE_COLOR,
        fontSize: `${String(TITLE_FONT_SIZE)}px`,
        fontWeight: FONT_WEIGHT_BOLD,
        lineHeight: TITLE_LINE_HEIGHT,
        marginBottom: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    },
    type: 'div'
  };

  // Signature code block (between title and description) — omitted for pages with no signature.
  const signatureNode = params.signature ? buildSignatureMarkup(params.signature) : null;

  // Description
  const description = {
    props: {
      children: params.description ?? '',
      style: {
        color: DESCRIPTION_COLOR,
        flex: 1,
        fontSize: `${String(DESCRIPTION_FONT_SIZE)}px`,
        lineHeight: DESCRIPTION_LINE_HEIGHT,
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    },
    type: 'div'
  };

  // Footer with the package name as text branding (the favicon is rendered separately, in the header)
  const footer = {
    props: {
      children: [
        { props: { style: { flex: 1 } }, type: 'div' },
        {
          props: {
            children: options.brandText,
            style: {
              color: BRAND_COLOR,
              fontSize: `${String(BRAND_FONT_SIZE)}px`,
              fontWeight: FONT_WEIGHT_BOLD
            }
          },
          type: 'div'
        }
      ],
      style: {
        alignItems: 'flex-end',
        display: 'flex'
      }
    },
    type: 'div'
  };

  // Root container
  return {
    props: {
      children: [
        {
          props: {
            children: signatureNode ? [topRow, title, signatureNode, description] : [topRow, title, description],
            style: {
              display: 'flex',
              flex: 1,
              flexDirection: 'column'
            }
          },
          type: 'div'
        },
        footer
      ],
      style: {
        background: BACKGROUND_COLOR,
        borderLeft: `${String(BORDER_WIDTH)}px solid ${ACCENT_COLOR}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        padding: `${String(PADDING_TOP)}px ${String(PADDING_X)}px ${String(PADDING_BOTTOM)}px ${String(PADDING_X)}px`,
        width: '100%'
      }
    },
    type: 'div'
  };
}

function buildSignatureMarkup(signature: string): Record<string, unknown> {
  return {
    props: {
      children: signature,
      style: {
        background: SIGNATURE_BG,
        borderRadius: '12px',
        color: ACCENT_COLOR,
        display: '-webkit-box',
        fontFamily: 'monospace',
        fontSize: `${String(SIGNATURE_FONT_SIZE)}px`,
        lineClamp: SIGNATURE_MAX_LINES,
        lineHeight: SIGNATURE_LINE_HEIGHT,
        marginBottom: '28px',
        overflow: 'hidden',
        padding: '16px 24px'
      }
    },
    type: 'div'
  };
}
