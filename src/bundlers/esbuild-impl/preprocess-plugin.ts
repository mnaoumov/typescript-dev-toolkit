/**
 * @file
 *
 * This module defines a custom esbuild plugin that preprocesses JavaScript and TypeScript files for any build target.
 *
 * @remarks
 * We cannot use `.` instead of `(dot)` in the above description because the file itself is preprocessed with the same rule.
 *
 * `initCjs`, `initEsm` and the shims they call are stringified with `String(fn)` and injected into every
 * built bundle as an esbuild banner, so they must be reachable from one another by BARE identifier. An unbundled
 * build (`bundle: false`, one output per source) gets no banner: each emitted module gets a preamble holding only the
 * shims its own code needs, and a module that needs none gets nothing. That is
 * why they all live in this module: esbuild compiles a cross-module call to `(0, import_module.fn)(…)`,
 * which would name a binding the emitted bundle does not have. Same-module references stay bare, and
 * {@link makePreprocessBanner} serializes the shims alongside the `init` function so they are in scope there. A shim
 * that is not serialized silently degrades to whatever the consumer's global scope holds under that name — which
 * is how `__name` used to end up holding `window.name`.
 *
 * A caller that needs more in the banner (the Obsidian plugin builder patches `require`) hands in
 * {@link PreprocessPluginOptions.additionalBannerInitFunctions}. Each one is serialized as its OWN immediately
 * invoked function after the shared scope, so it must be self-contained: it cannot see the shims, and calling one
 * from another module would hit exactly the cross-module trap above.
 */

import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';
import type {
  OutputFile,
  Plugin
} from 'esbuild';
import type { pathToFileURL } from 'node:url';
import type {
  Identifier,
  Node
} from 'typescript';

import {
  FunctionHandlingMode,
  toJson
} from '@mnaoumov/typescript-lib/object-utils';
import {
  makeValidVariableName,
  replaceAll
} from '@mnaoumov/typescript-lib/string';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import {
  createSourceFile,
  forEachChild,
  isBindingElement,
  isCallExpression,
  isClassDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isMethodDeclaration,
  isNamespaceImport,
  isParameter,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isSetAccessorDeclaration,
  isStringLiteral,
  isVariableDeclaration,
  ScriptKind,
  ScriptTarget,
  SyntaxKind
} from 'typescript';

const DISPOSE_SYMBOL_NAMES = new Set(['asyncDispose', 'dispose']);
const INLINE_SOURCE_MAP_PREFIX = '//# sourceMappingURL=data:application/json;base64,';
const JS_OUTPUT_REG_EXP = /\.[cm]?js$/;
// Esbuild's helper behind a lowered `using`, which looks up `Symbol.dispose` by name.
const KNOWN_SYMBOL_HELPER_NAME = '__knownSymbol';
// A relative or absolute path, or a `node:` built-in: anything else names a package.
const NON_BARE_SPECIFIER_REG_EXP = /^(?:\.|\/|node:)/;

enum IdentifierUsage {
  Binding = 'binding',
  Member = 'member',
  Read = 'read'
}

/**
 * Options for {@link makePreprocessBanner}.
 */
export interface MakePreprocessBannerOptions {
  /**
   * Self-contained functions serialized after the shared shims, each invoked once.
   */
  readonly additionalBannerInitFunctions?: readonly (() => void)[];

  /**
   * Whether the build is for an ESM format.
   */
  readonly isEsm?: boolean;
}

/**
 * Options for {@link preprocessPlugin}.
 */
export interface PreprocessPluginOptions {
  /**
   * Self-contained functions serialized into the banner after the shared shims, each invoked once.
   *
   * @remarks
   * Each function is emitted as `(${String(fn)})();`, so it may reference only globals and what it declares itself.
   */
  readonly additionalBannerInitFunctions?: readonly (() => void)[];

  /**
   * The self-contained function whose result replaces `import(dot)meta(dot)url` in a CommonJS build. Serialized into
   * every file that reads it.
   *
   * @default A function returning the file URL of `__filename`, or `location.href` where there is no `__filename`.
   */
  readonly cjsImportMetaUrlProvider?: () => string;

  /**
   * Whether the build is for an ESM format.
   */
  readonly isEsm?: boolean;
}

interface AddModulePreamblesParams {
  readonly additionalBannerInitFunctions: readonly (() => void)[];
  readonly leadingBanner: string;
  readonly outputFiles: readonly OutputFile[];
}

/**
 * A browser-flavored stand-in for Node's `process` global.
 */
