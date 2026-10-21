/**
 * @file
 *
 * The one description of a documentation site that its Astro config and its build commands share: which repository
 * it documents, where its sources and pages live, and which other sites it links to.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  ApiDocSettings,
  ImportStatementProvider,
  MemberRouteSegmentProvider
} from './api-doc-settings.ts';
import type { RepoHomepageMode } from './repo-homepage.ts';

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
   * Folder names under {@link sourceDirectory} whose subtree the API reference skips, in addition to `@types`,
   * `styles` and `test-helpers`.
   *
   * @default []
   */
  readonly excludedDirectories?: readonly string[];

  /**
   * Type names mapped to the URL their references link to, for types no documented package declares. The layer
   * documenting an ecosystem's packages fills it with that ecosystem's references.
   */
  readonly externalTypeLinks?: ReadonlyMap<string, string>;

  /**
   * Names the API reference never links as types, in addition to the built-in generic parameter names and every
   * type parameter a documented type declares.
   *
   * @default []
   */
  readonly genericTypeParameters?: readonly string[];

  /**
   * The folder under `<docs>/src/content/docs` the guides sidebar group is generated from.
   *
   * @default 'guides'
   */
  readonly guidesDirectory?: string;

  /**
   * Builds each export's import statement, for a package whose exports are not imported from
   * `<package>/<module path>`, e.g. one publishing barrel entry points. Returning `undefined` shows no statement.
   *
   * @default the statement importing the export from `<package>/<module path>`
   */
  readonly importStatement?: ImportStatementProvider;

  /**
   * Builds the case-preserved route segment of a member's page from a property's name or a method's overload key,
   * overriding the generator's own slug where it returns a string.
   *
   * @default the name as a URL segment, its trailing underscores kept
   */
  readonly memberRouteSegment?: MemberRouteSegmentProvider;

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
   * What `buildDocsSite` does, after the build, about the repository's GitHub homepage: compare it with the site's
   * URL and report a mismatch (`check`), or also set it (`set`). It reads and writes through the `gh` CLI, and
   * only ever warns. A workflow's `GITHUB_TOKEN` can read the homepage but not set it, so in CI `set` reports too.
   *
   * @default 'off'
   */
  readonly repoHomepage?: RepoHomepageMode;

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
   * See {@link DocsSiteConfig.owner}.
   */
  readonly owner: string;

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
   * See {@link DocsSiteConfig.repoHomepage}.
   */
  readonly repoHomepage: RepoHomepageMode;

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
    excludedDirectories = [],
    externalTypeLinks = new Map<string, string>(),
    genericTypeParameters = [],
    guidesDirectory = 'guides',
    importStatement,
    memberRouteSegment,
    owner = 'mnaoumov',
    packageSites = DEFAULT_PACKAGE_SITES,
    repo,
    repoHomepage = 'off',
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
      excludedDirectories,
      externalTypeLinks,
      genericTypeParameters,
      importStatement,
      memberRouteSegment,
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
    owner,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    publicDirectory,
    repo,
    repoHomepage,
    rootDirectory,
    siteBaseUrl: `${siteOrigin}/${repo}/`,
    siteOrigin,
    sourceDirectory: join(rootDirectory, sourceDirectory),
    title
  };
}
