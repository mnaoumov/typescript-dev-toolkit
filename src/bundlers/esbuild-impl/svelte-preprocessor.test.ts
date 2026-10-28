import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  SvelteBlockAttributes,
  SveltePreprocessorParams
} from './svelte-preprocessor.ts';

function createModuleNotFoundError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function createParams(attributes: SvelteBlockAttributes, content = '', ...filenames: [] | [string | undefined]): SveltePreprocessorParams {
  const filename = filenames.length === 0 ? 'src/Component.svelte' : filenames[0];
  return {
    attributes,
    content,
    ...filename !== undefined && { filename },
    markup: ''
  };
}

async function importPreprocessor(): Promise<typeof import('./svelte-preprocessor.ts')> {
  return await import('./svelte-preprocessor.ts');
}

/*
 * Vitest wraps an error thrown by a mock factory, so the mock throws where the preprocessor first reads the module
 * instead, as an import of a missing package would.
 */
function mockSveltePreprocessLoadError(error: Error): void {
  vi.doMock('svelte-preprocess', () => ({
    get sveltePreprocess(): never {
      throw error;
    }
  }));
}

afterEach(() => {
  vi.doUnmock('svelte-preprocess');
  vi.resetModules();
});

describe('getBlockLanguage', () => {
  it.each([
    [{ lang: 'ts' }, 'ts'],
    [{ lang: 'TypeScript' }, 'typescript'],
    [{ type: 'text/typescript' }, 'typescript'],
    [{ type: 'Text/SCSS' }, 'scss'],
    [{ lang: 'scss', type: 'text/css' }, 'scss'],
    [{ lang: '', type: 'text/less' }, 'less'],
    [{}, undefined],
    [{ lang: true }, undefined],
    [{ type: 'module' }, undefined],
    [{ type: true }, undefined]
  ])('reads %j as %s', async (attributes: SvelteBlockAttributes, language) => {
    const { getBlockLanguage } = await importPreprocessor();
    expect(getBlockLanguage(attributes)).toBe(language);
  });
});

describe('isMissingSveltePreprocessError', () => {
  it.each([
    ['Cannot find module \'svelte-preprocess\'', 'MODULE_NOT_FOUND'],
    ['Cannot find package \'svelte-preprocess\' imported from x', 'ERR_MODULE_NOT_FOUND']
  ])('detects %s', async (message, code) => {
    const { isMissingSveltePreprocessError } = await importPreprocessor();
    expect(isMissingSveltePreprocessError(createModuleNotFoundError(message, code))).toBe(true);
  });

  it.each([
    ['another missing package', createModuleNotFoundError('Cannot find module \'sass\'', 'MODULE_NOT_FOUND')],
    ['an error without a code', new Error('Cannot find module \'svelte-preprocess\'')],
    ['an error with another code', createModuleNotFoundError('Cannot find module \'svelte-preprocess\'', 'EACCES')],
    ['a value that is not an error', 'Cannot find module \'svelte-preprocess\'']
  ])('ignores %s', async (_, error) => {
    const { isMissingSveltePreprocessError } = await importPreprocessor();
    expect(isMissingSveltePreprocessError(error)).toBe(false);
  });
});

