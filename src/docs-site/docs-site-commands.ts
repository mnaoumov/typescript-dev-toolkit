/**
 * @file
 *
 * The `docs:build`, `docs:dev` and `docs:preview` commands of a documentation site.
 *
 * Each takes the same {@link DocsSiteConfig} the site's `astro.config.ts` passes to `defineDocsSiteConfig`, so a
 * repository describes its site once, in a module both import.
 */

import { join } from 'node:path';

import type { DocsSiteConfig } from './docs-site-config.ts';

import { execFromRoot } from '../root.ts';
import { generateApiDocs } from './api-docs.ts';
import { assertDocsLinksResolve } from './docs-links.ts';
import { getDocsSiteAssetsDirectory } from './docs-site-assets.ts';
import { resolveDocsSiteConfig } from './docs-site-config.ts';
import { generateOgImages } from './og-images.ts';

/**
 * Builds the site: generates the API reference and the Open Graph cards, runs `astro build`, then checks every link
 * of the output.
 *
 * @param config - The site's configuration.
 */
export async function buildDocsSite(config: DocsSiteConfig): Promise<void> {
  const resolved = resolveDocsSiteConfig(config);
  await generateApiDocs({ rootDirectory: resolved.rootDirectory, settings: resolved.apiDocSettings, sourceDirectory: resolved.sourceDirectory });
  await generateOgImages({
    brandText: resolved.packageName,
    contentDocsDirectory: resolved.contentDocsDirectory,
    faviconPath: resolved.faviconPath,
    fontsDirectory: join(getDocsSiteAssetsDirectory(), 'fonts'),
    outputDirectory: resolved.ogOutputDirectory
  });
  await execFromRoot(['astro', 'build'], { cwd: resolved.rootDirectory });
  await assertDocsLinksResolve({ outputDirectory: resolved.distDirectory, siteBaseUrl: resolved.siteBaseUrl });
}

/**
 * Generates the API reference, then serves the site with `astro dev` until it is stopped.
 *
 * @param config - The site's configuration.
 */
export async function devDocsSite(config: DocsSiteConfig): Promise<void> {
  const resolved = resolveDocsSiteConfig(config);
  await generateApiDocs({ rootDirectory: resolved.rootDirectory, settings: resolved.apiDocSettings, sourceDirectory: resolved.sourceDirectory });
  // `ASTRO_DEV_BACKGROUND` forces Astro's foreground dev server. Astro otherwise switches to a background launcher
  // (hardcoded 30s startup timeout) under an agent / non-interactive environment.
  await execFromRoot(['astro', 'dev'], {
    cwd: resolved.rootDirectory,
    env: {
      ASTRO_DEV_BACKGROUND: '1'
    },
    isInteractive: true
  });
}

/**
 * Serves the last build with `astro preview` until it is stopped.
 *
 * @param config - The site's configuration.
 */
export async function previewDocsSite(config: DocsSiteConfig): Promise<void> {
  const resolved = resolveDocsSiteConfig(config);
  await execFromRoot(['astro', 'preview'], { cwd: resolved.rootDirectory, isInteractive: true });
}
