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
   * The root API page's intro, as Markdown, in place of the generated one; stripped of its Markdown, it is also the
   * page's `description`. For a package whose arrangement the generated intro cannot explain.
   */
  readonly apiIndexIntro?: string | undefined;

  /**
   * The site's base path, with a leading slash and no trailing one, e.g. `/typescript-lib`. Every in-content link
   * the generator emits starts with it.
   */
  readonly basePath: string;

  /**
   * Folder names whose subtree is not documented, in addition to `@types`, `styles` and `test-helpers`. Applies
   * to this site's source walk only: a link into another package's site assumes that site's generator skipped the
   * default folders alone.
   */
  readonly excludedDirectories?: readonly string[] | undefined;

  /**
   * Type names mapped to the URL their references link to, for types neither this package nor a {@link packageSites}
   * package declares, e.g. an ecosystem's own API reference. Consulted before the generic TypeScript, JavaScript and
   * Web API links, so an entry here wins over them.
   */
  readonly externalTypeLinks: ReadonlyMap<string, string>;

  /**
   * Names that are never linked as types, in addition to the built-in generic parameter names and every type
   * parameter a documented type declares: type parameters the scan does not find.
   */
  readonly genericTypeParameters?: readonly string[] | undefined;

  /**
   * Builds each export's import statement, for a package whose exports are not imported from
   * `<packageName>/<namespace>`, e.g. one publishing barrel entry points. Returning `undefined` shows no statement.
   * Unset, every statement is the {@link ImportStatementContext.defaultImportStatement}.
   */
  readonly importStatement?: ImportStatementProvider | undefined;

  /**
   * Builds the case-preserved route segment of a member's page, overriding the generator's slug where it returns a
   * string. The file is written under the segment lowercased. The generator's own slug already keeps a name's
   * trailing underscores, so `create__` and `create` never share a page.
   */
  readonly memberRouteSegment?: MemberRouteSegmentProvider | undefined;

  /**
   * The folder the generated API pages are written to, normally `<docs>/src/content/docs/api`.
   */
  readonly outputDirectory: string;

  /**
   * The documented package's name, e.g. `@mnaoumov/typescript-lib`. Import statements are built from it, unless
   * {@link importStatement} builds them.
   */
  readonly packageName: string;

  /**
   * Package names mapped to the root URL of their documentation site, with a trailing slash. A type whose
   * declaration resolves into one of these packages links to its page on that site.
   */
  readonly packageSites: ReadonlyMap<string, string>;

  /**
   * The absolute path of the package's one public entry point, for a package that publishes its API from a barrel
   * rather than one import subpath per module. Set, the reference documents only the exports that barrel re-exports,
   * found by following its `export ... from` statements rather than by walking the source folder, and every import
   * statement imports from the package root. A namespace still groups the reference by source module.
   */
  readonly publicApiEntry?: string | undefined;

  /**
   * The JSON file the generated Starlight sidebar is written to.
   */
  readonly sidebarFile: string;
}

/**
 * What {@link ApiDocSettings.importStatement} is told about the export whose import statement it builds.
 */
export interface ImportStatementContext {
  /**
   * The statement the generator writes when no hook is set, e.g.
   * `import type { Alpha } from '@mnaoumov/typescript-lib/alpha';`.
   */
  readonly defaultImportStatement: string;

  /**
   * Whether the export is a type only (an interface, a type alias or an enum), imported with `import type`.
   */
  readonly isTypeOnly: boolean;

  /**
   * The export's kind, e.g. `class`, `function`, `interface`.
   */
  readonly kind: string;

  /**
   * The export's name.
   */
  readonly name: string;

  /**
   * The export's namespace: its source path relative to the source folder, without its extension.
   */
  readonly namespace: string;
}

/**
 * Builds the import statement of a documented export.
 *
 * @param context - The export.
 * @returns The statement, or `undefined` to show none.
 */
export type ImportStatementProvider = (context: ImportStatementContext) => string | undefined;

/**
 * Builds the case-preserved route segment of a member's page.
 *
 * @param name - A property's name, or a method's overload key: its name, or `on('changed')` for an event method
 * keyed by its first argument.
 * @returns The segment, or `undefined` for the generator's own.
 */
export type MemberRouteSegmentProvider = (name: string) => string | undefined;

interface ModuleState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Configuration replaces the active settings between builds.
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