describe('createSveltePreprocessor', () => {
  it.each([
    [{}],
    [{ lang: 'js' }],
    [{ type: 'text/javascript' }]
  ])('leaves a script with %j alone', async (attributes: SvelteBlockAttributes) => {
    const { createSveltePreprocessor } = await importPreprocessor();
    await expect(createSveltePreprocessor().script(createParams(attributes, 'let a = 1;'))).resolves.toBeUndefined();
  });

  it.each([
    [{}],
    [{ lang: 'css' }],
    [{ type: 'text/css' }]
  ])('leaves a style with %j alone', async (attributes: SvelteBlockAttributes) => {
    const { createSveltePreprocessor } = await importPreprocessor();
    await expect(createSveltePreprocessor().style(createParams(attributes, 'p { color: red; }'))).resolves.toBeUndefined();
  });

  it('compiles TypeScript, keeping imports the markup may use and dropping type imports', async () => {
    const { createSveltePreprocessor } = await importPreprocessor();
    const content = [
      'import type { Props } from \'./props.ts\';',
      'import { format } from \'./format.ts\';',
      'enum Color { Red }',
      'let { name }: Props = $props();',
      'const color: Color = Color.Red;'
    ].join('\n');
    const result = await createSveltePreprocessor().script(createParams({ lang: 'ts' }, content));
    expect(result?.code).toContain('import { format } from "./format.ts";');
    expect(result?.code).not.toContain('./props.ts');
    expect(result?.code).not.toContain(': Props');
    expect(result?.code).toContain('Color2[Color2["Red"] = 0] = "Red";');
    expect(typeof result?.map).toBe('string');
    expect(JSON.parse(result?.map as string)).toMatchObject({ sources: ['src/Component.svelte'], version: 3 });
  });

  it('compiles a script whose type attribute names TypeScript, with no file name', async () => {
    const { createSveltePreprocessor } = await importPreprocessor();
    const result = await createSveltePreprocessor().script(createParams({ type: 'text/typescript' }, 'let a: number = 1;', undefined));
    expect(result?.code).toBe('let a = 1;\n');
  });

  it('rejects TypeScript esbuild cannot parse', async () => {
    const { createSveltePreprocessor } = await importPreprocessor();
    await expect(createSveltePreprocessor().script(createParams({ lang: 'ts' }, 'let a: = ;'))).rejects.toThrow('Unexpected');
  });

  it('hands other languages to svelte-preprocess, loading it once', async () => {
    const script = vi.fn().mockResolvedValue({ code: 'coffee' });
    const style = vi.fn().mockReturnValue({ code: 'scss' });
    const sveltePreprocess = vi.fn(() => ({ script, style }));
    vi.doMock('svelte-preprocess', () => ({ sveltePreprocess }));
    const { createSveltePreprocessor } = await importPreprocessor();
    const preprocessor = createSveltePreprocessor();

    const styleParams = createParams({ lang: 'scss' }, '$a: red;');
    await expect(preprocessor.style(styleParams)).resolves.toEqual({ code: 'scss' });
    const scriptParams = createParams({ lang: 'coffee' }, 'a = 1');
    await expect(preprocessor.script(scriptParams)).resolves.toEqual({ code: 'coffee' });

    expect(sveltePreprocess).toHaveBeenCalledOnce();
    expect(style).toHaveBeenCalledWith(styleParams);
    expect(script).toHaveBeenCalledWith(scriptParams);
  });

  it('returns nothing when svelte-preprocess has no preprocessor for the block or changes nothing', async () => {
    vi.doMock('svelte-preprocess', () => ({ sveltePreprocess: vi.fn(() => ({ style: vi.fn() })) }));
    const { createSveltePreprocessor } = await importPreprocessor();
    const preprocessor = createSveltePreprocessor();
    await expect(preprocessor.style(createParams({ lang: 'scss' }))).resolves.toBeUndefined();
    await expect(preprocessor.script(createParams({ lang: 'coffee' }))).resolves.toBeUndefined();
  });

  it.each([
    ['src/Component.svelte', 'Cannot preprocess the <style lang="scss"> block of src/Component.svelte: install `svelte-preprocess` in the project to compile scss.'],
    [undefined, 'Cannot preprocess the <style lang="scss"> block of a Svelte component: install `svelte-preprocess` in the project to compile scss.']
  ])('names the missing svelte-preprocess package for %s, and tries again on the next block', async (filename, message) => {
    const error = createModuleNotFoundError('Cannot find package \'svelte-preprocess\' imported from x', 'ERR_MODULE_NOT_FOUND');
    mockSveltePreprocessLoadError(error);
    const { createSveltePreprocessor } = await importPreprocessor();
    const preprocessor = createSveltePreprocessor();

    await expect(preprocessor.style(createParams({ lang: 'scss' }, '', filename))).rejects.toThrow(expect.objectContaining({ cause: error, message }));

    vi.doUnmock('svelte-preprocess');
    vi.doMock('svelte-preprocess', () => ({ sveltePreprocess: vi.fn(() => ({ style: vi.fn().mockReturnValue({ code: 'css' }) })) }));
    await expect(preprocessor.style(createParams({ lang: 'scss' }))).resolves.toEqual({ code: 'css' });
  });

  it('rethrows any other error loading svelte-preprocess', async () => {
    mockSveltePreprocessLoadError(createModuleNotFoundError('Cannot find module \'sass\'', 'MODULE_NOT_FOUND'));
    const { createSveltePreprocessor } = await importPreprocessor();
    await expect(createSveltePreprocessor().style(createParams({ lang: 'scss' }))).rejects.toThrow('Cannot find module \'sass\'');
  });
});
