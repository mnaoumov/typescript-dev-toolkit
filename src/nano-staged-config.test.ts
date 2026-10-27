import type { PackageJson } from 'type-fest';

import {
  dirname,
  join,
  resolve
} from 'node:path';
import {
  fileURLToPath,
  pathToFileURL
} from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { NanoStagedConfig } from './nano-staged-config.ts';

import {
  getEffectiveCommandLineLength,
  getMaxBatchCommandLength
} from './exec.ts';
import {
  getNanoStagedConfig,
  obsidianDevUtilsConfig
} from './nano-staged-config.ts';

const ALL_SCRIPTS = ['format', 'lint:fix', 'lint:md:fix', 'spellcheck'];

const { mockExistsSync, mockExit, mockGetPackageManagerRunCommand, mockLoadEnvFile, mockReadPackageJsonSync, mockStdoutWrite } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockExit: vi.fn(),
  /*
   * The run prefix is resolved at MODULE SCOPE, before any `beforeEach` runs, so the default
   * implementation has to be supplied here rather than in a hook. Without it the config's contents would
   * depend on whichever package manager launched vitest.
   */
  mockGetPackageManagerRunCommand: vi.fn<() => string[]>(() => ['npm', 'run']),
  mockLoadEnvFile: vi.fn(),
  mockReadPackageJsonSync: vi.fn<() => PackageJson>(),
  mockStdoutWrite: vi.fn()
}));

vi.mock('./package-manager.ts', () => ({
  getPackageManagerRunCommand: mockGetPackageManagerRunCommand
}));

vi.mock('./npm.ts', () => ({
  readPackageJsonSync: mockReadPackageJsonSync
}));

function mockScripts(scriptNames: readonly string[]): void {
  mockReadPackageJsonSync.mockReturnValue({ scripts: Object.fromEntries(scriptNames.map((scriptName) => [scriptName, 'x'])) });
}

vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: mockExistsSync
}));

vi.mock('node:process', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:process')>();
  return {
    ...$module,
    default: {
      ...$module,
      exit: mockExit,
      loadEnvFile: mockLoadEnvFile,
      stdout: {
        ...$module.stdout,
        write: mockStdoutWrite
      }
    }
  };
});

describe('getNanoStagedConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockScripts(ALL_SCRIPTS);
    vi.stubEnv('NANO_STAGED', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return the shared config when NANO_STAGED is unset', () => {
    vi.stubEnv('NANO_STAGED', undefined);
    expect(getNanoStagedConfig()).toBe(obsidianDevUtilsConfig);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should run when NANO_STAGED is an on value', () => {
    vi.stubEnv('NANO_STAGED', '1');
    expect(getNanoStagedConfig()).toBe(obsidianDevUtilsConfig);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should load .env when it exists', () => {
    mockExistsSync.mockReturnValue(true);
    getNanoStagedConfig();
    expect(mockLoadEnvFile).toHaveBeenCalledWith('.env');
  });

  it('should not load .env when it is absent', () => {
    mockExistsSync.mockReturnValue(false);
    getNanoStagedConfig();
    expect(mockLoadEnvFile).not.toHaveBeenCalled();
  });

  it.each(['0', 'false', 'OFF', ' no '])('should skip and exit 0 when NANO_STAGED is %s', (value) => {
    vi.stubEnv('NANO_STAGED', value);
    getNanoStagedConfig();
    expect(mockStdoutWrite).toHaveBeenCalledWith('nano-staged: skipped (NANO_STAGED is off).\n');
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});

const COMPLEMENT_KEY = '!(*.{ts,tsx,mts}!(?)|*.md!(?))*';

interface GlobToRegexModule {
  readonly globToRegex: (glob: string, options: GlobToRegexOptions) => GlobToRegexResult;
}

interface GlobToRegexOptions {
  readonly extended: boolean;
  readonly globstar: boolean;
}

interface GlobToRegexResult {
  readonly regex: RegExp;
}

const SAMPLE_FILE = 'src/main.ts';

interface NanoStagedUtilsModule {
  readonly stringArgvToArray: (command: string) => string[];
}

async function getClaimingKeys(config: NanoStagedConfig, file: string): Promise<string[]> {
  const globToRegex = await loadGlobToRegex();
  return Object.keys(config).filter((pattern) => globToRegex(pattern, { extended: true, globstar: pattern.includes('/') }).regex.test(file));
}

