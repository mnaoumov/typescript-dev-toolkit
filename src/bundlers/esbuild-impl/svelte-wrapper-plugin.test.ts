import type {
  OnLoadArgs,
  OnLoadResult,
  PluginBuild
} from 'esbuild';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

function createBuild(): PluginBuild {
  return castTo<PluginBuild>({
    initialOptions: {},
    onEnd: vi.fn(),
    onLoad: vi.fn(),
    onResolve: vi.fn()
  });
}

function createModuleNotFoundError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

async function importPlugin(): Promise<typeof import('./svelte-wrapper-plugin.ts')> {
  return await import('./svelte-wrapper-plugin.ts');
}

/*
 * The real `esbuild-svelte` throws while its module is evaluated. Vitest wraps an error thrown by a mock factory, so the
 * mock throws where the plugin first reads the module instead.
 */
function mockEsbuildSvelteLoadError(error: Error): void {
  vi.doMock('esbuild-svelte', () => ({
    get default(): never {
      throw error;
    }
  }));
}

afterEach(() => {
  vi.doUnmock('esbuild-svelte');
  vi.doUnmock('../../npm.ts');
  vi.resetModules();
});

describe('isMissingSveltePackageError', () => {
  it.each([
    ['Cannot find module \'svelte/compiler\'\nRequire stack:\n- node_modules\\esbuild-svelte\\dist\\index.js', 'MODULE_NOT_FOUND'],
    ['Cannot find package \'svelte\' imported from node_modules/esbuild-svelte/dist/index.mjs', 'ERR_MODULE_NOT_FOUND']
  ])('detects %s', async (message, code) => {
    const { isMissingSveltePackageError } = await importPlugin();
    expect(isMissingSveltePackageError(createModuleNotFoundError(message, code))).toBe(true);
  });

  it.each([
    ['another missing package', createModuleNotFoundError('Cannot find module \'esbuild-svelte\'', 'MODULE_NOT_FOUND')],
    ['a package whose name starts with svelte', createModuleNotFoundError('Cannot find package \'svelte-preprocess\' imported from x', 'ERR_MODULE_NOT_FOUND')],
    ['an error without a code', new Error('Cannot find module \'svelte/compiler\'')],
    ['an error with another code', createModuleNotFoundError('Cannot find module \'svelte/compiler\'', 'EACCES')],
    ['a value that is not an error', 'Cannot find module \'svelte/compiler\'']
  ])('ignores %s', async (_, error) => {
    const { isMissingSveltePackageError } = await importPlugin();
    expect(isMissingSveltePackageError(error)).toBe(false);
  });
});

describe('svelteWrapperPlugin', () => {
  it('does not load esbuild-svelte when the module is imported', async () => {
    mockEsbuildSvelteLoadError(createModuleNotFoundError('Cannot find module \'svelte/compiler\'', 'MODULE_NOT_FOUND'));
    const { svelteWrapperPlugin } = await importPlugin();
    expect(svelteWrapperPlugin(true).name).toBe('svelte-wrapper');
  });

  it('sets esbuild-svelte up when svelte is installed', async () => {
    const { svelteWrapperPlugin } = await importPlugin();
    const build = createBuild();
    await svelteWrapperPlugin(false).setup(build);
    const filters = vi.mocked(build.onLoad).mock.calls.map(([options]) => options.filter);
    expect(filters.some((filter) => filter.test('src/Component.svelte'))).toBe(true);
  });

  it.each([
    ['module', 'esm'],
    [undefined, 'cjs']
  ])('hands esbuild-svelte the format of a package whose type is %s', async (type, format) => {
    const setup = vi.fn();
    vi.doMock('esbuild-svelte', () => ({ default: vi.fn(() => ({ name: 'esbuild-svelte', setup })) }));
    vi.doMock('../../npm.ts', () => ({ readPackageJson: vi.fn().mockResolvedValue({ type }) }));
    const { svelteWrapperPlugin } = await importPlugin();
    await svelteWrapperPlugin(true).setup(createBuild());
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ initialOptions: { format } }));
  });

  it('fails only a .svelte file when svelte is not installed', async () => {
    type OnLoadCallback = (arguments_: OnLoadArgs) => OnLoadResult;
    mockEsbuildSvelteLoadError(createModuleNotFoundError('Cannot find module \'svelte/compiler\'', 'MODULE_NOT_FOUND'));
    const { svelteWrapperPlugin } = await importPlugin();
    const build = createBuild();
    await svelteWrapperPlugin(true).setup(build);

    expect(build.onLoad).toHaveBeenCalledOnce();
    const [options, callback] = vi.mocked(build.onLoad).mock.calls[0] as [unknown, OnLoadCallback];
    expect(options).toEqual({ filter: /\.svelte$/ });
    const result = callback({ path: 'src/Component.svelte' } as OnLoadArgs);
    expect(result.errors?.[0]?.text).toContain('Cannot compile src/Component.svelte: the `svelte` package is not installed.');
  });

  it('rethrows any other error loading esbuild-svelte', async () => {
    const error = createModuleNotFoundError('Cannot find module \'esbuild-svelte\'', 'MODULE_NOT_FOUND');
    mockEsbuildSvelteLoadError(error);
    const { svelteWrapperPlugin } = await importPlugin();
    await expect(svelteWrapperPlugin(true).setup(createBuild())).rejects.toThrow('Cannot find module \'esbuild-svelte\'');
  });
});
