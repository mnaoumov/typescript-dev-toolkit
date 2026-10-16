/**
 * @file
 *
 * The Astro + Starlight configuration every documentation site is built with.
 *
 * A site's own `astro.config.ts` is one call, `export default defineDocsSiteConfig({ repo, title })`: the base path,
 * the edit and GitHub links, the sidebar, the shared components and stylesheet, the Open Graph metadata and the
 * Markdown plugins all follow from the repository's name.
 */

import type { StarlightUserConfig } from '@astrojs/starlight/types';
import type { AstroUserConfig } from 'astro';

import { satteri } from '@astrojs/markdown-satteri';
// eslint-disable-next-line import-x/no-rename-default -- The default export name `StarlightIntegration` is too verbose.
import starlight from '@astrojs/starlight';
import {
  extname,
  join,
  toPosixPath
} from '@mnaoumov/typescript-lib/path';
import { defineConfig } from 'astro/config';
import {
  existsSync,
  readFileSync
} from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { DocsSiteConfig } from './docs-site-config.ts';

import {
  API_COMPONENTS_IMPORT_PREFIX,
  getDocsSiteAssetsDirectory
} from './docs-site-assets.ts';
import { resolveDocsSiteConfig } from './docs-site-config.ts';
import { satteriGitHubAlerts } from './satteri-github-alerts.ts';
import { satteriRelativeLinks } from './satteri-relative-links.ts';

type SidebarItems = NonNullable<StarlightUserConfig['sidebar']>;

/**
 * Builds a documentation site's Astro configuration.
 *
 * The site's source lives under `<docs>/src` (`srcDir`), so it never collides with the package's own `src/` and
 * `dist/`. The API reference is generated into `<docs>/src/content/docs/api` with a matching
 * `<docs>/src/generated-sidebar.json`, which this reads; run the generator first.
 *
 * @param config - The site's configuration.
 * @returns The Astro configuration.
 */
export function defineDocsSiteConfig(config: DocsSiteConfig): AstroUserConfig {
  const resolved = resolveDocsSiteConfig(config);
  const assetsDirectory = toPosixPath(getDocsSiteAssetsDirectory());

  return defineConfig({
    base: resolved.basePath,
    integrations: [
      starlight({
        components: {
          SiteTitle: join(assetsDirectory, 'components', 'SiteTitle.astro')
        },
        customCss: [
          join(assetsDirectory, 'styles', 'global.css')
        ],
        editLink: {
          baseUrl: resolved.editLinkBaseUrl
        },
        favicon: '/favicon.svg',
        routeMiddleware: getRouteDataModulePath(),
        sidebar: [
          {
            items: [{ autogenerate: { directory: resolved.guidesDirectory } }],
            label: 'Guides'
          },
          ...readApiSidebar(resolved.apiDocSettings.sidebarFile)
        ],
        social: [
          { href: resolved.githubUrl, icon: 'github', label: 'GitHub' }
        ],
        title: resolved.title
      })
    ],
    markdown: {
      // Astro 7.3 made Sätteri the default Markdown processor; `markdown.remarkPlugins` now runs only on the
      // `unified` processor from `@astrojs/markdown-remark`, which Astro no longer installs. Naming the
      // Sätteri processor here keeps the pipeline on it, carrying the link rewrite as one of its mdast plugins.
      // The GitHub-alert conversion rides here too, ahead of the asides plugin Starlight appends after these:
      // `starlight-github-alerts` cannot find that plugin on Starlight 0.42 and silently skipped every page.
      processor: satteri({ mdastPlugins: [satteriGitHubAlerts(), satteriRelativeLinks(resolved.basePath)] })
    },
    // eslint-disable-next-line unicorn/name-replacements -- `outDir` is an Astro config key.
    outDir: resolved.distDirectory,
    // eslint-disable-next-line unicorn/name-replacements -- `publicDir` is an Astro config key.
    publicDir: resolved.publicDirectory,
    root: resolved.rootDirectory,
    site: resolved.siteOrigin,
    // eslint-disable-next-line unicorn/name-replacements -- `srcDir` is an Astro config key.
    srcDir: resolved.docsSourceDirectory,
    trailingSlash: 'always',
    vite: {
      define: {
        // The site title shows the documented package's version; `SiteTitle.astro` reads it from here.
        'import.meta.env.DOCS_SITE_PACKAGE_VERSION': JSON.stringify(resolved.packageVersion)
      },
      resolve: {
        alias: [
          { find: API_COMPONENTS_IMPORT_PREFIX, replacement: join(assetsDirectory, 'components') }
        ]
      }
    }
  });
}

// `route-data` sits beside this module in every build of it, with the same extension: `.ts` in this repository,
// `.mjs` / `.cjs` once installed.
function getRouteDataModulePath(): string {
  const thisModulePath = toPosixPath(fileURLToPath(import.meta.url));
  return join(thisModulePath, '..', `route-data${extname(thisModulePath)}`);
}

function readApiSidebar(sidebarFile: string): SidebarItems {
  if (!existsSync(sidebarFile)) {
    console.warn(`[astro.config] ${sidebarFile} not found. Generate the API reference first (npm run docs:build).`);
    return [];
  }

  const parsed: unknown = JSON.parse(readFileSync(sidebarFile, 'utf-8'));
  return Array.isArray(parsed) ? parsed as SidebarItems : [];
}
