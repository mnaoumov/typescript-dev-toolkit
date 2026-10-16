/**
 * @file
 *
 * Locates the files every documentation site shares — the API page components, the site title, the stylesheet and
 * the Open Graph fonts — which this package ships under `assets/docs-site` rather than compiling.
 */

import { existsSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_RELATIVE_PATH = join('assets', 'docs-site');

/**
 * The specifier generated API pages import their components through. {@link getDocsSiteAssetsDirectory}'s `components`
 * folder is aliased to it, so every site renders its API pages with the same components.
 */
export const API_COMPONENTS_IMPORT_PREFIX = '@mnaoumov/typescript-dev-toolkit/docs-site-components';

/**
 * Gets the folder holding the shared site files.
 *
 * The module runs from `src/docs-site` in this repository and from `dist/lib/<format>/docs-site` once installed, so
 * the folder is found by walking up to the package root that holds it rather than by a fixed relative path.
 *
 * @param moduleUrl - The URL of a module of this package to start from.
 * @returns The folder's absolute path.
 * @throws If no folder above the module holds the assets.
 */
export function getDocsSiteAssetsDirectory(moduleUrl: string = import.meta.url): string {
  let directory = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const candidate = join(directory, ASSETS_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No ${ASSETS_RELATIVE_PATH} folder above ${fileURLToPath(moduleUrl)}.`);
    }

    directory = parent;
  }
}