interface BrowserProcess extends Partial<NodeJS.Process> {
  /**
   * Marks the process as a browser one. The bundled `debug` package selects its browser entry point on it.
   */
  readonly browser: boolean;
}

/**
 * The slice of the `Symbol` constructor {@link ensureDisposeSymbols} reads and writes, with the two dispose
 * symbols optional because an engine without Explicit Resource Management does not have them.
 */
interface DisposeSymbolHost {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Missing disposal symbols are installed on the host.
  asyncDispose?: symbol;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Missing disposal symbols are installed on the host.
  dispose?: symbol;
  readonly for: (key: string) => symbol;
}

interface EsmModule {
  readonly __esModule: boolean;
  readonly default: unknown;
}

/**
 * The slice of a browser global {@link getCjsImportMetaUrl} reads, optional because a non-browser host has none.
 */
interface InsertPreambleParams {
  readonly code: string;
  readonly leadingBanner: string;
  readonly preamble: string;
}

interface LocationHost {
  readonly location?: PageLocation;
}

interface ModuleShimNeeds {
  readonly isBrowserProcessNeeded: boolean;
  readonly isDisposeSymbolsNeeded: boolean;
  readonly isNameNeeded: boolean;
}

interface PageLocation {
  readonly href: string;
}

interface SourceMapWithMappings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Adding a preamble shifts the source map mappings.
  mappings: string;
}

interface UrlModule {
  readonly pathToFileURL: typeof pathToFileURL;
}

/**
 * Ensures the bundle runs against a `process` global that browser-targeting packages recognize.
 *
 * @remarks
 * Serialized into the emitted banner, so it never runs in the builder process — but it is an ordinary
 * function here, so it is unit-tested directly rather than by evaluating the banner text.
 *
 * Fills in the keys MISSING from a host-provided `process` rather than replacing or skipping it. Obsidian
 * Mobile exposes a partial `process`, and the whole-object guards this replaced (`if (globalThis.process) {
 * return; }` / `globalThisRecord['process'] ??= …`) took that as "already shimmed", so `browser` never
 * landed. The bundled `debug` package then selected its Node entry point, which calls
 * `require('util').deprecate()` at module top level, and on mobile the patched `require` returns `{}` — so
 * the plugin threw before its `onload` ran.
 *
 * A real Node or Electron `process` is left completely untouched. `process.versions.node` is the signal for
 * it, and it is self-contained, so it also holds in the Node CLI bundles this banner is emitted into.
 */
export function ensureBrowserProcess(): void {
  const browserProcess: GenericObject<BrowserProcess> = {
    browser: true,
    cwd() {
      return '/';
    },
    env: {},
    platform: 'android'
  };

  const existingProcess = globalThis.process as Partial<NodeJS.Process> | undefined;

  if (!existingProcess) {
    globalThis.process = browserProcess as NodeJS.Process;
    return;
  }

  if (existingProcess.versions?.node) {
    return;
  }

  const existingProcessRecord = existingProcess as GenericObject;

  for (const [key, value] of Object.entries(browserProcess)) {
    existingProcessRecord[key] ??= value;
  }

  existingProcessRecord['browser'] = true;
}

/**
 * Makes `Symbol.dispose` and `Symbol.asyncDispose` exist, falling back to the registry symbols esbuild's
 * `using` helpers look up.
 *
 * @param symbolConstructor - The `Symbol` constructor to patch. Defaults to the ambient one; the parameter
 * exists so a test can hand in an engine that lacks the well-known symbols.
 *
 * @remarks
 * Serialized into the emitted banner. A disposable declares its method under the LITERAL key
 * `[Symbol.dispose]`, while esbuild lowers every `using` to a lookup through `__knownSymbol('dispose')`,
 * which falls back to `Symbol.for('Symbol.dispose')` when the engine has no well-known symbol. On such an
 * engine the literal key evaluates to `undefined`, the method lands under the string `"undefined"`, and
 * every `using` of it throws `Object not disposable`. Filling the well-known slot with that same registry
 * symbol makes both sides name one key on every engine. A host that already has the symbol is left
 * untouched: `??=` never reaches the assignment, which the host's non-writable property would refuse.
 *
 * The default names `Symbol` bare on purpose: it exists on every engine this runs on, and a bare reference
 * resolves against whatever scope the banner is evaluated in, exactly as the bundle's own
 * `[Symbol.dispose]` keys do.
 */
