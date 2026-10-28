/**
 * @file
 *
 * Svelte wrapper esbuild plugin.
 */

import type {
  Plugin,
  PluginBuild
} from 'esbuild';

import { extractDefaultExportInterop } from '@mnaoumov/typescript-lib/object-utils';

import { readPackageJson } from '../../npm.ts';
import { createSveltePreprocessor } from './svelte-preprocessor.ts';

const MISSING_SVELTE_MESSAGE_REG_EXP = /Cannot find (?:module|package) 'svelte(?:\/[^']*)?'/;
const MODULE_NOT_FOUND_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);
const SVELTE_FILTER = /\.svelte$/;

/**
 * Checks whether an error is the one loading `esbuild-svelte` throws when the `svelte` package is not installed.
 *
 * `esbuild-svelte` imports `svelte/compiler` when it loads, and package managers that do not install peers (Yarn 1)
 * leave `svelte` out of a project that has no Svelte components.
 *
 * @param error - The error to check.
 * @returns Whether the error says that the `svelte` package cannot be found.
 */
export function isMissingSveltePackageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Partial<Record<'code', unknown>>).code;
  return typeof code === 'string' && MODULE_NOT_FOUND_CODES.has(code) && MISSING_SVELTE_MESSAGE_REG_EXP.test(error.message);
}

/**
 * Wraps the esbuild-svelte plugin to ensure that the correct format is used.
 *
 * `esbuild-svelte` is loaded when the plugin is set up, not when this module is imported. When
 * the `svelte` package is not installed, a build with no `.svelte` file succeeds, and a build that reaches one fails
 * with an error that names the missing package.
 *
 * @param isProductionBuild - Whether the build is a production build.
 * @returns The esbuild plugin.
 */
export function svelteWrapperPlugin(isProductionBuild: boolean): Plugin {
  return {
    name: 'svelte-wrapper',
    async setup(build): Promise<void> {
      let sveltePlugin: Plugin;
      try {
        sveltePlugin = await createEsbuildSveltePlugin(isProductionBuild);
      } catch (error) {
        if (!isMissingSveltePackageError(error)) {
          throw error;
        }
        registerMissingSvelteLoader(build);
        return;
      }

      const packageJson = await readPackageJson();
      const format = packageJson.type === 'module' ? 'esm' : 'cjs';
      await sveltePlugin.setup({
        ...build,
        initialOptions: {
          ...build.initialOptions,
          format
        }
      });
    }
  };
}

/* v8 ignore start -- esbuild-svelte compiles only inside a live esbuild build; svelte-wrapper-plugin.integration.test.ts runs one. */
async function createEsbuildSveltePlugin(isProductionBuild: boolean): Promise<Plugin> {
  const esbuildSvelteModule = await import('esbuild-svelte');
  const esbuildSvelte = extractDefaultExportInterop(esbuildSvelteModule.default);
  return esbuildSvelte({
    compilerOptions: {
      css: 'injected',
      dev: !isProductionBuild
    },
    moduleCompilerOptions: {
      dev: !isProductionBuild
    },
    preprocess: createSveltePreprocessor()
  });
}
/* v8 ignore stop */

function registerMissingSvelteLoader(build: PluginBuild): void {
  build.onLoad({ filter: SVELTE_FILTER }, (arguments_) => ({
    errors: [{
      text: `Cannot compile ${arguments_.path}: the \`svelte\` package is not installed. Install \`svelte\` in the project to build Svelte components.`
    }]
  }));
}
