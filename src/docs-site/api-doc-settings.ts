/**
 * @file
 *
 * The per-site settings of the API documentation generator: where it writes, which package it documents, the base
 * path its links carry, and the external links a site adds to the generic ones.
 */

/**
 * The settings the API documentation generator reads while it renders pages and links.
 */
export interface ApiDocSettings {
  /**
   * The site's base path, with a leading slash and no trailing one, e.g. `/typescript-lib`. Every in-content link
   * the generator emits starts with it.
   */
  readonly basePath: string;

  /**
   * Type names mapped to the URL their references link to, for types neither this package nor a {@link packageSites}
   * package declares, e.g. an ecosystem's own API reference. Consulted before the generic TypeScript, JavaScript and
   * Web API links, so an entry here wins over them.
   */
  readonly externalTypeLinks: ReadonlyMap<string, string>;

  /**
   * The folder the generated API pages are written to, normally `<docs>/src/content/docs/api`.
   */
  readonly outputDirectory: string;

  /**
   * The documented package's name, e.g. `@mnaoumov/typescript-lib`. Import statements are built from it.
   */
  readonly packageName: string;

  /**
   * Package names mapped to the root URL of their documentation site, with a trailing slash. A type whose
   * declaration resolves into one of these packages links to its page on that site.
   */
  readonly packageSites: ReadonlyMap<string, string>;

  /**
   * The JSON file the generated Starlight sidebar is written to.
   */
  readonly sidebarFile: string;
}

interface ModuleState {
  settings: ApiDocSettings | undefined;
}

const moduleState: ModuleState = {
  settings: undefined
};

/**
 * Sets the settings every later page and link reads.
 *
 * @param settings - The settings.
 */
export function configureApiDocs(settings: ApiDocSettings): void {
  moduleState.settings = settings;
}

/**
 * Gets the settings set by {@link configureApiDocs}.
 *
 * @returns The settings.
 * @throws If {@link configureApiDocs} has not been called.
 */
export function getApiDocSettings(): ApiDocSettings {
  if (moduleState.settings === undefined) {
    throw new Error('The API documentation generator is not configured: call configureApiDocs() first.');
  }

  return moduleState.settings;
}