export function ensureDisposeSymbols(symbolConstructor: DisposeSymbolHost = Symbol): void {
  symbolConstructor.asyncDispose ??= symbolConstructor.for('Symbol.asyncDispose');
  symbolConstructor.dispose ??= symbolConstructor.for('Symbol.dispose');
}

/**
 * Returns its argument unchanged.
 *
 * @param $unknown - The value to return.
 * @returns The value passed in.
 *
 * @remarks
 * Serialized into the emitted banner, where it stands in for esbuild's `__name` helper — which names a
 * function and returns it — for bundles that reference the helper without emitting their own.
 */
export function keepName($unknown: unknown): unknown {
  return $unknown;
}

/**
 * Builds the banner injected at the top of every emitted bundle.
 *
 * `String(fn)` captures only the function's own body, so every shim the `init` function calls has to be
 * serialized next to it and wrapped in one shared scope; otherwise the call it makes resolves against the
 * consumer's global scope at runtime. See this file's `@file` remarks.
 *
 * @param options - The banner options.
 * @returns The banner source to prepend to the emitted bundle.
 */
export function makePreprocessBanner(options: MakePreprocessBannerOptions = {}): string {
  const { additionalBannerInitFunctions = [], isEsm = false } = options;
  const shims = isEsm ? [ensureDisposeSymbols, ensureBrowserProcess] : [ensureDisposeSymbols, ensureBrowserProcess, keepName];
  const init = isEsm ? initEsm : initCjs;
  const additionalInits = additionalBannerInitFunctions.map((function_) => `(${String(function_)})();\n`).join('');
  return `\n(function () {\n${shims.map(String).join('\n\n')}\n\n(${String(init)})();\n})();\n${additionalInits}`;
}

/* v8 ignore start -- The plugin's setup needs a live esbuild context, and the functions in the later ignored ranges are serialized into the emitted banner and so run inside the built bundle, never in this process. The shims above are deliberately NOT ignored: they are ordinary functions here and are unit-tested directly, and neither are the unbundled-build helpers, which the tests drive through a stub build. */

/**
 * Creates an esbuild plugin that preprocesses JavaScript and TypeScript files.
 *
 * This plugin performs the following tasks:
 * - Replaces instances of `import(dot)meta(dot)url` with a CommonJS-compatible `__filename` alternative.
 * - Modifies the `sourceMappingURL` comment so a template literal ending a file does not swallow it.
 * - Adds a basic `process` object to the global scope if `process` is referenced but not defined.
 * - Fills in `Symbol.dispose` / `Symbol.asyncDispose` on engines that lack them, so `using` works there.
 *
 * @param options - The plugin options.
 * @returns An esbuild `Plugin` object that handles the preprocessing.
 */
