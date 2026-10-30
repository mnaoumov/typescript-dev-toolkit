import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';
import type {
  BuildResult,
  OutputFile,
  Plugin,
  PluginBuild
} from 'esbuild';

import { ensureGenericObject } from '@mnaoumov/typescript-lib/type-guards';
import dedent from 'dedent';
import { build as bundle } from 'esbuild';
import { Buffer } from 'node:buffer';
import {
  createContext,
  runInContext
} from 'node:vm';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PreprocessPluginOptions } from './preprocess-plugin.ts';

import {
  ensureBrowserProcess,
  ensureDisposeSymbols,
  keepName,
  makePreprocessBanner,
  preprocessPlugin
} from './preprocess-plugin.ts';

function getHostProcess(): GenericObject {
  return ensureGenericObject(globalThis.process);
}

function makeBuildStub(banner?: string): PluginBuild {
  const partialBuild: Partial<PluginBuild> = {
    initialOptions: banner === undefined ? {} : { banner: { js: banner } },
    onLoad(): void {
      // The tests never trigger a load; only the banner matters here.
    }
  };
  return partialBuild as PluginBuild;
}

function stubProcess(value: unknown): GenericObject {
  vi.stubGlobal('process', value);
  return getHostProcess();
}

describe('ensureBrowserProcess', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs the shim when the host has no process at all', () => {
    stubProcess(undefined);

    ensureBrowserProcess();

    const shimmedProcess = getHostProcess();
    expect(shimmedProcess['browser']).toBe(true);
    expect(shimmedProcess['platform']).toBe('android');
    expect(shimmedProcess['env']).toEqual({});
    expect((shimmedProcess['cwd'] as () => string)()).toBe('/');
  });

  it('fills in the missing keys of a partial host process instead of skipping it', () => {
    const partialProcess = stubProcess({});

    ensureBrowserProcess();

    expect(getHostProcess()).toBe(partialProcess);
    expect(partialProcess['browser']).toBe(true);
    expect(partialProcess['platform']).toBe('android');
    expect(partialProcess['env']).toEqual({});
    expect((partialProcess['cwd'] as () => string)()).toBe('/');
  });

  it('keeps the keys the host process already provides', () => {
    function hostCwd(): string {
      return '/host';
    }

    const hostEnv = { DEBUG: 'foo' };
    const partialProcess = stubProcess({
      cwd: hostCwd,
      env: hostEnv,
      platform: 'ios',
      unrelated: 'untouched'
    });

    ensureBrowserProcess();

    expect(partialProcess['cwd']).toBe(hostCwd);
    expect(partialProcess['env']).toBe(hostEnv);
    expect(partialProcess['platform']).toBe('ios');
    expect(partialProcess['unrelated']).toBe('untouched');
    expect(partialProcess['browser']).toBe(true);
  });

  it('overrides an explicit browser: false, which a nullish-assignment merge would leave in place', () => {
    const partialProcess = stubProcess({ browser: false });

    ensureBrowserProcess();

    expect(partialProcess['browser']).toBe(true);
  });

  it('leaves a real Node process completely untouched', () => {
    const nodeProcess = stubProcess({
      platform: 'win32',
      type: 'renderer',
      versions: { node: '22.14.0' }
    });

    ensureBrowserProcess();

    expect(nodeProcess).toEqual({
      platform: 'win32',
      type: 'renderer',
      versions: { node: '22.14.0' }
    });
  });

  it('treats a versions bag without a node entry as a browser process', () => {
    const partialProcess = stubProcess({ versions: {} });

    ensureBrowserProcess();

    expect(partialProcess['browser']).toBe(true);
  });

  it('is idempotent on an already shimmed process', () => {
    const partialProcess = stubProcess({});

    ensureBrowserProcess();
    const afterFirstCall = { ...partialProcess };
    ensureBrowserProcess();

    expect({ ...partialProcess }).toEqual(afterFirstCall);
  });
});

describe('keepName', () => {
  it('returns its argument unchanged', () => {
    function target(): void {
      // Only its identity matters.
    }

    expect(keepName(target)).toBe(target);
  });
});