async function importNanoStagedModule<T>(fileName: string): Promise<T> {
  const entryPath = fileURLToPath(import.meta.resolve('nano-staged'));
  return await import(pathToFileURL(join(dirname(entryPath), fileName)).href) as T;
}

/*
 * The compiler nano-staged itself uses, loaded from the installed package so the partition is pinned against
 * the dialect that actually runs. It is not in the package's `exports`, hence the path built off the entry.
 */
async function loadGlobToRegex(): Promise<GlobToRegexModule['globToRegex']> {
  const $module = await importNanoStagedModule<GlobToRegexModule>('glob-to-regex.js');
  return $module.globToRegex;
}

/*
 * The tokenizer nano-staged splits a function-valued task's commands with, loaded from the installed package
 * for the same reason as the glob compiler.
 */
async function loadStringArgvToArray(): Promise<NanoStagedUtilsModule['stringArgvToArray']> {
  const $module = await importNanoStagedModule<NanoStagedUtilsModule>('utils.js');
  return $module.stringArgvToArray;
}

/*
 * Every key is a function now, so a key's command list is read off a one-file run, with the file stripped
 * back off each command.
 */
function toCommandPrefixes(config: NanoStagedConfig): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(config).map(([pattern, task]) => [
      pattern,
      task({ filenames: [resolve(SAMPLE_FILE)] }).map((command) => command.slice(0, -` ${SAMPLE_FILE}`.length))
    ])
  );
}

describe('getNanoStagedConfig with additional writer tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockScripts(ALL_SCRIPTS);
    vi.stubEnv('NANO_STAGED', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return the shared config when the additional writer tasks are empty', () => {
    expect(getNanoStagedConfig({ additionalWriterTasks: {} })).toBe(obsidianDevUtilsConfig);
  });

  it('should re-partition spellcheck around an additional writer', async () => {
    const config = getNanoStagedConfig({ additionalWriterTasks: { '*.astro': ['npm run lint:fix --'] } });

    expect(toCommandPrefixes(config)).toEqual({
      '!(*.{ts,tsx,mts}!(?)|*.md!(?)|*.astro!(?))*': ['npm run spellcheck --'],
      '*.{ts,tsx,mts}': ['npm run lint:fix --', 'npm run format --', 'npm run spellcheck --'],
      '*.astro': ['npm run lint:fix --', 'npm run spellcheck --'],
      '*.md': ['npm run lint:md:fix --', 'npm run spellcheck --']
    });
    expect(await getClaimingKeys(config, 'docs/src/components/card.astro')).toEqual(['*.astro']);
    expect(await getClaimingKeys(config, 'package.json')).toEqual(['!(*.{ts,tsx,mts}!(?)|*.md!(?)|*.astro!(?))*']);
  });

  it('should reject an additional writer pattern containing a slash', () => {
    expect(() => getNanoStagedConfig({ additionalWriterTasks: { 'docs/*.astro': ['npm run lint:fix --'] } }))
      .toThrow('nano-staged writer pattern \'docs/*.astro\' contains \'/\'');
  });

  it('should reject an additional writer pattern that repeats a shared one', () => {
    expect(() => getNanoStagedConfig({ additionalWriterTasks: { '*.md': ['npm run other --'] } }))
      .toThrow('nano-staged writer pattern \'*.md\' is already a shared writer pattern.');
  });
});

