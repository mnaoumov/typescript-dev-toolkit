import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  PackSmokeCommandResult,
  PackSmokeDependencies,
  SmokePackOptions
} from './pack-smoke.ts';

import { exec } from './exec.ts';
import {
  createNodePackSmokeDependencies,
  smokePack
} from './pack-smoke.ts';

vi.mock('./exec.ts', () => ({ exec: vi.fn() }));

interface FakeDependencies extends PackSmokeDependencies {
  readonly commands: string[];
  readonly lines: string[];
}

interface FakeNpm {
  /**
   * What `npm explain` prints, by package name. A name not listed prints nothing.
   */
  readonly explainOutputs?: ReadonlyMap<string, string>;

  /**
   * The files of the installed package, by path relative to its folder.
   */
  readonly files: ReadonlyMap<string, string>;

  /**
   * The exit code of `npm install`.
   */
  readonly installExitCode?: number;

  /**
   * Whether `npm install` records the package in the smoke project.
   */
  readonly installRecordsDependency?: boolean;

  /**
   * The bins the install links into `node_modules/.bin`.
   */
  readonly linkedBins?: readonly string[];

  /**
   * Other packages the install puts into `node_modules`.
   */
  readonly otherInstalledPackages?: readonly string[];

  /**
   * The installed package's `package.json`.
   */
  readonly packageJson: FixturePackageJson;

  /**
   * The exit code of `npm pack`.
   */
  readonly packExitCode?: number;

  /**
   * The exit code a probe run gets instead of running, when set.
   */
  readonly probeExitCode?: number;
}

// The installed package's `package.json`, written as given.
interface FixturePackageJson {
  readonly bin?: unknown;
  readonly exports?: unknown;
  readonly main?: string;
  readonly name: string;
  readonly peerDependenciesMeta?: unknown;
}

interface SmokeOutcome {
  readonly error: Error | null;
  readonly fake: FakeDependencies;
}

const ESM_OK = 'export const ok = true;\n';
const CJS_OK = 'exports.ok = true;\n';
const DECLARATION = 'export declare const ok: boolean;\n';

let projectFolder = '';

beforeEach(() => {
  projectFolder = mkdtempSync(join(tmpdir(), 'pack-smoke-test-'));
});

afterEach(() => {
  rmSync(projectFolder, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function createFake(npm: FakeNpm): FakeDependencies {
  const commands: string[] = [];
  const lines: string[] = [];
  const packageName = npm.packageJson.name;

  return {
    commands,
    lines,
    log(text): void {
      lines.push(text);
    },
    async run(command, cwd): Promise<PackSmokeCommandResult> {
      await noopAsync();
      commands.push(command.join(' '));
      const [file, subcommand, ...rest] = command;
      if (file === 'node') {
        if (npm.probeExitCode !== undefined && (subcommand ?? '').endsWith('pack-smoke-probe.mjs')) {
          return { exitCode: npm.probeExitCode, stderr: 'probe died\nat somewhere', stdout: '' };
        }
        const result = spawnSync('node', command.slice(1), { cwd, encoding: 'utf-8' });
        return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout };
      }

      switch (subcommand) {
        case 'explain': {
          return { exitCode: 0, stderr: '', stdout: npm.explainOutputs?.get(rest[0] ?? '') ?? '' };
        }
        case 'install': {
          return install(npm, cwd, packageName);
        }
        case 'pack': {
          return {
            exitCode: npm.packExitCode ?? 0,
            stderr: 'pack went wrong',
            stdout: `> fixture@1.0.0 prepare\n${JSON.stringify({ [packageName]: { filename: 'fixture-1.0.0.tgz' } })}`
          };
        }
        default: {
          throw new Error(`Unexpected command: ${command.join(' ')}`);
        }
      }
    }
  };
}

function install(npm: FakeNpm, cwd: string, packageName: string): PackSmokeCommandResult {
  if (npm.installExitCode !== undefined) {
    return { exitCode: npm.installExitCode, stderr: 'no matching version', stdout: '' };
  }

  const packageFolder = join(cwd, 'node_modules', packageName);
  writeTree(packageFolder, new Map([...npm.files, ['package.json', String(JSON.stringify(npm.packageJson))]]));
  for (const bin of npm.linkedBins ?? []) {
    writeTree(join(cwd, 'node_modules', '.bin'), new Map([[bin, '']]));
  }
  for (const other of npm.otherInstalledPackages ?? []) {
    writeTree(join(cwd, 'node_modules', other), new Map([['package.json', String(JSON.stringify({ name: other }))]]));
  }
  if (npm.installRecordsDependency ?? true) {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { [packageName]: 'file:x.tgz' }, name: 'pack-smoke' }));
  }
  return { exitCode: 0, stderr: '', stdout: '' };
}

