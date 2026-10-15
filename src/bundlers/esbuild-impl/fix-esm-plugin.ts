/**
 * @file
 *
 * This module defines a custom esbuild plugin that fixes the `require` statement for ESM modules.
 */

/* v8 ignore start -- esbuild plugin that patches require calls for ESM compatibility; requires a live esbuild context. */

import type { Plugin } from 'esbuild';

import { replaceAll } from '@mnaoumov/typescript-lib/string';

/**
 * Creates an esbuild plugin that fixes the `require` statement for ESM modules.
 *
 * @returns An esbuild `Plugin` object that fixes the `require` statement for ESM modules.
 */
export function fixEsmPlugin(): Plugin {
  return {
    name: 'fix-esm',
    setup(build): void {
      build.onEnd((result) => {
        for (const file of result.outputFiles ?? []) {
          const newText = replaceAll({
            $string: file.text,
            // Inline rather than a call to a global helper, so a module works without any banner having run first.
            replacer: '$1(((module) => module && module.__esModule && \'default\' in module ? module.default : module)($2), 1);',
            searchValue: /(?<Caller>__toESM\d*)\((?<Module>.+), 1\);/g
          });
          file.contents = new TextEncoder().encode(newText);
        }
      });
    }
  };
}

/* v8 ignore stop */
