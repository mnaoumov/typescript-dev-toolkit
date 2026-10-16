/**
 * @file
 *
 * Locates the shared tool configuration files this package ships under `assets/`.
 */

import { existsSync } from 'node:fs';
import {
  dirname,
  join
} from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A shared configuration file this package ships under `assets/`.
 */
export enum SharedConfigFile {
  /**
   * The shared Biome configuration. A project's own `biome.json` extends it.
   */
  Biome = 'biome.json',

  /**
   * The shared Prettier configuration.
   */
  Prettier = 'prettier.json'
}

const ASSETS_FOLDER = 'assets';

/**
 * Finds a shared configuration file. It walks up from the module, because it runs from `src` here and from
 * `dist/lib/<format>` once installed.
 *
 * @param file - The {@link SharedConfigFile} to find.
 * @param moduleUrl - The URL of a module of this package to start from.
 * @returns The file's absolute path.
 * @throws If no folder above the module holds the file.
 */
export function getSharedConfigFilePath(file: SharedConfigFile, moduleUrl: string = import.meta.url): string {
  let directory = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const candidate = join(directory, ASSETS_FOLDER, file);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No ${ASSETS_FOLDER}/${file} above ${fileURLToPath(moduleUrl)}.`);
    }

    directory = parent;
  }
}