describe('getNanoStagedConfig with scripts the project lacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    vi.stubEnv('NANO_STAGED', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should leave out a missing writer and drop a pattern left with none', async () => {
    mockScripts(['lint:fix', 'spellcheck']);
    const config = getNanoStagedConfig();

    expect(toCommandPrefixes(config)).toEqual({
      '!(*.{ts,tsx,mts}!(?))*': ['npm run spellcheck --'],
      '*.{ts,tsx,mts}': ['npm run lint:fix --', 'npm run spellcheck --']
    });
    expect(await getClaimingKeys(config, 'README.md')).toEqual(['!(*.{ts,tsx,mts}!(?))*']);
  });

  it('should run no spellcheck when the project has no spellcheck script', () => {
    mockScripts(['format', 'lint:fix', 'lint:md:fix']);

    expect(toCommandPrefixes(getNanoStagedConfig())).toEqual({
      '*.{ts,tsx,mts}': ['npm run lint:fix --', 'npm run format --'],
      '*.md': ['npm run lint:md:fix --']
    });
  });

  it.each(['src/main.ts', 'docs/guides/setup.md', 'LICENSE'])('should spellcheck %s when the project has only a spellcheck script', async (file) => {
    mockScripts(['spellcheck']);
    const config = getNanoStagedConfig();

    expect(toCommandPrefixes(config)).toEqual({
      '*': ['npm run spellcheck --']
    });
    expect(await getClaimingKeys(config, file)).toEqual(['*']);
  });

  it('should run nothing when the project has none of the scripts', () => {
    mockReadPackageJsonSync.mockReturnValue({});

    expect(getNanoStagedConfig()).toEqual({});
  });

  it('should keep an additional writer for a shared pattern whose shared writer is missing', () => {
    mockScripts(['format', 'lint:fix', 'spellcheck']);

    expect(toCommandPrefixes(getNanoStagedConfig({ additionalWriterTasks: { '*.md': ['npm run other --'] } }))).toEqual({
      '!(*.{ts,tsx,mts}!(?)|*.md!(?))*': ['npm run spellcheck --'],
      '*.{ts,tsx,mts}': ['npm run lint:fix --', 'npm run format --', 'npm run spellcheck --'],
      '*.md': ['npm run other --', 'npm run spellcheck --']
    });
  });
});

describe('obsidianDevUtilsConfig', () => {
  it('should run every task through npm when npm owns the tree', () => {
    expect(toCommandPrefixes(obsidianDevUtilsConfig)).toEqual({
      '*.{ts,tsx,mts}': ['npm run lint:fix --', 'npm run format --', 'npm run spellcheck --'],
      '*.md': ['npm run lint:md:fix --', 'npm run spellcheck --'],
      [COMPLEMENT_KEY]: ['npm run spellcheck --']
    });
  });

  /*
   * The overlap this pins. nano-staged runs its per-pattern groups under `Promise.all`, so a catch-all `'*'`
   * spellcheck key read a staged file while `lint:fix` / `format` / `lint:md:fix` rewrote it in place. Every
   * staged file must be claimed by EXACTLY one key, and a writer key must spellcheck last.
   */
  it.each([
    ['src/main.ts', '*.{ts,tsx,mts}'],
    ['src/a b/view.tsx', '*.{ts,tsx,mts}'],
    ['eslint.config.mts', '*.{ts,tsx,mts}'],
    ['README.md', '*.md'],
    ['docs/guides/setup.md', '*.md'],
    ['package.json', COMPLEMENT_KEY],
    ['notes.md.bak', COMPLEMENT_KEY],
    ['data.tsv', COMPLEMENT_KEY],
    ['dir.md/data.json', COMPLEMENT_KEY],
    ['.husky/pre-commit', COMPLEMENT_KEY],
    ['LICENSE', COMPLEMENT_KEY]
  ])('should claim %s by exactly one key, %s, as nano-staged compiles it', async (file, expectedKey) => {
    expect(await getClaimingKeys(obsidianDevUtilsConfig, file)).toEqual([expectedKey]);
  });

  it('should run every task through the package manager that owns the tree', async () => {
    /*
     * The prefix is baked in when the module is evaluated, so the manager can only be changed by
     * re-evaluating it. `mockReturnValueOnce` is consumed by that single re-evaluation and restores the
     * npm default on its own, leaving nothing to undo for the tests that follow.
     */
    mockGetPackageManagerRunCommand.mockReturnValueOnce(['bun', 'run']);
    vi.resetModules();

    const { obsidianDevUtilsConfig: bunConfig } = await import('./nano-staged-config.ts');

    expect(toCommandPrefixes(bunConfig)).toEqual({
      '*.{ts,tsx,mts}': ['bun run lint:fix --', 'bun run format --', 'bun run spellcheck --'],
      '*.md': ['bun run lint:md:fix --', 'bun run spellcheck --'],
      [COMPLEMENT_KEY]: ['bun run spellcheck --']
    });
  });

  /*
   * The regression this pins. An earlier `templates/` exclusion moved `lint:fix` onto a key of its own,
   * `!(templates)*.{ts,tsx,mts}`, which silently took the ordering away: nano-staged runs its per-pattern
   * groups under `Promise.all` and sequences only the commands inside a single key's array, so the two
   * writers of one file raced and whichever finished last won.
   */
  it('should keep both file-rewriting tasks under one key, in order', () => {
    const keysRewritingTypeScript = Object.entries(toCommandPrefixes(obsidianDevUtilsConfig))
      .filter(([, commands]) => commands.some((command) => command.includes('lint:fix') || command.includes(' format ')))
      .map(([key]) => key);

    expect(keysRewritingTypeScript).toEqual(['*.{ts,tsx,mts}']);
    expect(toCommandPrefixes(obsidianDevUtilsConfig)['*.{ts,tsx,mts}']).toEqual([
      'npm run lint:fix --',
      'npm run format --',
      'npm run spellcheck --'
    ]);
  });
});