describe('preprocessPlugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function getBanner(isEsm: boolean): string {
    const plugin: Plugin = preprocessPlugin({ isEsm });
    const build = makeBuildStub();
    expect(plugin.setup(build)).toBeUndefined();
    return build.initialOptions.banner?.['js'] ?? '';
  }

  /**
   * Runs the emitted banner the way a built bundle does, against a host `process` of our choosing.
   *
   * This is the only check that exercises what actually ships: the banner is a serialized copy of the
   * module's functions, so a shim that fails to serialize is invisible to every other assertion here.
   */
  function runBanner(isEsm: boolean, hostProcess: unknown): void {
    const banner = getBanner(isEsm);
    vi.stubGlobal('process', hostProcess);
    vi.stubGlobal('__name', undefined);
    vi.stubGlobal('__extractDefault', undefined);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- Evaluating the emitted banner is the point of this check.
    const runEmittedBanner = new Function('require', banner);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- `Function` is untyped by construction; the banner takes a single `require` argument.
    runEmittedBanner(() => undefined);
  }

  describe.each([
    ['esm', true],
    ['cjs', false]
  ])('%s banner', (_format, isEsm) => {
    it('shims a host that has no process at all', () => {
      runBanner(isEsm, undefined);

      expect(getHostProcess()['browser']).toBe(true);
    });

    it('fills in a partial host process rather than skipping it', () => {
      runBanner(isEsm, {});

      expect(getHostProcess()['browser']).toBe(true);
      expect(getHostProcess()['platform']).toBe('android');
    });

    it('leaves a real Node process untouched', () => {
      runBanner(isEsm, { versions: { node: '22.14.0' } });

      expect(getHostProcess()['browser']).toBeUndefined();
    });
  });

  it('serializes the __name shim into the cjs banner, so __name holds a function and not window.name', () => {
    runBanner(false, {});

    expect(ensureGenericObject(globalThis)['__name']).toBeTypeOf('function');
  });

  it('omits the __name shim from the esm banner, which never references it', () => {
    expect(getBanner(true)).not.toContain('function keepName(');
  });

  it('appends the banner instead of replacing an existing one', () => {
    const plugin: Plugin = preprocessPlugin({ isEsm: true });
    const build = makeBuildStub('// existing');

    expect(plugin.setup(build)).toBeUndefined();

    expect(build.initialOptions.banner?.['js']).toMatch(/^\/\/ existing/);
  });

  it('carries no Obsidian require patch, so the cjs banner runs under plain Node', () => {
    const banner = getBanner(false);

    expect(banner).not.toContain('isMobile');
    expect(banner).not.toContain('__isPatched');
  });
});

