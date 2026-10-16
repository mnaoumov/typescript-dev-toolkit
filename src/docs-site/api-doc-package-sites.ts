/**
 * @file
 *
 * Cross-site links: a type declared in another documented package links to its page on that package's site.
 *
 * A type is recognized by where its declaration lives, not by its name: a declaration under
 * `node_modules/<package>/dist/lib/{esm,cjs}/<path>.d.{mts,cts}` of a package in
 * {@link ApiDocSettings.packageSites} is the page `<site>api/<path>/<Type>/`, built with the generator's own slug
 * rules, because that site was generated from the same tree. A module that generator skips (`@types`, `index`,
 * `*-setup`, ...) has no page, so a type declared there is not linked.
 */

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';

import type { ApiDocSettings } from './api-doc-settings.ts';

import { isDocumentedModulePath } from './api-doc-documented-files.ts';
import { toRouteSegmentPreserveCase } from './api-doc-route-segments.ts';
import { getApiDocSettings } from './api-doc-settings.ts';

const PACKAGE_DECLARATION_REG_EXP = /\/node_modules\/(?<Package>(?:@[^/]+\/)?[^/]+)\/dist\/lib\/(?:cjs|esm)\/(?<Path>.+?)(?:\.d\.[cm]?ts)?$/;

/**
 * The documentation sites of the `@mnaoumov` packages, which each site links to unless told otherwise.
 */
export const DEFAULT_PACKAGE_SITES: ReadonlyMap<string, string> = new Map([
  '@mnaoumov/obsidian-dev-toolkit',
  '@mnaoumov/obsidian-lib',
  '@mnaoumov/typescript-dev-toolkit',
  '@mnaoumov/typescript-lib',
  '@mnaoumov/typescript-test-toolkit'
].map((packageName) => [packageName, `https://mnaoumov.dev/${packageName.slice('@mnaoumov/'.length)}/`]));

interface ModuleState {
  /**
   * Type name to its page URL; `null` when two packages declare the name, which cannot be told apart from text.
   */
  readonly urls: Map<string, null | string>;
}

const moduleState: ModuleState = {
  urls: new Map()
};

interface ToPackageTypeUrlParams {
  readonly declarationFilePath: string;
  readonly name: string;
  readonly settings: ApiDocSettings;
}

/**
 * Forgets every declaration {@link registerPackageDeclaration} recorded.
 */
export function clearPackageDeclarations(): void {
  moduleState.urls.clear();
}

/**
 * Gets the page URL of a type declared in another documented package.
 *
 * @param name - The type's name, as type text prints it.
 * @returns The URL, or `undefined` when no documented package declares exactly one type of that name.
 */
export function getPackageTypeUrl(name: string): string | undefined {
  return moduleState.urls.get(name) ?? undefined;
}

/**
 * Records where a type is declared, so its references link to its page on that package's site.
 *
 * A declaration outside every {@link ApiDocSettings.packageSites} package is ignored. A name two packages declare is
 * remembered as ambiguous and never linked.
 *
 * @param name - The type's name.
 * @param declarationFilePath - The declaration file's path, with or without its `.d.mts` / `.d.cts` extension.
 */
export function registerPackageDeclaration(name: string, declarationFilePath: string): void {
  const url = toPackageTypeUrl({ declarationFilePath, name, settings: getApiDocSettings() });
  if (url === undefined) {
    return;
  }

  const existing = moduleState.urls.get(name);
  if (existing === undefined) {
    moduleState.urls.set(name, url);
  } else if (existing !== url) {
    moduleState.urls.set(name, null);
  }
}

function toPackageTypeUrl(params: ToPackageTypeUrlParams): string | undefined {
  const { declarationFilePath, name, settings } = params;
  const match = PACKAGE_DECLARATION_REG_EXP.exec(declarationFilePath.replaceAll('\\', '/'));
  if (match === null) {
    return undefined;
  }

  const packageName = getMandatoryNamedGroup(match, 'Package');
  const path = getMandatoryNamedGroup(match, 'Path');
  // The owning site's generator skipped that module, so no page exists to link to.
  if (packageName === settings.packageName || !isDocumentedModulePath(path)) {
    return undefined;
  }

  const site = settings.packageSites.get(packageName);
  return site === undefined ? undefined : `${site}api/${path}/${toRouteSegmentPreserveCase(name)}/`;
}
