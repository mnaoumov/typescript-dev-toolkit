/**
 * @file
 *
 * Svelte preprocessor that compiles TypeScript scripts with esbuild.
 *
 * It replaces `svelte-preprocess` for the one language every Svelte component of these projects uses, `lang="ts"`, so
 * the toolkit no longer depends on `svelte-preprocess`, whose optional `@babel/core` 7 peer conflicts with the Babel 8
 * that Stryker installs. Any other script or style language is handed to `svelte-preprocess`, an optional peer, when the
 * project installs it.
 */

import { transform } from 'esbuild';

/**
 * The attributes of a `<script>` or `<style>` block.
 */
export type SvelteBlockAttributes = Record<string, boolean | string>;

/**
 * A Svelte preprocessor for one kind of block.
 */
export type SvelteBlockPreprocessor = (params: SveltePreprocessorParams) => Promise<SveltePreprocessorResult | undefined>;

/**
 * A Svelte preprocessor group, in the shape `svelte/compiler`'s `preprocess` takes.
 */
export interface SveltePreprocessorGroup {
  /**
   * The name of the group.
   */
  readonly name: string;

  /**
   * The preprocessor of `<script>` blocks.
   */
  readonly script: SvelteBlockPreprocessor;

  /**
   * The preprocessor of `<style>` blocks.
   */
  readonly style: SvelteBlockPreprocessor;
}

/**
 * What a Svelte preprocessor is given for one `<script>` or `<style>` block.
 */
export interface SveltePreprocessorParams {
  /**
   * The attributes of the block.
   */
  readonly attributes: SvelteBlockAttributes;

  /**
   * The content of the block.
   */
  readonly content: string;

  /**
   * The path of the component.
   */
  readonly filename?: string;

  /**
   * The whole component.
   */
  readonly markup: string;
}

/**
 * What a Svelte preprocessor returns for a block it changed.
 */
export interface SveltePreprocessorResult {
  /**
   * The new content of the block.
   */
  readonly code: string;

  /**
   * The source map of the change.
   */
  readonly map?: object | string;
}

type BlockKind = 'script' | 'style';

type FallbackPreprocessorGroup = Partial<Record<BlockKind, (params: SveltePreprocessorParams) => unknown>>;

interface SveltePreprocessModule {
  readonly sveltePreprocess: () => FallbackPreprocessorGroup;
}

const SVELTE_PREPROCESS_PACKAGE_NAME = 'svelte-preprocess';

const JAVASCRIPT_LANGUAGES = new Set(['javascript', 'js']);
const MISSING_SVELTE_PREPROCESS_MESSAGE_REG_EXP = /Cannot find (?:module|package) 'svelte-preprocess'/;
const MODULE_NOT_FOUND_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);
const TEXT_TYPE_PREFIX = 'text/';
const TYPESCRIPT_LANGUAGES = new Set(['ts', 'typescript']);

/**
 * Creates the Svelte preprocessor the toolkit's esbuild build uses.
 *
 * A `<script lang="ts">` block is transpiled with esbuild under `verbatimModuleSyntax`, as Svelte's own `vitePreprocess`
 * does, so an import that only the markup uses is kept and a type import must say `import type`. A plain script or
 * style block is left alone. Any other language is handed to `svelte-preprocess`, loaded only then; when the project
 * does not install it, preprocessing that block fails naming the package.
 *
 * @returns The preprocessor group.
 */
export function createSveltePreprocessor(): SveltePreprocessorGroup {
  let fallbackPromise: Promise<FallbackPreprocessorGroup> | undefined;

  // A failed load is forgotten, so a block after the project installs the package tries again.
  async function getFallbackPreprocessorGroup(): Promise<FallbackPreprocessorGroup> {
    fallbackPromise ??= loadFallbackPreprocessorGroup().catch((error: unknown) => {
      fallbackPromise = undefined;
      throw error;
    });
    return await fallbackPromise;
  }

  async function preprocessWithFallback(kind: BlockKind, language: string, params: SveltePreprocessorParams): Promise<SveltePreprocessorResult | undefined> {
    let fallback: FallbackPreprocessorGroup;
    try {
      fallback = await getFallbackPreprocessorGroup();
    } catch (error) {
      if (!isMissingSveltePreprocessError(error)) {
        throw error;
      }
      throw new Error(
        `Cannot preprocess the <${kind} lang="${language}"> block of ${params.filename ?? 'a Svelte component'}: install \`svelte-preprocess\` in the project to compile ${language}.`,
        { cause: error }
      );
    }
    return await fallback[kind]?.(params) as SveltePreprocessorResult | undefined ?? undefined;
  }

  return {
    name: 'typescript-dev-toolkit-svelte',
    async script(params): Promise<SveltePreprocessorResult | undefined> {
      const language = getBlockLanguage(params.attributes);
      if (language === undefined || JAVASCRIPT_LANGUAGES.has(language)) {
        return undefined;
      }
      return TYPESCRIPT_LANGUAGES.has(language) ? (await transpileTypeScript(params)) : (await preprocessWithFallback('script', language, params));
    },
    async style(params): Promise<SveltePreprocessorResult | undefined> {
      const language = getBlockLanguage(params.attributes);
      return language === undefined || language === 'css' ? undefined : (await preprocessWithFallback('style', language, params));
    }
  };
}

/**
 * Gets the language of a `<script>` or `<style>` block from its `lang` attribute, or else its `type` attribute.
 *
 * @param attributes - The attributes of the block.
 * @returns The language, lowercased, or `undefined` when the block names none.
 */
export function getBlockLanguage(attributes: SvelteBlockAttributes): string | undefined {
  const lang = attributes['lang'];
  if (typeof lang === 'string' && lang !== '') {
    return lang.toLowerCase();
  }

  const type = attributes['type'];
  return typeof type === 'string' && type.toLowerCase().startsWith(TEXT_TYPE_PREFIX) ? type.slice(TEXT_TYPE_PREFIX.length).toLowerCase() : undefined;
}

/**
 * Checks whether an error is the one loading `svelte-preprocess` throws when the project does not install it.
 *
 * @param error - The error to check.
 * @returns Whether the error says that the `svelte-preprocess` package cannot be found.
 */
export function isMissingSveltePreprocessError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Partial<Record<'code', unknown>>).code;
  return typeof code === 'string' && MODULE_NOT_FOUND_CODES.has(code) && MISSING_SVELTE_PREPROCESS_MESSAGE_REG_EXP.test(error.message);
}

async function loadFallbackPreprocessorGroup(): Promise<FallbackPreprocessorGroup> {
  /*
   * The specifier is a variable so that type-checking does not need the package: installing it here would bring back the
   * `@babel/core` peer conflict with Stryker this module exists to avoid.
   */
  const svelteFallbackModule = await import(SVELTE_PREPROCESS_PACKAGE_NAME) as SveltePreprocessModule;
  return svelteFallbackModule.sveltePreprocess();
}

async function transpileTypeScript(params: SveltePreprocessorParams): Promise<SveltePreprocessorResult> {
  const result = await transform(params.content, {
    loader: 'ts',
    sourcefile: params.filename ?? '',
    sourcemap: 'external',
    target: 'esnext',
    tsconfigRaw: {
      compilerOptions: {
        verbatimModuleSyntax: true
      }
    }
  });
  return {
    code: result.code,
    map: result.map
  };
}
