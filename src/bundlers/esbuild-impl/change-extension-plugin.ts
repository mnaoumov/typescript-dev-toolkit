/**
 * @file
 *
 * This module defines an esbuild plugin that changes the extension of JavaScript files after the build process.
 */

import type { Plugin } from 'esbuild';

import { replaceAll } from '@mnaoumov/typescript-lib/string';
import { writeFile } from 'node:fs/promises';

import { RepoPaths } from '../../repo-paths.ts';

/* v8 ignore start -- esbuild plugin that rewrites file extensions at build time; requires a live esbuild context. */

/**
 * Creates an esbuild plugin that changes the extension of JavaScript files after the build process.
 *
 * @param extension - The extension to change the files to.
 * @returns An esbuild `Plugin` object that handles the renaming and modification of output files.
 */
export function changeExtensionPlugin(extension: string): Plugin {
  return {
    name: 'change-extension',
    setup(build): void {
      build.onEnd(async (result) => {
        for (const file of result.outputFiles ?? []) {
          if (!file.path.endsWith(RepoPaths.JsExtension) || file.path.endsWith(RepoPaths.DjsExtension)) {
            continue;
          }

          const newPath = replaceAll({
            $string: file.path,
            replacer: extension,
            searchValue: /\.js$/g
          });

          const newText = rewriteImportPathExtensions(file.text, extension);

          await writeFile(newPath, newText);
        }
      });
    }
  };
}

/* v8 ignore stop */

/**
 * Rewrites the extension of every import-like path in an emitted module's text from `.ts` to the target
 * output extension (`.mjs` / `.cjs`), so the multi-file `dist/lib` build references its real siblings.
 *
 * Covers `require('…')`, static `from "…"`, and dynamic `import("…")` occurrences.
 *
 * The scan is textual, so it also meets such spellings inside string literals and comments. It therefore changes
 * nothing but the `.ts` extension itself: a path that does not end in `.ts` is left as written, and the quote
 * character is never changed. An earlier version re-quoted every match, so an `import('x')` written inside a
 * double-quoted string ended that string and the emitted module no longer parsed.
 *
 * @param text - The emitted module text to rewrite.
 * @param extension - The output extension to rewrite `.ts` paths to (e.g. `.mjs` or `.cjs`).
 * @returns The rewritten module text.
 */
export function rewriteImportPathExtensions(text: string, extension: string): string {
  let newText = text;

  for (const searchValue of IMPORT_PATH_REG_EXPS) {
    // Every group of each expression always participates in a match, so the tuple holds four strings.
    newText = replaceAll<[prefix: string, quote: string, importPath: string, suffix: string]>({
      $string: newText,
      replacer: ({ capturedGroupArguments: [prefix, , importPath, suffix] }) => `${prefix}${importPath.slice(0, -TS_EXTENSION.length)}${extension}${suffix}`,
      searchValue
    });
  }

  return newText;
}

const TS_EXTENSION = '.ts';

/**
 * The import-like spellings whose `.ts` path is rewritten. Each captures the text before the path (the call or
 * keyword and the opening quote), the path, which ends in `.ts` and holds no quote or line break, and the text after
 * it (the same quote, and the closing parenthesis for a call).
 */
const IMPORT_PATH_REG_EXPS: readonly RegExp[] = [
  /(?<Prefix>require\((?<Quote>["']))(?<ImportPath>[^"'\r\n]+?\.ts)(?<Suffix>\k<Quote>\))/g,
  /(?<Prefix>from (?<Quote>["']))(?<ImportPath>[^"'\r\n]+?\.ts)(?<Suffix>\k<Quote>)/g,
  /(?<Prefix>import\((?<Quote>["']))(?<ImportPath>[^"'\r\n]+?\.ts)(?<Suffix>\k<Quote>\))/g
];
