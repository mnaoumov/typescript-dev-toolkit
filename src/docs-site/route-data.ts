/**
 * @file
 *
 * Adds per-page Open Graph and Twitter image metadata. `defineDocsSiteConfig` registers it as Starlight route
 * middleware; the cards it points at are the ones `generateOgImages` writes.
 */

import type { APIContext } from 'astro';

/**
 * Adds Open Graph and Twitter image metadata to a Starlight documentation response.
 *
 * @param context - Astro's request context.
 */
export function onRequest(context: APIContext): void {
  // Starlight sets this documented route-data value before invoking user middleware.
  const { starlightRoute } = context.locals;
  const { id } = starlightRoute;
  const slug = id
    .replace(/\/index$/, '')
    .replace(/\.\w+$/, '');
  // The site title links to the home page, which is the base path on a site without locales.
  const base = starlightRoute.siteTitleHref.replace(/\/$/, '');
  const origin = context.url.origin;
  const ogImageUrl = `${origin}${base}/og/${slug || 'index'}.png`;

  starlightRoute.head.push(
    { attrs: { content: ogImageUrl, property: 'og:image' }, tag: 'meta' },
    { attrs: { content: '1200', property: 'og:image:width' }, tag: 'meta' },
    { attrs: { content: '630', property: 'og:image:height' }, tag: 'meta' },
    { attrs: { content: ogImageUrl, name: 'twitter:image' }, tag: 'meta' }
  );
}
