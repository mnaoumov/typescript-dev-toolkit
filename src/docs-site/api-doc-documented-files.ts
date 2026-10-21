/**
 * @file
 *
 * Which source files the API reference documents, shared by the source walk and by the cross-site linker, so a
 * link to another package's site never names a page that site's generator skipped.
 */

/**
 * Directory names whose entire subtree is excluded from documentation.
 */
const EXCLUDED_DIR_SEGMENTS = new Set(['@types', 'styles', 'test-helpers']);

/**
 * File names that are never documented, whatever folder they sit in.
 */
const EXCLUDED_FILE_NAMES = new Set(['__merged.ts', 'index.ts', 'setup.ts']);

/**
 * Checks whether a directory's subtree is documented.
 *
 * @param name - The directory's name.
 * @param excludedDirectories - Directory names excluded in addition to the defaults.
 * @returns `false` for a `@types`, `styles` or `test-helpers` directory, or one of `excludedDirectories`.
 */
export function isDocumentedDirectoryName(name: string, excludedDirectories: readonly string[] = []): boolean {
  return !EXCLUDED_DIR_SEGMENTS.has(name) && !excludedDirectories.includes(name);
}

/**
 * Checks whether a source file is documented, judged by its name alone.
 *
 * Excludes: `*.test.ts` (incl. `*.browser.test.ts` / `*.integration.test.ts`), `*.d.ts`, `index.ts`, `__merged.ts`,
 * `setup.ts` and `*-setup.ts`.
 *
 * @param name - The file's name.
 * @returns Whether the file is documented.
 */
export function isDocumentedFileName(name: string): boolean {
  // The `.test.ts` clause covers *.test.ts, *.browser.test.ts, *.integration.test.ts
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !EXCLUDED_FILE_NAMES.has(name) && !name.endsWith('-setup.ts')
    && !name.endsWith('.test.ts');
}

/**
 * Checks whether a module, given by its path relative to the source folder, has documentation pages.
 *
 * @param modulePath - The POSIX path relative to the source folder, without its extension (`linters/eslint`).
 * @returns Whether the generator documents that module.
 */
export function isDocumentedModulePath(modulePath: string): boolean {
  const segments = modulePath.split('/');
  const directoryNames = segments.slice(0, -1);
  const fileName = `${segments.slice(-1).join('')}.ts`;
  return directoryNames.every((directoryName) => isDocumentedDirectoryName(directoryName)) && isDocumentedFileName(fileName);
}
