/**
 * @file
 *
 * The one description of a documentation site that its Astro config and its build commands share: which repository
 * it documents, where its sources and pages live, and which other sites it links to.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApiDocSettings } from './api-doc-settings.ts';

import { DEFAULT_PACKAGE_SITES } from './api-doc-package-sites.ts';

/**
 * Describes a documentation site. Every path is relative to {@link DocsSiteConfig.rootDirectory}.
 */
export interface DocsSiteConfig {
  /**
   * The folder holding the site: its `src` (pages, `content.config.ts`), `public` and build output `dist`.
   *
   * @default 'docs'
   */
  readonly docsDirectory?: string;

  /**
   * Type names mapped to the URL their references link to, for types no documented package declares. The layer
   * documenting an ecosystem's packages fills it with that ecosystem's references.
   */
  readonly externalTypeLinks?: ReadonlyMap<string, string>;

  /**
   * The folder under `<docs>/src/content/docs` the guides sidebar group is generated from.
   *
   * @default 'guides'
   */
  readonly guidesDirectory?: string;

  /**
   * The GitHub account the repository belongs to.
   *
   * @default 'mnaoumov'
   */
  readonly owner?: string;

  /**
   * Package names mapped to the root URL of their documentation site, with a trailing slash. A type declared in one
   * of them links to its page there. The documented package itself is never linked this way.
   *
   * @default DEFAULT_PACKAGE_SITES
   */
  readonly packageSites?: ReadonlyMap<string, string>;

  /**
   * The repository's name. The site is served under it: `<siteOrigin>/<repo>/`.
   */
  readonly repo: string;

  /**
   * The repository root, holding `package.json`, `tsconfig.json` and `node_modules`.
   *
   * @default process.cwd()
   */
  readonly rootDirectory?: string;

  /**
   * The origin every site of the account is served from.
   *
   * @default 'https://mnaoumov.dev'
   */
  readonly siteOrigin?: string;

  /**
   * The folder whose modules the API reference documents.
   *
   * @default 'src'
   */
  readonly sourceDirectory?: string;

  /**
   * The site's title, shown in its header.
   */
  readonly title: string;
}

/**
 * {@link DocsSiteConfig} with every default applied, every path absolute, and the values derived from them.
 */
export interface ResolvedDocsSiteConfig {
  /**
   * The API documentation generator's settings for the site.
   */
  readonly apiDocSettings: ApiDocSettings;

  /**
   * The base path, e.g. `/typescript-lib`.
   */
  readonly basePath: string;

  /**
   * The documentation content root, `<docs>/src/content/docs`.
   */
  readonly contentDocsDirectory: string;

  /**
   * The build output folder, `<docs>/dist`.
   */
  readonly distDirectory: string;

  /**
   * The site folder.
   */
  readonly docsDirectory: string;

  /**
   * The site's source folder, `<docs>/src`.
   */
  readonly docsSourceDirectory: string;

  /**
   * The URL a page's edit link starts with: the repository's `edit/main/` tree.
   */
  readonly editLinkBaseUrl: string;

  /**
   * The site's SVG logo, `<docs>/public/favicon.svg`.
   */
  readonly faviconPath: string;

  /**
   * The repository's GitHub URL.
   */
  readonly githubUrl: string;

  /**
   * See {@link DocsSiteConfig.guidesDirectory}.
   */
  readonly guidesDirectory: string;

  /**
   * The folder the Open Graph cards are written to, `<docs>/public/og`.
   */
  readonly ogOutputDirectory: string;

  /**
   * The documented package's name, read from the root `package.json`.
   */
  readonly packageName: string;

  /**
   * The documented package's version, read from the root `package.json`.
   */
  readonly packageVersion: string;

  /**
   * The site's static folder, `<docs>/public`.
   */
  readonly publicDirectory: string;

  /**
   * See {@link DocsSiteConfig.repo}.
   */
  readonly repo: string;

  /**
   * See {@link DocsSiteConfig.rootDirectory}.
   */
  readonly rootDirectory: string;

  /**
   * The absolute URL the site is served from, with a trailing slash.
   */
  readonly siteBaseUrl: string;

  /**
   * See {@link DocsSiteConfig.siteOrigin}.
   */
  readonly siteOrigin: string;

  /**
   * See {@link DocsSiteConfig.sourceDirectory}.
   */
  readonly sourceDirectory: string;

  /**
   * See {@link DocsSiteConfig.title}.
   */
  readonly title: string;
}

interface PackageJsonFields {
  readonly name?: string;
  readonly version?: string;
}

/**
 * Applies the defaults to a site's options and derives every path and URL from them.
 *
 * @param config - The site's configuration.
 * @returns The resolved configuration.
 * @throws If the root `package.json` has no `name` or `version`.
 */
export function resolveDocsSiteConfig(config: DocsSiteConfig): ResolvedDocsSiteConfig {
  const {
    docsDirectory = 'docs',
    externalTypeLinks = new Map<string, string>(),
    guidesDirectory = 'guides',
    owner = 'mnaoumov',
    packageSites = DEFAULT_PACKAGE_SITES,
    repo,
    rootDirectory = process.cwd(),
    siteOrigin = 'https://mnaoumov.dev',
    sourceDirectory = 'src',
    title
  } = config;

  const packageJson = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf-8')) as PackageJsonFields;
  if (packageJson.name === undefined || packageJson.version === undefined) {
    throw new Error(`${join(rootDirectory, 'package.json')} has no name or no version.`);
  }

  const absoluteDocsDirectory = join(rootDirectory, docsDirectory);
  const docsSourceDirectory = join(absoluteDocsDirectory, 'src');
  const contentDocsDirectory = join(docsSourceDirectory, 'content', 'docs');
  const publicDirectory = join(absoluteDocsDirectory, 'public');
  const githubUrl = `https://github.com/${owner}/${repo}`;

  const basePath = `/${repo}`;
  return {
    apiDocSettings: {
      basePath,
      externalTypeLinks,
      outputDirectory: join(contentDocsDirectory, 'api'),
      packageName: packageJson.name,
      packageSites,
      sidebarFile: join(docsSourceDirectory, 'generated-sidebar.json')
    },
    basePath,
    contentDocsDirectory,
    distDirectory: join(absoluteDocsDirectory, 'dist'),
    docsDirectory: absoluteDocsDirectory,
    docsSourceDirectory,
    editLinkBaseUrl: `${githubUrl}/edit/main/`,
    faviconPath: join(publicDirectory, 'favicon.svg'),
    githubUrl,
    guidesDirectory,
    ogOutputDirectory: join(publicDirectory, 'og'),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    publicDirectory,
    repo,
    rootDirectory,
    siteBaseUrl: `${siteOrigin}/${repo}/`,
    siteOrigin,
    sourceDirectory: join(rootDirectory, sourceDirectory),
    title
  };
}