describe('batched tasks', () => {
  const TYPE_SCRIPT_KEY = '*.{ts,tsx,mts}';
  const STAGED_FILE_COUNT = 2000;

  /*
   * The defect this pins. A string task appends every staged path to ONE command, so a commit staging 342
   * `.ts` files ran `npm run lint:fix -- <342 paths>` and failed on Windows with `The command line is too
   * long.`. 2000 paths of ~100 characters overflow the POSIX budget too, so this splits on every platform.
   */
  it('should run every command over every staged file, in batches that each fit the command line', () => {
    const relativePaths = Array.from(
      { length: STAGED_FILE_COUNT },
      (_, index) => `src/some/deeply/nested/folder/for/a/whole/repository/sweep/module-number-${String(index).padStart(5, '0')}.ts`
    );
    const task = obsidianDevUtilsConfig[TYPE_SCRIPT_KEY];
    if (!task) {
      throw new Error(`Missing ${TYPE_SCRIPT_KEY} key`);
    }

    const commands = task({ filenames: relativePaths.map((relativePath) => resolve(relativePath)) });

    const prefixes = ['npm run lint:fix --', 'npm run format --', 'npm run spellcheck --'];
    const budget = getMaxBatchCommandLength() - 260;
    let previousPrefixIndex = 0;
    for (const command of commands) {
      const prefixIndex = prefixes.findIndex((prefix) => command.startsWith(`${prefix} `));
      expect(prefixIndex).toBeGreaterThanOrEqual(previousPrefixIndex);
      previousPrefixIndex = prefixIndex;
      const quoted = command.split(' ').map((token, index) => index < 4 ? token : `"${token}"`).join(' ');
      expect(getEffectiveCommandLineLength(quoted)).toBeLessThanOrEqual(budget + getEffectiveCommandLineLength(''));
    }

    for (const prefix of prefixes) {
      const prefixCommands = commands.filter((command) => command.startsWith(`${prefix} `));
      expect(prefixCommands.length).toBeGreaterThan(1);
      expect(prefixCommands.flatMap((command) => command.slice(prefix.length + 1).split(' '))).toEqual(relativePaths);
    }
  });

  it('should run nothing when no staged file is claimed', () => {
    expect(obsidianDevUtilsConfig[TYPE_SCRIPT_KEY]?.({ filenames: [] })).toEqual([]);
  });

  it('should keep a path outside the working directory absolute and protect one that looks like an option', () => {
    const outsidePath = resolve('..', 'elsewhere', 'outside.ts');
    const commands = obsidianDevUtilsConfig[TYPE_SCRIPT_KEY]?.({ filenames: [outsidePath, resolve('-dash.ts')] });

    expect(commands?.[0]).toBe(`npm run lint:fix -- ${outsidePath.replaceAll('\\', '/')} ./-dash.ts`);
  });

  /*
   * A function-valued task's commands are split by nano-staged's own tokenizer, which emits a quoted token
   * twice and has no escape. So each argument must come back out of it as exactly one token, and a path with
   * a space or a quote goes in as a `?` glob that still names the file.
   */
  it('should hand every path through nano-staged\'s tokenizer as exactly one argument', async () => {
    const stringArgvToArray = await loadStringArgvToArray();
    const commands = obsidianDevUtilsConfig[TYPE_SCRIPT_KEY]?.({
      filenames: [resolve('src/a b/view.tsx'), resolve('src/it\'s "quoted".ts'), resolve('src/main.ts')]
    }) ?? [];

    expect(commands.map((command) => stringArgvToArray(command))).toEqual([
      ['npm', 'run', 'lint:fix', '--', 'src/a?b/view.tsx', 'src/it?s??quoted?.ts', 'src/main.ts'],
      ['npm', 'run', 'format', '--', 'src/a?b/view.tsx', 'src/it?s??quoted?.ts', 'src/main.ts'],
      ['npm', 'run', 'spellcheck', '--', 'src/a?b/view.tsx', 'src/it?s??quoted?.ts', 'src/main.ts']
    ]);
  });
});