async function runSmoke(npm: FakeNpm, options: SmokePackOptions = {}): Promise<SmokeOutcome> {
  const fake = createFake(npm);
  try {
    await smokePack({ ...options, dependencies: fake, projectFolder });
    return { error: null, fake };
  } catch (error) {
    return { error: error as Error, fake };
  }
}

function writeTree(root: string, files: ReadonlyMap<string, string>): void {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

describe('smokePack', () => {
  it('passes a package whose modules load both ways, whose bins answer --help, and accepts a listed optional peer', async () => {
    const { error, fake } = await runSmoke(
      {
        explainOutputs: new Map([['yaml', JSON.stringify([{ dependents: [{ from: { name: 'cspell-config-lib' }, type: 'prod' }, { from: {}, type: 'peerOptional' }] }])]]),
        files: new Map([
          ['bin/tool.mjs', 'process.exitCode = process.argv.includes(\'--help\') ? 0 : 3;\n'],
          // Each runtime file carries types beside it, which TypeScript finds by swapping the extension.
          ['cjs/index.cjs', CJS_OK],
          ['cjs/index.d.cts', DECLARATION],
          ['cjs/nested/deep.cjs', CJS_OK],
          ['cjs/nested/deep.d.cts', DECLARATION],
          ['esm/index.d.mts', DECLARATION],
          ['esm/index.mjs', ESM_OK],
          ['esm/nested/deep.d.mts', DECLARATION],
          ['esm/nested/deep.mjs', ESM_OK]
        ]),
        linkedBins: ['tool'],
        otherInstalledPackages: ['yaml'],
        packageJson: {
          bin: { tool: './bin/tool.mjs' },
          exports: {
            '.': { import: { default: './esm/index.mjs', types: './esm/index.d.mts' }, require: './cjs/index.cjs' },
            './*': { import: './esm/*.mjs', require: './cjs/*.cjs' },
            './types/*': { types: './esm/*.d.mts' }
          },
          name: '@scope/fixture',
          peerDependenciesMeta: { vitest: { optional: true }, yaml: { optional: true } }
        }
      },
      { installedOptionalPeers: [{ name: 'yaml', reason: 'a dependency needs it' }] }
    );

    expect(error).toBeNull();
    expect(fake.lines).toEqual([
      `pack smoke: packing ${projectFolder}`,
      expect.stringMatching(/^pack smoke: installing .*fixture-1\.0\.0\.tgz$/) as unknown,
      'pack smoke: the optional peer yaml is installed by cspell-config-lib (prod), the project (peerOptional), accepted: a dependency needs it',
      // `.` and `./index` name one file, so it is loaded once.
      'pack smoke: imported 2 module(s), 0 of them peer-bound and stopped by a missing optional peer',
      'pack smoke: required 2 module(s), 0 of them peer-bound and stopped by a missing optional peer',
      'pack smoke: type-checked the imports of 2 under node16 ESM, 2 under node16 CJS, 2 under bundler',
      'pack smoke: running tool --help',
      'pack smoke: @scope/fixture passed'
    ]);
    expect(fake.commands.filter((command) => command.includes('pack-smoke-probe.mjs')).map((command) => command.split(' ', 3)[2])).toEqual(['esm', 'cjs']);
  });

  it('lets a peer-bound module fail only on a missing optional peer, scoped or not', async () => {
    const { error, fake } = await runSmoke(
      {
        files: new Map([
          ['cjs/index.cjs', 'require(\'@opt/scoped/sub\');\n'],
          ['cjs/site/page.cjs', 'require(\'opt-peer\');\n'],
          ['esm/index.mjs', 'import \'@opt/scoped/sub\';\n'],
          ['esm/site/page.mjs', 'import \'opt-peer\';\n']
        ]),
        packageJson: {
          exports: { '.': { import: './esm/index.mjs', require: './cjs/index.cjs' }, './*': { import: './esm/*.mjs', require: './cjs/*.cjs' } },
          name: 'fixture',
          peerDependenciesMeta: { '@opt/scoped': { optional: true }, 'not-optional': { optional: false }, 'opt-peer': { optional: true } }
        }
      },
      { peerBoundModules: ['.', 'site/**'] }
    );

    expect(error).toBeNull();
    expect(fake.lines).toContain('pack smoke: imported 2 module(s), 2 of them peer-bound and stopped by a missing optional peer');
    expect(fake.lines).toContain('pack smoke: required 2 module(s), 2 of them peer-bound and stopped by a missing optional peer');
  });

  it('lets any module fail only on a missing host-provided package, installed as types only or absent', async () => {
    const { error, fake } = await runSmoke(
      {
        files: new Map([
          ['cjs/editor.cjs', 'require(\'@codemirror/view\');\n'],
          ['cjs/index.cjs', 'require(\'obsidian\');\n'],
          ['cjs/plain.cjs', CJS_OK],
          ['esm/editor.mjs', 'import \'@codemirror/view\';\n'],
          ['esm/index.mjs', 'import \'obsidian\';\n'],
          ['esm/plain.mjs', ESM_OK]
        ]),
        // `obsidian` is installed with no `main` and no `index.js`, as its npm package is; `@codemirror/view` is absent.
        otherInstalledPackages: ['obsidian'],
        packageJson: {
          exports: { '.': { import: './esm/index.mjs', require: './cjs/index.cjs' }, './*': { import: './esm/*.mjs', require: './cjs/*.cjs' } },
          name: 'fixture'
        }
      },
      { hostProvidedPackages: ['obsidian', '@codemirror/*'], shouldCheckTypes: false }
    );

    expect(error).toBeNull();
    expect(fake.lines).toContain('pack smoke: imported 3 module(s), 0 of them peer-bound and stopped by a missing optional peer, 2 stopped by a host-provided package');
    expect(fake.lines).toContain('pack smoke: required 3 module(s), 0 of them peer-bound and stopped by a missing optional peer, 2 stopped by a host-provided package');
  });

  it('still fails any other failure of a module, and a host-provided glob that stopped nothing', async () => {
    const { error } = await runSmoke(
      {
        files: new Map([
          ['cjs/other.cjs', 'require(\'left-pad\');\n'],
          ['esm/other.mjs', 'import \'left-pad\';\n']
        ]),
        packageJson: { exports: { './*': { import: './esm/*.mjs', require: './cjs/*.cjs' } }, name: 'fixture' }
      },
      { hostProvidedPackages: ['obsidian', '@lezer/*'], shouldCheckTypes: false }
    );

    expect(error?.message.split('\n')).toEqual([
      'The pack smoke found 4 problem(s):',
      expect.stringMatching(/^- import fixture\/other: ERR_MODULE_NOT_FOUND Cannot find package 'left-pad' imported from \S+other\.mjs$/) as unknown,
      '- require fixture/other: MODULE_NOT_FOUND Cannot find module \'left-pad\'',
      '- hostProvidedPackages: obsidian stopped no module from loading; drop it from the list',
      '- hostProvidedPackages: @lezer/* stopped no module from loading; drop it from the list'
    ]);
  });

  it('matches a peer-bound glob against every subpath that names a module, not only the one it is loaded as', async () => {
    const { error, fake } = await runSmoke(
      {
        files: new Map([['esm/site/index.mjs', 'import \'opt-peer\';\n']]),
        packageJson: {
          // `./*` comes first, so the module is loaded as `site/index`; the glob names its other subpath, `site`.
          exports: { './*': { import: './esm/*.mjs' }, './site': { import: './esm/site/index.mjs' } },
          name: 'fixture',
          peerDependenciesMeta: { 'opt-peer': { optional: true } }
        }
      },
      { peerBoundModules: ['site'] }
    );

    expect(error).toBeNull();
    expect(fake.lines).toContain('pack smoke: imported 1 module(s), 1 of them peer-bound and stopped by a missing optional peer');
  });

  it('reports every problem it finds, each on its own line', async () => {
    const { error } = await runSmoke(
      {
        explainOutputs: new Map([['prettier', '[]'], ['vitest', 'npm error not json']]),
        files: new Map([
          ['bin/loud.mjs', 'console.log(\'only stdout\\nsecond line\'); process.exitCode = 2;\n'],
          ['bin/quiet.mjs', 'console.error(\'unknown argument\'); process.exitCode = 1;\n'],
          ['cjs/broken.cjs', 'throw new Error(\'boom\\nstack\');\n'],
          ['cjs/needs-other.cjs', 'require(\'left-pad\');\n'],
          ['cjs/needs-peer.cjs', 'require(\'opt-peer\');\n'],
          ['esm/broken.mjs', 'throw new Error(\'boom\');\n'],
          ['esm/needs-other.mjs', 'import \'left-pad\';\n'],
          ['esm/needs-peer.mjs', 'import \'opt-peer\';\n']
        ]),
        linkedBins: ['loud', 'quiet'],
        otherInstalledPackages: ['prettier', 'vitest'],
        packageJson: {
          bin: { loud: './bin/loud.mjs', quiet: './bin/quiet.mjs', unlinked: './bin/loud.mjs' },
          exports: { './*': { import: './esm/*.mjs', require: './cjs/*.cjs' } },
          name: 'fixture',
          peerDependenciesMeta: { 'jest': { optional: true }, 'opt-peer': { optional: true }, 'prettier': { optional: true }, 'vitest': { optional: true } }
        }
      },
      {
        bins: [{ arguments: ['--version'], expectedExitCode: 0, name: 'quiet' }, { name: 'ghost' }],
        installedOptionalPeers: [{ name: 'jest', reason: 'stale' }, { name: 'typescript', reason: 'not a peer' }],
        peerBoundModules: ['needs-other', 'nothing/**']
      }
    );

    const peerHint = ' (it needs the optional peer opt-peer; list the module in peerBoundModules if that is its job)';
    expect(error?.message.split('\n')).toEqual([
      'The pack smoke found 15 problem(s):',
      '- installedOptionalPeers: typescript is not an optional peer of the package',
      '- installedOptionalPeers: jest is no longer installed; drop it from the list',
      // `npm explain` named no dependents, or printed no JSON, so none are named.
      '- the optional peer prettier was installed with the package',
      '- the optional peer vitest was installed with the package',
      // An error with no code shows its message alone, first line only.
      '- import fixture/broken: boom',
      // A peer-bound module still fails on a package that is not an optional peer.
      expect.stringMatching(/^- import fixture\/needs-other: ERR_MODULE_NOT_FOUND Cannot find package 'left-pad' imported from \S+needs-other\.mjs$/) as unknown,
      expect.stringMatching(new RegExp(String.raw`^- import fixture/needs-peer: ERR_MODULE_NOT_FOUND Cannot find package 'opt-peer' imported from \S+needs-peer\.mjs${escapeRegExp(peerHint)}$`)) as unknown,
      '- require fixture/broken: boom',
      '- require fixture/needs-other: MODULE_NOT_FOUND Cannot find module \'left-pad\'',
      `- require fixture/needs-peer: MODULE_NOT_FOUND Cannot find module 'opt-peer'${peerHint}`,
      '- peerBoundModules: nothing/** names no exported module',
      '- bin ghost: configured, but the package declares no such bin',
      '- bin loud --help: exited 2, expected 0: only stdout',
      '- bin quiet --version: exited 1, expected 0: unknown argument',
      '- bin unlinked: the install linked no node_modules/.bin/unlinked'
    ]);
  });

  it.each([
    { name: 'a main without exports', packageJson: { main: './lib/main.js' } },
    { name: 'neither exports nor main, which is index.js', packageJson: {} },
    { name: 'exports as a string', packageJson: { exports: './lib/main.js' } },
    { name: 'exports as a fallback array', packageJson: { exports: [null, './lib/main.js'] } },
    // Condition order matters: `import` resolves to nothing for ESM (types only), so `node` is taken next.
    { name: 'exports as conditions only', packageJson: { exports: { browser: './nowhere.js', import: { types: './x.d.ts' }, node: './lib/main.js' } } },
    {
      name: 'exports with unresolvable entries and two subpaths naming one file',
      packageJson: {
        exports: {
          '.': './lib/main.js',
          './gone/*': './gone/*.js',
          './never': [null],
          './same': { node: { default: './lib/main.js' } },
          './types/*': { types: './types/*.d.ts' }
        }
      }
    }
  ])('loads the one module of a package with $name', async ({ packageJson }) => {
    const { error, fake } = await runSmoke({
      files: new Map([['index.js', CJS_OK], ['lib/main.js', CJS_OK]]),
      packageJson: { name: '@scope/shapes', ...packageJson }
    });

    expect(error).toBeNull();
    expect(fake.lines).toContain('pack smoke: imported 1 module(s), 0 of them peer-bound and stopped by a missing optional peer');
    expect(fake.lines).toContain('pack smoke: required 1 module(s), 0 of them peer-bound and stopped by a missing optional peer');
  });

  it('says when the package ships no declarations, and checks no types when told not to', async () => {
    const npm: FakeNpm = { files: new Map([['index.js', CJS_OK]]), packageJson: { name: 'fixture' } };
    const untyped = await runSmoke(npm);
    expect(untyped.error).toBeNull();
    expect(untyped.fake.lines).toContain('pack smoke: the package ships no type declarations, so no types were checked');

    const unchecked = await runSmoke(npm, { shouldCheckTypes: false });
    expect(unchecked.error).toBeNull();
    expect(unchecked.fake.lines.filter((line) => line.includes('type'))).toEqual([]);
  });

  it('reports a module whose types a consumer cannot resolve', async () => {
    const { error } = await runSmoke({
      files: new Map([['esm/index.d.mts', DECLARATION], ['esm/index.mjs', ESM_OK], ['esm/other.mjs', ESM_OK]]),
      packageJson: { exports: { './*': { import: './esm/*.mjs' } }, name: 'fixture' }
    });

    expect(error?.message.split('\n')).toEqual([
      'The pack smoke found 2 problem(s):',
      expect.stringMatching(/^- types node16 ESM fixture\/other: TS7016 /) as unknown,
      expect.stringMatching(/^- types bundler fixture\/other: TS7016 /) as unknown
    ]);
  });

  it('runs a string bin under the unscoped package name', async () => {
    const { error, fake } = await runSmoke({
      files: new Map([['bin.mjs', ''], ['index.js', CJS_OK]]),
      linkedBins: ['tool'],
      packageJson: { bin: './bin.mjs', name: '@scope/tool' }
    });

    expect(error).toBeNull();
    expect(fake.lines).toContain('pack smoke: running tool --help');
  });

  it('stops when npm pack fails', async () => {
    const { error, fake } = await runSmoke({ files: new Map(), packageJson: { name: 'fixture' }, packExitCode: 1 });

    expect(error?.message).toBe('npm pack failed with exit code 1:\npack went wrong');
    expect(fake.commands).toHaveLength(1);
  });

  it('stops when npm install fails, or records no dependency', async () => {
    const failedInstall = await runSmoke({ files: new Map(), installExitCode: 1, packageJson: { name: 'fixture' } });
    expect(failedInstall.error?.message).toBe(
      'npm install of the tarball failed with exit code 1:\nno matching version'
    );
    const unrecordedInstall = await runSmoke({ files: new Map(), installRecordsDependency: false, packageJson: { name: 'fixture' } });
    expect(unrecordedInstall.error?.message).toBe(
      'npm install recorded no dependency in the smoke project'
    );
  });

  it('reports a probe that crashed instead of reporting', async () => {
    const { error } = await runSmoke({ files: new Map([['index.js', CJS_OK]]), packageJson: { name: 'fixture' }, probeExitCode: 1 });

    expect(error?.message.split('\n')).toEqual([
      'The pack smoke found 2 problem(s):',
      '- the esm probe crashed with exit code 1: probe died',
      '- the cjs probe crashed with exit code 1: probe died'
    ]);
  });

  it('packs the current folder through the real outside world when given neither', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(projectFolder);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, exitSignal: null, stderr: 'no package.json', stdout: '' });

    await expect(smokePack()).rejects.toThrow('npm pack failed with exit code 1:\nno package.json');
    expect(process.stdout.write).toHaveBeenCalledWith(`pack smoke: packing ${projectFolder}\n`);
    expect(exec).toHaveBeenCalledWith(['npm', 'pack', '--json', '--pack-destination', expect.stringContaining('pack-smoke-') as unknown], {
      cwd: projectFolder,
      isQuiet: true,
      shouldIgnoreExitCode: true,
      shouldIncludeDetails: true
    });
  });

  it('removes its temporary folder whatever the outcome', async () => {
    const fake = createFake({ files: new Map(), packageJson: { name: 'fixture' }, packExitCode: 1 });
    await expect(smokePack({ dependencies: fake, projectFolder })).rejects.toThrow('npm pack failed');

    const temporaryFolder = ensureTemporaryFolder(fake.commands[0] ?? '');
    expect(() => readFileSync(temporaryFolder)).toThrow(/ENOENT/);
  });
});

describe('createNodePackSmokeDependencies', () => {
  it('reports the result of a command without throwing on its exit code', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 2, exitSignal: null, stderr: 'err', stdout: 'out' });

    expect(await createNodePackSmokeDependencies().run(['node', '-v'], projectFolder)).toEqual({ exitCode: 2, stderr: 'err', stdout: 'out' });
  });
});

function ensureTemporaryFolder(packCommand: string): string {
  const folder = packCommand.split(' ').at(-1);
  if (!folder?.includes('pack-smoke-')) {
    throw new Error(`No temporary folder in: ${packCommand}`);
  }
  return folder;
}