describe('preprocessPlugin in an unbundled build', () => {
  interface RunUnbundledParams {
    readonly banner?: string;
    readonly files: Record<string, string>;
    readonly options?: PreprocessPluginOptions;
  }

  function makeOutputFile(path: string, text: string): OutputFile {
    const decoder = new TextDecoder();
    const outputFile = {
      contents: new TextEncoder().encode(text),
      hash: '',
      path,
      get text(): string {
        return decoder.decode(outputFile.contents);
      }
    };
    return outputFile;
  }

  // Runs the plugin's end-of-build pass over hand-written outputs and returns each output's resulting text.
  async function runUnbundled(params: RunUnbundledParams): Promise<Record<string, string>> {
    type EndCallback = Parameters<PluginBuild['onEnd']>[0];
    const { banner, files, options = {} } = params;
    const endCallbacks: EndCallback[] = [];
    const partialBuild: Partial<PluginBuild> = {
      initialOptions: { ...(banner !== undefined && { banner: { js: banner } }), bundle: false },
      onEnd(callback): void {
        endCallbacks.push(callback);
      },
      onLoad(): void {
        // The tests never trigger a load.
      }
    };
    const build = partialBuild as PluginBuild;
    expect(preprocessPlugin(options).setup(build)).toBeUndefined();
    expect(build.initialOptions.banner).toEqual(banner === undefined ? undefined : { js: banner });

    const outputFiles = Object.entries(files).map(([path, text]) => makeOutputFile(path, text));
    const partialResult: Partial<BuildResult> = { outputFiles };
    for (const callback of endCallbacks) {
      await callback(partialResult as BuildResult);
      await callback({} as BuildResult);
    }
    return Object.fromEntries(outputFiles.map((outputFile) => [outputFile.path, outputFile.text]));
  }

  async function runOne(code: string, options?: PreprocessPluginOptions): Promise<string> {
    const outputs = await runUnbundled({ files: { 'out/a.js': code }, ...(options !== undefined && { options }) });
    return outputs['out/a.js'] ?? '';
  }

  it('leaves a module that needs no shim untouched', async () => {
    const code = dedent`
      import { a } from "./a.js";
      export { b } from "./b.js";
      export { a };
      const api = { process() { return 1; }, get __name() { return 2; }, set __name(value) {} };
      class Worker { process() {} static __name = 1; }
      function process(...args) { return args; }
      const { process: renamed } = api;
      process(api.process(), renamed, new Worker(), require(name), call());
      const text = "process";\n
    `;

    expect(await runOne(code)).toBe(code);
  });

  it.each([
    ['a free process read', 'export const cwd = process.cwd();\n'],
    ['a bare import', 'import debug from "debug";\n'],
    ['a bare re-export', 'export * from "path-browserify";\n'],
    ['a bare require', 'const debug = require("debug");\n'],
    ['a bare dynamic import', 'export const load = () => import("debug");\n']
  ])('shims process for %s', async (_case, code) => {
    const result = await runOne(code);

    expect(result).toContain('ensureBrowserProcess();');
    expect(result).not.toContain('ensureDisposeSymbols');
    expect(result.endsWith(code)).toBe(true);
  });

  it.each([
    ['Symbol.dispose', 'class A { [Symbol.dispose]() {} }\n'],
    ['Symbol.asyncDispose', 'class A { async [Symbol.asyncDispose]() {} }\n'],
    ['the lowered using helper', 'var __knownSymbol = (name) => Symbol.for("Symbol." + name);\n']
  ])('shims the dispose symbols for %s', async (_case, code) => {
    const result = await runOne(code);

    expect(result).toContain('ensureDisposeSymbols();');
    expect(result).not.toContain('ensureBrowserProcess');
  });

  it('shims a free __name, and leaves one the module declares', async () => {
    expect(await runOne('__name(f, "f");\n')).toContain('globalThis[\'__name\'] ??= keepName;');
    expect(await runOne('var __name = (target) => target;\n__name(f, "f");\n')).not.toContain('keepName');
  });

  it('leaves Symbol members that are not the dispose symbols alone', async () => {
    const code = 'const iterator = Symbol.iterator;\nconst other = notSymbol.dispose;\n';

    expect(await runOne(code)).toBe(code);
  });

  it('runs the caller\'s init functions in every module, even one that needs no shim', async () => {
    function extraInit(): void {
      // Only its serialized text matters.
    }

    const result = await runOne('export const a = 1;\n', { additionalBannerInitFunctions: [extraInit] });

    expect(result).toBe(`(${String(extraInit)})();\nexport const a = 1;\n`);
  });

  it('puts the preamble after the leading banner, and only touches JavaScript outputs', async () => {
    const outputs = await runUnbundled({
      banner: '/* banner */\n',
      files: {
        'out/a.js': '/* banner */\nexport const cwd = process.cwd();\n',
        'out/a.js.map': 'process'
      }
    });

    expect(outputs['out/a.js']).toMatch(/^\/\* banner \*\/\n\(function \(\) \{\n/);
    expect(outputs['out/a.js.map']).toBe('process');
  });

  it('puts the preamble first when the leading banner does not end its line', async () => {
    const outputs = await runUnbundled({ banner: '/* banner */', files: { 'out/a.mjs': '/* banner */export const cwd = process.cwd();\n' } });

    expect(outputs['out/a.mjs']).toMatch(/^\(function \(\) \{\n/);
  });

  it('shifts an inline source map down by the lines the preamble adds', async () => {
    const sourceMap = { mappings: 'AAAA', sources: ['a.ts'], version: 3 };
    const prefix = '//# sourceMappingURL=data:application/json;base64,';
    const code = `export const cwd = process.cwd();\n${prefix}${Buffer.from(JSON.stringify(sourceMap)).toString('base64')}\n`;

    const result = await runOne(code);

    const resultLines = result.split('\n');
    const mapLine = resultLines.find((line) => line.startsWith(prefix)) ?? '';
    const shiftedMap = JSON.parse(Buffer.from(mapLine.slice(prefix.length), 'base64').toString('utf-8')) as typeof sourceMap;
    const codeLine = resultLines.indexOf('export const cwd = process.cwd();');
    expect(shiftedMap.mappings).toBe(`${';'.repeat(codeLine)}AAAA`);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('serializes a preamble that installs the shims it names', async () => {
    const preamble = await runOne('');
    expect(preamble).toBe('');

    const code = await runOne('class A { [Symbol.dispose]() {} }\nexport const cwd = process.cwd();\n__name(f, "f");\n');
    const preambleCode = code.slice(0, code.indexOf('class A'));
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('__name', undefined);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- Evaluating the emitted preamble is the point of this check.
    const runPreamble = new Function(preambleCode);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- `Function` is untyped by construction.
    runPreamble();

    expect(getHostProcess()['browser']).toBe(true);
    expect(ensureGenericObject(globalThis)['__name']).toBeTypeOf('function');
    vi.unstubAllGlobals();
  });
});

describe('makePreprocessBanner', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the cjs banner by default', () => {
    expect(makePreprocessBanner()).toBe(makePreprocessBanner({ isEsm: false }));
    expect(makePreprocessBanner()).toContain('function keepName(');
  });

  it('runs each additional init function after the shared scope, on its own', () => {
    vi.stubGlobal('__initOrder', []);
    function recordInit(): void {
      (Reflect.get(globalThis, '__initOrder') as string[]).push('extra');
    }

    const banner = makePreprocessBanner({ additionalBannerInitFunctions: [recordInit], isEsm: true });
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- Evaluating the emitted banner is the point of this check.
    const runEmittedBanner = new Function(banner);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- `Function` is untyped by construction.
    runEmittedBanner();

    expect(ensureGenericObject(globalThis)['__initOrder']).toEqual(['extra']);
    expect(banner.indexOf('function recordInit(')).toBeGreaterThan(banner.indexOf('})();'));
  });
});

describe('ensureDisposeSymbols', () => {
  type DisposeSymbolHost = NonNullable<Parameters<typeof ensureDisposeSymbols>[0]>;

  function makeSymbolWithoutDisposeSymbols(): DisposeSymbolHost {
    return { for: (key: string) => Symbol.for(key) };
  }

  it('fills in the registry symbols esbuild looks up when the engine lacks the well-known ones', () => {
    const symbolConstructor = makeSymbolWithoutDisposeSymbols();

    ensureDisposeSymbols(symbolConstructor);

    expect(symbolConstructor.dispose).toBe(Symbol.for('Symbol.dispose'));
    expect(symbolConstructor.asyncDispose).toBe(Symbol.for('Symbol.asyncDispose'));
  });

  it('keeps well-known symbols the engine already has', () => {
    const hostDispose = Symbol('host dispose');
    const hostAsyncDispose = Symbol('host asyncDispose');
    const symbolConstructor = {
      ...makeSymbolWithoutDisposeSymbols(),
      asyncDispose: hostAsyncDispose,
      dispose: hostDispose
    };

    ensureDisposeSymbols(symbolConstructor);

    expect(symbolConstructor.dispose).toBe(hostDispose);
    expect(symbolConstructor.asyncDispose).toBe(hostAsyncDispose);
  });

  it('leaves the ambient Symbol untouched on an engine that has the well-known symbols', () => {
    const { asyncDispose, dispose } = Symbol;

    ensureDisposeSymbols();

    expect(Symbol.dispose).toBe(dispose);
    expect(Symbol.asyncDispose).toBe(asyncDispose);
  });
});

describe('using a library disposable on an engine without Symbol.dispose', () => {
  /**
   * Replaces the context's `Symbol` with a copy that lacks the two dispose symbols, which is how an engine
   * that has not shipped Explicit Resource Management looks to a bundle. The real well-known properties
   * are non-configurable, so they can be neither deleted nor hidden behind a `Proxy`.
   */
  const HIDE_DISPOSE_SYMBOLS = `
    const realSymbol = Symbol;
    const engineSymbol = function Symbol(description) {
      return realSymbol(description);
    };
    for (const key of Reflect.ownKeys(realSymbol)) {
      if (key !== 'dispose' && key !== 'asyncDispose' && key !== 'prototype') {
        Object.defineProperty(engineSymbol, key, { ...Object.getOwnPropertyDescriptor(realSymbol, key), configurable: true });
      }
    }
    globalThis.Symbol = engineSymbol;
  `;

  /**
   * The disposables are declared here in the shape `@mnaoumov/typescript-lib`'s are, a class method keyed by the
   * literal `[Symbol.dispose]` / `[Symbol.asyncDispose]`. Importing the library's own would bundle its BUILT copy
   * wherever its sources are not at hand, and that copy carries this very banner already, so the no-banner control
   * could never fail.
   */
  const ENTRY = `
    class CallbackDisposable {
      constructor({ callback }) { this.callback = callback; }
      [Symbol.dispose]() { this.callback(); }
    }
    class AsyncCallbackDisposable {
      constructor({ callback }) { this.callback = callback; }
      async [Symbol.asyncDispose]() { await this.callback(); }
    }
    globalThis.probe = { disposed: false, error: null, asyncDisposed: false, asyncError: null };
    try {
      using _disposable = new CallbackDisposable({ callback: () => { globalThis.probe.disposed = true; } });
    } catch (error) {
      globalThis.probe.error = String(error);
    }
    globalThis.probe.asyncDone = (async () => {
      try {
        await using _asyncDisposable = new AsyncCallbackDisposable({ callback: async () => { globalThis.probe.asyncDisposed = true; } });
      } catch (error) {
        globalThis.probe.asyncError = String(error);
      }
    })();
  `;

  interface Probe {
    readonly asyncDisposed: boolean;
    readonly asyncDone: Promise<void>;
    readonly asyncError: null | string;
    readonly disposed: boolean;
    readonly error: null | string;
  }

  async function runOnEngineWithoutDisposeSymbols(plugins: Plugin[]): Promise<Probe> {
    const result = await bundle({
      bundle: true,
      format: 'iife',
      logLevel: 'silent',
      plugins,
      stdin: {
        contents: ENTRY,
        loader: 'ts',
        // eslint-disable-next-line unicorn/name-replacements -- esbuild's own option name.
        resolveDir: import.meta.dirname
      },
      target: 'es2022',
      write: false
    });
    // The cjs banner patches the module-scoped `require` a CommonJS bundle has, so the context supplies one.
    const context = createContext({ require: () => undefined });
    runInContext(HIDE_DISPOSE_SYMBOLS, context);
    runInContext(result.outputFiles[0]?.text ?? '', context);
    const probe = ensureGenericObject(context)['probe'] as Probe;
    await probe.asyncDone;
    return probe;
  }

  it('reproduces the failure without the banner, so the simulated engine really lacks the symbols', async () => {
    const probe = await runOnEngineWithoutDisposeSymbols([]);

    expect(probe.error).toContain('Object not disposable');
    expect(probe.asyncError).toContain('Object not disposable');
    expect(probe.disposed).toBe(false);
  });

  it.each([
    ['esm', true],
    ['cjs', false]
  ])('disposes through the %s banner', async (_format, isEsm) => {
    const probe = await runOnEngineWithoutDisposeSymbols([preprocessPlugin({ isEsm })]);

    expect(probe.error).toBeNull();
    expect(probe.asyncError).toBeNull();
    expect(probe.disposed).toBe(true);
    expect(probe.asyncDisposed).toBe(true);
  });
});