export function preprocessPlugin(options: PreprocessPluginOptions = {}): Plugin {
  const { additionalBannerInitFunctions = [], cjsImportMetaUrlProvider = getCjsImportMetaUrl, isEsm = false } = options;
  const replacements = isEsm
    ? {}
    : {
      [
        replaceAll({
          $string: 'import(dot)meta(dot)url',
          replacer: '.',
          searchValue: '(dot)'
        })
      ]: cjsImportMetaUrlProvider
    };

  return {
    name: 'preprocess',
    setup(build): void {
      build.initialOptions.define ??= {};

      for (const key of Object.keys(replacements)) {
        build.initialOptions.define[key] = `__${makeValidVariableName(key)}`;
      }

      if (build.initialOptions.bundle === false) {
        // One output per source: each module gets only the shims its own code needs, so a page importing a pure
        // module of a library is left with its globals untouched.
        const leadingBanner = build.initialOptions.banner?.['js'] ?? '';
        build.onEnd((result) => {
          addModulePreambles({ additionalBannerInitFunctions, leadingBanner, outputFiles: result.outputFiles ?? [] });
        });
      } else {
        build.initialOptions.banner ??= {};
        build.initialOptions.banner['js'] ??= '';
        build.initialOptions.banner['js'] += makePreprocessBanner({ additionalBannerInitFunctions, isEsm });
      }

      build.onLoad({ filter: /\.(?:js|ts|cjs|mjs|cts|mts)$/ }, async ($arguments) => {
        let contents = await readFile($arguments.path, 'utf-8');

        for (const [key, value] of Object.entries(replacements)) {
          const variable = `__${makeValidVariableName(key)}`;
          if (!contents.includes(key) || contents.includes(`var ${variable}`)) {
            continue;
          }
          const valueString = typeof value === 'function' ? `(${String(value)})()` : toJson(value, { functionHandlingMode: FunctionHandlingMode.Full });
          contents = `var ${variable} = globalThis['${key}'] ?? ${valueString};\n${contents}`;
        }

        // HACK: The ${''} part is used to ensure Obsidian loads the plugin properly,
        // Otherwise, it stops loading after the first line of the sourceMappingURL comment.

        contents = replaceAll({
          $string: contents,
          // eslint-disable-next-line no-template-curly-in-string -- It is intentional, the string looks like a template literal, but it is not.
          replacer: '`\n//#${\'\'} sourceMappingURL',
          searchValue: /`\r?\n\/\/# sourceMappingURL/g
        });

        return {
          contents,
          loader: 'ts'
        };
      });
    }
  };
}

/* v8 ignore stop */

/**
 * Prepends to each emitted module the preamble its own code needs, and nothing when it needs none.
 *
 * @param params - The emitted modules, the banner the caller already put first, and the caller's extra inits.
 */
function addModulePreambles(params: AddModulePreamblesParams): void {
  const { additionalBannerInitFunctions, leadingBanner, outputFiles } = params;
  for (const outputFile of outputFiles) {
    if (!JS_OUTPUT_REG_EXP.test(outputFile.path)) {
      continue;
    }

    const code = outputFile.text;
    const preamble = makeModulePreamble(getModuleShimNeeds(code), additionalBannerInitFunctions);
    if (preamble === '') {
      continue;
    }

    outputFile.contents = new TextEncoder().encode(insertPreamble({ code, leadingBanner, preamble }));
  }
}

/* v8 ignore start -- Serialized into the emitted module, see above. */
function getCjsImportMetaUrl(): string {
  if (typeof __filename === 'string') {
    const localRequire = require;
    const url = localRequire('node:url') as UrlModule;
    if (typeof url.pathToFileURL === 'function') {
      return url.pathToFileURL(__filename).href;
    }
  }

  // Fallback to the page URL, or an empty string if the environment is unknown.
  return (globalThis as LocationHost).location?.href ?? '';
}
/* v8 ignore stop */

function getIdentifierUsage(node: Identifier): IdentifierUsage {
  const { parent } = node;
  if (
    (isPropertyAccessExpression(parent) || isPropertyAssignment(parent) || isMethodDeclaration(parent) || isPropertyDeclaration(parent)
      || isGetAccessorDeclaration(parent) || isSetAccessorDeclaration(parent))
    && parent.name === node
  ) {
    return IdentifierUsage.Member;
  }

  return (isVariableDeclaration(parent) || isFunctionDeclaration(parent) || isClassDeclaration(parent) || isParameter(parent) || isBindingElement(parent)
      || isImportClause(parent) || isImportSpecifier(parent) || isNamespaceImport(parent))
      && parent.name === node
    ? IdentifierUsage.Binding
    : IdentifierUsage.Read;
}

/**
 * Reads which shims an emitted module needs from its code.
 *
 * - `ensureBrowserProcess`: it reads a `process` it does not bind itself, or it loads a bare package that is not a
 *   `node:` built-in. The second case is there because such a package (`path-browserify` reads `process.cwd()`) cannot
 *   carry a shim of its own, and in an unbundled build its importer is the only module that can.
 * - `ensureDisposeSymbols`: it names `Symbol.dispose` or `Symbol.asyncDispose`, or holds esbuild's `__knownSymbol`
 *   helper, which a lowered `using` emits.
 * - `__name`: it reads a `__name` it does not declare.
 *
 * @param code - The emitted module.
 * @returns What the module needs.
 */
function getModuleShimNeeds(code: string): ModuleShimNeeds {
  const sourceFile = createSourceFile('module.js', code, ScriptTarget.Latest, true, ScriptKind.JS);
  const boundNames = new Set<string>();
  const readNames = new Set<string>();
  let isBareImportFound = false;
  let isDisposeSymbolFound = false;

  function visit(node: Node): void {
    const specifier = getModuleSpecifier(node);
    if (specifier !== undefined && !NON_BARE_SPECIFIER_REG_EXP.test(specifier)) {
      isBareImportFound = true;
    }

    if (
      isPropertyAccessExpression(node) && isIdentifier(node.expression) && node.expression.text === 'Symbol'
      && DISPOSE_SYMBOL_NAMES.has(node.name.text)
    ) {
      isDisposeSymbolFound = true;
    }

    if (isIdentifier(node)) {
      if (node.text === KNOWN_SYMBOL_HELPER_NAME) {
        isDisposeSymbolFound = true;
      }

      const usage = getIdentifierUsage(node);
      if (usage === IdentifierUsage.Binding) {
        boundNames.add(node.text);
      } else if (usage === IdentifierUsage.Read) {
        readNames.add(node.text);
      }
    }

    forEachChild(node, visit);
  }
  visit(sourceFile);

  function isFreeRead(name: string): boolean {
    return readNames.has(name) && !boundNames.has(name);
  }

  return {
    isBrowserProcessNeeded: isFreeRead('process') || isBareImportFound,
    isDisposeSymbolsNeeded: isDisposeSymbolFound,
    isNameNeeded: isFreeRead('__name')
  };
}

function getModuleSpecifier(node: Node): string | undefined {
  if ((isImportDeclaration(node) || isExportDeclaration(node)) && node.moduleSpecifier !== undefined && isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }

  if (isCallExpression(node)) {
    const [firstArgument] = node.arguments;
    const isLoader = node.expression.kind === SyntaxKind.ImportKeyword || (isIdentifier(node.expression) && node.expression.text === 'require');
    if (isLoader && firstArgument !== undefined && isStringLiteral(firstArgument)) {
      return firstArgument.text;
    }
  }

  return undefined;
}

/* v8 ignore start -- Serialized into the emitted banner, see above. */
function initCjs(): void {
  const globalThisRecord = globalThis as GenericObject;
  ensureDisposeSymbols();
  globalThisRecord['__name'] ??= keepName;
  globalThisRecord['__extractDefault'] ??= extractDefault;

  ensureBrowserProcess();

  // eslint-disable-next-line unicorn/consistent-function-scoping -- Serialized with initCjs into the banner; at module scope it would be left out of it.
  function extractDefault($module: Partial<EsmModule> | undefined): unknown {
    return $module && $module.__esModule && 'default' in $module ? $module.default : $module;
  }
}

function initEsm(): void {
  ensureDisposeSymbols();
  ensureBrowserProcess();
}
/* v8 ignore stop */

/**
 * Inserts the preamble after the caller's leading banner, and shifts an inline source map down by the lines it adds,
 * so the module's own lines keep mapping onto their sources.
 *
 * @param params - The module, its leading banner and the preamble.
 * @returns The module with the preamble in it.
 */
function insertPreamble(params: InsertPreambleParams): string {
  const { code, leadingBanner, preamble } = params;
  const insertAt = leadingBanner.endsWith('\n') && code.startsWith(leadingBanner) ? leadingBanner.length : 0;
  const addedLineCount = preamble.split('\n').length - 1;
  let shiftedCode = code;
  const sourceMapStart = code.lastIndexOf(INLINE_SOURCE_MAP_PREFIX);
  if (sourceMapStart !== -1) {
    const dataStart = sourceMapStart + INLINE_SOURCE_MAP_PREFIX.length;
    const data = code.slice(dataStart).trimEnd();
    const sourceMap = JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as SourceMapWithMappings;
    sourceMap.mappings = ';'.repeat(addedLineCount) + sourceMap.mappings;
    shiftedCode = code.slice(0, dataStart) + Buffer.from(JSON.stringify(sourceMap), 'utf-8').toString('base64') + code.slice(dataStart + data.length);
  }
  return shiftedCode.slice(0, insertAt) + preamble + shiftedCode.slice(insertAt);
}

/**
 * Builds the preamble of one unbundled module: the shims it needs in one shared scope, then the caller's extra inits.
 *
 * @param needs - What the module needs.
 * @param additionalBannerInitFunctions - The caller's extra inits, which every module gets.
 * @returns The preamble, empty when the module needs nothing.
 */
function makeModulePreamble(needs: ModuleShimNeeds, additionalBannerInitFunctions: readonly (() => void)[]): string {
  const shims: ((...arguments_: never[]) => unknown)[] = [];
  const calls: string[] = [];

  if (needs.isDisposeSymbolsNeeded) {
    shims.push(ensureDisposeSymbols);
    calls.push('ensureDisposeSymbols();');
  }

  if (needs.isBrowserProcessNeeded) {
    shims.push(ensureBrowserProcess);
    calls.push('ensureBrowserProcess();');
  }

  if (needs.isNameNeeded) {
    shims.push(keepName);
    calls.push('globalThis[\'__name\'] ??= keepName;');
  }

  const sharedScope = shims.length === 0 ? '' : `(function () {\n${shims.map(String).join('\n\n')}\n\n${calls.join('\n')}\n})();\n`;
  return sharedScope + additionalBannerInitFunctions.map((function_) => `(${String(function_)})();\n`).join('');
}
