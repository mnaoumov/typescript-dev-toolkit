/**
 * @file
 *
 * Shared jest configuration for TypeScript packages: {@link defineJestConfig}, which fills in the ts-jest transform,
 * the ESM settings, the test excludes and the coverage block a project otherwise writes by hand.
 *
 * The coverage block is the one the vitest library configuration uses, so a package reports the same files whichever
 * runner it picks.
 */

import type { Config } from 'jest';
import type { TsJestTransformerOptions } from 'ts-jest';

import { existsSync } from 'node:fs';

import { readPackageJsonSync } from '../npm.ts';
import { RepoPaths } from '../repo-paths.ts';
import { resolvePathFromRootSafe } from '../root.ts';
import { LIBRARY_VITEST_COVERAGE } from './vitest-config.ts';

/**
 * The files ts-jest compiles: `.ts`, `.tsx`, `.mts` and `.cts`.
 */
export const JEST_TYPESCRIPT_TRANSFORM_PATTERN = String.raw`^.+\.[cm]?tsx?$`;

/**
 * Maps a relative import written with a `.js` extension onto the path without an extension, which jest resolves.
 *
 * A project compiled with `module: nodenext` writes `./foo.js` for `./foo.ts`, and so does TypeScript itself when
 * `rewriteRelativeImportExtensions` turns a `./foo.ts` import into `./foo.js`. Jest looks for a file literally named
 * `foo.js` and fails with `Cannot find module './foo.js'`, so the extension is removed and jest's own
 * `moduleFileExtensions` search finds `foo.ts`.
 */
export const JEST_RELATIVE_JS_IMPORT_MAPPER: Readonly<Record<string, string>> = {
  '^(\\.{1,2}/.*)\\.js$': '$1'
};

/**
 * Folders jest never collects tests from.
 */
export const DEFAULT_JEST_TEST_PATH_IGNORE_PATTERNS: readonly string[] = ['/node_modules/', '/dist/'];

/**
 * Options for {@link defineJestConfig}: any jest option, which wins over the default the function would otherwise
 * set, plus the two below.
 */
export interface DefineJestConfigOptions extends Config {
  /**
   * Whether jest loads the project as ES modules.
   *
   * ESM needs `extensionsToTreatAsEsm`, ts-jest's `useESM`, and Node's `--experimental-vm-modules`, which the jest
   * runner in this package adds by the same rule.
   *
   * @default `true` when `package.json` declares `"type": "module"`
   */
  readonly esm?: boolean;

  /**
   * Options for the ts-jest transform, spread over the defaults: `useESM` from {@link esm}, and a `tsconfig` of
   * `{ isolatedModules: true }`, so each file is transpiled on its own, without a type check, as vitest does. A
   * `tsconfig` given here replaces that default rather than merging with it.
   *
   * Ignored when {@link Config.transform} is given.
   */
  readonly tsJestOptions?: TsJestTransformerOptions;
}

/**
 * Defines a TypeScript project's jest configuration.
 *
 * The defaults: the tests are `src/**\/*.test.ts`, run in the `node` environment, transformed by ts-jest, as ESM when
 * the package is (see {@link DefineJestConfigOptions.esm}); a `.js` relative import resolves onto its `.ts` source;
 * coverage is v8 over `src/`, without the barrels, the declarations, the tests and the test helpers, reported as
 * `text`, `lcov` and `html` into `coverage/`. Every jest option in `options` replaces its default, except
 * `moduleNameMapper`, whose entries are added to the `.js` mapper.
 *
 * @param options - The configuration options.
 * @returns The jest configuration.
 */
export function defineJestConfig(options: DefineJestConfigOptions = {}): Config {
  const { esm = isEsmPackage(), moduleNameMapper, tsJestOptions, ...overrides } = options;

  return {
    collectCoverageFrom: [
      ...LIBRARY_VITEST_COVERAGE.include,
      ...LIBRARY_VITEST_COVERAGE.exclude.map((pattern) => `!${pattern}`)
    ],
    coverageDirectory: LIBRARY_VITEST_COVERAGE.reportsDirectory,
    coverageProvider: LIBRARY_VITEST_COVERAGE.provider,
    coverageReporters: ['text', 'lcov', 'html'],
    extensionsToTreatAsEsm: esm ? ['.ts', '.tsx'] : [],
    moduleNameMapper: {
      ...JEST_RELATIVE_JS_IMPORT_MAPPER,
      ...moduleNameMapper
    },
    roots: ['<rootDir>/src'],
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    testPathIgnorePatterns: [...DEFAULT_JEST_TEST_PATH_IGNORE_PATTERNS],
    transform: {
      [JEST_TYPESCRIPT_TRANSFORM_PATTERN]: [
        'ts-jest',
        {
          tsconfig: { isolatedModules: true },
          useESM: esm,
          ...tsJestOptions
        }
      ]
    },
    ...overrides
  };
}

/**
 * Says whether the project at the root is an ES module package.
 *
 * @returns Whether its `package.json` declares `"type": "module"`. A project without a `package.json` is not.
 */
export function isEsmPackage(): boolean {
  return existsSync(resolvePathFromRootSafe({ path: RepoPaths.PackageJson })) && readPackageJsonSync().type === 'module';
}
