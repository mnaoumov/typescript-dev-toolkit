/**
 * @file
 *
 * Packs the package, installs the tarball into an empty project and uses it the way a consumer would: every exported
 * module is imported in one ES module process and required in another CommonJS one, a consumer's TypeScript resolves
 * the types of each (`pack-smoke-types.ts`), and every bin is run.
 *
 * It catches what the build's own checks cannot see from inside the repository: a file the `files` list leaves out of
 * the tarball, an `exports` entry naming a file that is not there, a module that needs an optional peer it was meant to
 * load lazily, a dependency that brings an optional peer into every install, and a bin that does not start.
 * `validateDependencies` and `validateBuiltSyntax` read the output as text; this loads it.
 */

import type { PackageJson } from 'type-fest';

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  join,
  posix,
  relative
} from 'node:path';
import process from 'node:process';

import type { PackSmokeTypedModule } from './pack-smoke-types.ts';

import { exec } from './exec.ts';
import { parseNpmPackOutput } from './npm-pack.ts';
import { typeCheckPackSmokeImports } from './pack-smoke-types.ts';

/**
 * How one bin is run by {@link smokePack}.
 */
export interface BinSmokeCheck {
  /**
   * The arguments the bin is run with.
   *
   * @default `['--help']`
   */
  readonly arguments?: readonly string[];

  /**
   * The exit code the run must end with.
   *
   * @default `0`
   */
  readonly expectedExitCode?: number;

  /**
   * The bin's name, as the package's `bin` field declares it.
   */
  readonly name: string;
}

/**
 * An optional peer that a dependency of the package installs anyway, so {@link smokePack} accepts finding it.
 */
export interface InstalledOptionalPeer {
  /**
   * The peer's package name.
   */
  readonly name: string;

  /**
   * Why it is installed and cannot be avoided, printed with the note.
   */
  readonly reason: string;
}

/**
 * The outcome of one command {@link PackSmokeDependencies.run} ran.
 */
export interface PackSmokeCommandResult {
  /**
   * The exit code, or `null` when the process did not exit on its own.
   */
  readonly exitCode: null | number;

  /**
   * What the command wrote to stderr.
   */
  readonly stderr: string;

  /**
   * What the command wrote to stdout.
   */
  readonly stdout: string;
}

/**
 * The outside world {@link smokePack} works through.
 */
export interface PackSmokeDependencies {
  /**
   * Reports progress.
   *
   * @param text - The line to report.
   */
  readonly log: (text: string) => void;

  /**
   * Runs a command to the end without throwing on its exit code.
   *
   * @param command - The command and its arguments.
   * @param cwd - The folder to run it in.
   * @returns The result.
   */
  readonly run: (command: readonly string[], cwd: string) => Promise<PackSmokeCommandResult>;
}

/**
 * Options for {@link smokePack}.
 */
export interface SmokePackOptions {
  /**
   * How the bins are run. A bin not listed here is run with `--help` and must exit `0`. An entry naming a bin the
   * package does not declare is a failure.
   *
   * @default `[]`
   */
  readonly bins?: readonly BinSmokeCheck[];

  /**
   * The outside world. The real one when omitted.
   */
  readonly dependencies?: PackSmokeDependencies;

  /**
   * Globs over package names (`obsidian`, `@codemirror/*`) naming the packages the host application supplies at runtime,
   * whose npm package therefore cannot be loaded outside it (types only, no `main`). Any exported module may fail to
   * load, but only because a listed package is missing; any other failure still fails the smoke. Such modules are
   * counted in the summary line. A glob that stopped no module from loading is a failure, so the list cannot go stale.
   * The type check is unaffected, because such a package ships its declarations.
   *
   * @default `[]`
   */
  readonly hostProvidedPackages?: readonly string[];

  /**
   * Optional peers a dependency installs anyway, which are reported instead of failing the smoke. One that is no longer
   * installed is a failure, so the list cannot go stale.
   *
   * @default `[]`
   */
  readonly installedOptionalPeers?: readonly InstalledOptionalPeer[];

  /**
   * Globs over exported subpaths (`.` for the package root, `docs-site/api-docs` for
   * `<package>/docs-site/api-docs`) naming the modules whose whole job needs an optional peer. Such a module may fail
   * to load, but only because an optional peer is missing; any other failure still fails the smoke. A glob that names
   * no exported module is a failure.
   *
   * @default `[]`
   */
  readonly peerBoundModules?: readonly string[];

  /**
   * The package folder to pack.
   *
   * @default the current working folder
   */
  readonly projectFolder?: string;

  /**
   * Whether a consumer's TypeScript must resolve the types of every exported module through `exports`, under `node16`
   * from an ES module file and from a CommonJS file and under `bundler`, in the module format Node loads. A package that
   * ships no declarations at all is reported and not checked.
   *
   * @default `true`
   */
  readonly shouldCheckTypes?: boolean;
}

interface CheckBinsParams {
  readonly installedRoot: string;
  readonly packageJson: InstalledPackageJson;
  readonly packageName: string;
}

interface CheckModulesParams {
  readonly installedRoot: string;
  readonly optionalPeers: readonly string[];
  readonly packageJson: InstalledPackageJson;
  readonly packageName: string;
}

// One module file, loaded once under its first subpath. Every subpath naming it is kept, because a peer-bound glob may
// name any of them: `./docs-site` and `./*` both name `docs-site/index`.
interface ExportedModule {
  readonly filePath: string;
  readonly specifier: string;
  readonly subpaths: string[];
}

type ExportsValue = PackageJson.Exports;

type FailureVerdict = 'host-provided' | 'peer-bound' | 'problem';

// The part of the installed `package.json` read here.
interface InstalledPackageJson {
  readonly bin?: Readonly<Record<string, string>> | string;
  readonly exports?: ExportsValue;
  readonly main?: string;
  readonly peerDependenciesMeta?: Readonly<Record<string, PeerDependencyMeta>>;
  readonly type?: string;
}

interface JudgeFailureParams {
  readonly exportedModule: ExportedModule;
  readonly failure: LoadFailure;
  readonly format: ModuleFormat;
  readonly optionalPeers: readonly string[];
  readonly usedHostPatterns: Set<string>;
}

interface ListExportedModulesParams {
  readonly format: ModuleFormat;
  readonly installedRoot: string;
  readonly packageJson: InstalledPackageJson;
  readonly packageName: string;
}

interface LoadFailure {
  readonly code: string;
  readonly message: string;
  readonly specifier: string;
}

type ModuleFormat = 'cjs' | 'esm';

// One dependent edge of `npm explain --json`.
interface NpmExplainDependent {
  readonly from: NpmExplainDependentSource;
  readonly type: string;
}

// A dependent's `from` has no `name` when it is the smoke project itself.
interface NpmExplainDependentSource {
  readonly name?: string;
}

// The part of one `npm explain --json` node read here.
interface NpmExplainNode {
  readonly dependents: readonly NpmExplainDependent[];
}

interface PackSmokeConstructorParams {
  readonly bins: readonly BinSmokeCheck[];
  readonly dependencies: PackSmokeDependencies;
  readonly hostProvidedPackages: readonly string[];
  readonly installedOptionalPeers: readonly InstalledOptionalPeer[];
  readonly peerBoundModules: readonly string[];
  readonly projectFolder: string;
  readonly shouldCheckTypes: boolean;
  readonly temporaryFolder: string;
}

interface PeerDependencyMeta {
  readonly optional?: boolean;
}

// The smoke project's `package.json` after the install, which records the tarball's package under its name.
interface SmokeProjectPackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
}

const CONDITIONS_BY_FORMAT: Readonly<Record<ModuleFormat, ReadonlySet<string>>> = {
  cjs: new Set(['default', 'node', 'require']),
  esm: new Set(['default', 'import', 'node'])
};

const DEFAULT_BIN_ARGUMENTS: readonly string[] = ['--help'];

const JSON_INDENT = 2;

const MISSING_PACKAGE_REG_EXP = /Cannot find (?:module|package) '(?<specifier>[^']+)'/;

const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);

const NODE_MODULES_SEGMENT = '/node_modules/';

// A pattern target holds one `*`, which splits it into a prefix and a suffix.
const PATTERN_TARGET_PART_COUNT = 2;

// A scoped package name takes two segments of a specifier (`@scope/name/sub`), any other name one.
const SCOPED_NAME_SEGMENT_COUNT = 2;

// Windows can hold a file of the removed folder open for a moment after the probe exits.
const TEMPORARY_FOLDER_REMOVAL_RETRIES = 3;

// The probe runs in the smoke project, so a bare specifier resolves from its `node_modules` as a consumer's would.
// It writes its findings to a file, because a module may print to stdout while it loads, and it exits explicitly,
// because a module may leave a handle open.
const PROBE_SOURCE = `import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';

const [format, listPath, resultPath] = process.argv.slice(2);
const specifiers = JSON.parse(readFileSync(listPath, 'utf-8'));
const require = createRequire(import.meta.url);
const failures = [];
for (const specifier of specifiers) {
  try {
    if (format === 'esm') {
      await import(specifier);
    } else {
      require(specifier);
    }
  } catch (error) {
    failures.push({ code: String(error?.code ?? ''), message: String(error?.message ?? error), specifier });
  }
}
writeFileSync(resultPath, JSON.stringify(failures));
process.exit(0);
`;

class PackSmoke {
  private readonly bins: readonly BinSmokeCheck[];
  private readonly dependencies: PackSmokeDependencies;
  private readonly hostProvidedPackages: readonly string[];
  private readonly installedOptionalPeers: readonly InstalledOptionalPeer[];
  private readonly peerBoundModules: readonly string[];
  private readonly problems: string[] = [];
  private readonly projectFolder: string;
  private readonly shouldCheckTypes: boolean;
  private readonly smokeFolder: string;
  private readonly temporaryFolder: string;

  public constructor(params: PackSmokeConstructorParams) {
    this.bins = params.bins;
    this.dependencies = params.dependencies;
    this.hostProvidedPackages = params.hostProvidedPackages;
    this.installedOptionalPeers = params.installedOptionalPeers;
    this.peerBoundModules = params.peerBoundModules;
    this.projectFolder = params.projectFolder;
    this.shouldCheckTypes = params.shouldCheckTypes;
    this.temporaryFolder = params.temporaryFolder;
    this.smokeFolder = join(params.temporaryFolder, 'project');
  }

  public async run(): Promise<void> {
    const tarballPath = await this.pack();
    const packageName = await this.install(tarballPath);
    const installedRoot = join(this.smokeFolder, 'node_modules', packageName);
    const packageJson = await readJson<InstalledPackageJson>(join(installedRoot, 'package.json'));
    const optionalPeers = Object.entries(packageJson.peerDependenciesMeta ?? {}).filter(([, meta]) => meta.optional === true).map(([name]) => name);

    await this.checkOptionalPeers(optionalPeers);
    const modulesByFormat = await this.checkModules({ installedRoot, optionalPeers, packageJson, packageName });
    if (this.shouldCheckTypes) {
      await this.checkTypes(modulesByFormat, packageJson);
    }
    await this.checkBins({ installedRoot, packageJson, packageName });

    if (this.problems.length > 0) {
      throw new Error(`The pack smoke found ${String(this.problems.length)} problem(s):\n${this.problems.map((problem) => `- ${problem}`).join('\n')}`);
    }

    this.dependencies.log(`pack smoke: ${packageName} passed`);
  }

  private async checkBins(params: CheckBinsParams): Promise<void> {
    const { installedRoot, packageJson, packageName } = params;
    const declaredBins = typeof packageJson.bin === 'string' ? { [toUnscopedName(packageName)]: packageJson.bin } : packageJson.bin ?? {};
    for (const check of this.bins) {
      if (!Object.hasOwn(declaredBins, check.name)) {
        this.problems.push(`bin ${check.name}: configured, but the package declares no such bin`);
      }
    }

    for (const [name, path] of Object.entries(declaredBins)) {
      if (!existsSync(join(this.smokeFolder, 'node_modules', '.bin', name))) {
        this.problems.push(`bin ${name}: the install linked no node_modules/.bin/${name}`);
        continue;
      }

      const check = this.bins.find((candidate) => candidate.name === name);
      const binArguments = check?.arguments ?? DEFAULT_BIN_ARGUMENTS;
      const expectedExitCode = check?.expectedExitCode ?? 0;
      this.dependencies.log(`pack smoke: running ${name} ${binArguments.join(' ')}`);
      const result = await this.dependencies.run(['node', join(installedRoot, path), ...binArguments], this.smokeFolder);
      if (result.exitCode !== expectedExitCode) {
        this.problems.push(
          `bin ${name} ${binArguments.join(' ')}: exited ${String(result.exitCode)}, expected ${String(expectedExitCode)}: ${firstLine(result.stderr || result.stdout)}`
        );
      }
    }
  }

  // An exported `.json` file is data (a tsconfig preset a consumer names in `extends`, a schema), not a module: Node
  // refuses to import it without `with { type: 'json' }`, and TypeScript resolves it only under `resolveJsonModule`.
  // So it must be in the tarball and parse as JSON, and is neither loaded nor type-checked.
  private async checkJsonData(dataFiles: readonly ExportedModule[]): Promise<void> {
    for (const dataFile of dataFiles) {
      if (!existsSync(dataFile.filePath)) {
        this.problems.push(`data ${dataFile.specifier}: the tarball has no ${dataFile.filePath}`);
        continue;
      }

      try {
        JSON.parse(await readFile(dataFile.filePath, 'utf-8'));
      } catch (error) {
        this.problems.push(`data ${dataFile.specifier}: not valid JSON: ${firstLine((error as Error).message)}`);
      }
    }

    if (dataFiles.length > 0) {
      this.dependencies.log(`pack smoke: checked ${String(dataFiles.length)} exported JSON data file(s), which are not loaded as modules`);
    }
  }

  private async checkModules(params: CheckModulesParams): Promise<Readonly<Record<ModuleFormat, readonly ExportedModule[]>>> {
    const { installedRoot, optionalPeers, packageJson, packageName } = params;
    const matchedPatterns = new Set<string>();
    const usedHostPatterns = new Set<string>();
    const modulesByFormat: Record<ModuleFormat, readonly ExportedModule[]> = { cjs: [], esm: [] };
    const probePath = join(this.smokeFolder, 'pack-smoke-probe.mjs');
    await writeFile(probePath, PROBE_SOURCE, 'utf-8');

    const dataFiles = new Map<string, ExportedModule>();
    for (const format of ['esm', 'cjs'] as const) {
      const exported = await listExportedModules({ format, installedRoot, packageJson, packageName });
      const modules: ExportedModule[] = [];
      for (const exportedModule of exported) {
        if (isJsonData(exportedModule)) {
          // Both formats usually resolve a data subpath to one file, which is checked once.
          dataFiles.set(exportedModule.filePath, exportedModule);
        } else {
          modules.push(exportedModule);
        }
      }
      modulesByFormat[format] = modules;
      for (const exportedModule of modules) {
        for (const pattern of this.peerBoundModules) {
          if (isMatchedBy(exportedModule, pattern)) {
            matchedPatterns.add(pattern);
          }
        }
      }

      const probeFailures = await this.probe(probePath, format, modules);
      const failures = new Map(probeFailures.map((failure) => [failure.specifier, failure]));
      let allowedCount = 0;
      let hostBoundCount = 0;
      for (const exportedModule of modules) {
        const failure = failures.get(exportedModule.specifier);
        if (!failure) {
          continue;
        }

        const verdict = this.judgeFailure({ exportedModule, failure, format, optionalPeers, usedHostPatterns });
        if (verdict === 'host-provided') {
          hostBoundCount++;
        } else if (verdict === 'peer-bound') {
          allowedCount++;
        }
      }

      const hostClause = this.hostProvidedPackages.length === 0 ? '' : `, ${String(hostBoundCount)} stopped by a host-provided package`;
      this.dependencies.log(
        `pack smoke: ${format === 'esm' ? 'imported' : 'required'} ${String(modules.length)} module(s), ${String(allowedCount)} of them peer-bound and stopped by a missing optional peer${hostClause}`
      );
    }

    await this.checkJsonData([...dataFiles.values()]);

    for (const pattern of this.peerBoundModules) {
      if (!matchedPatterns.has(pattern)) {
        this.problems.push(`peerBoundModules: ${pattern} names no exported module`);
      }
    }

    for (const pattern of this.hostProvidedPackages) {
      if (!usedHostPatterns.has(pattern)) {
        this.problems.push(`hostProvidedPackages: ${pattern} stopped no module from loading; drop it from the list`);
      }
    }

    return modulesByFormat;
  }

  private async checkOptionalPeers(optionalPeers: readonly string[]): Promise<void> {
    for (const accepted of this.installedOptionalPeers) {
      if (!optionalPeers.includes(accepted.name)) {
        this.problems.push(`installedOptionalPeers: ${accepted.name} is not an optional peer of the package`);
      }
    }

    for (const name of optionalPeers) {
      const accepted = this.installedOptionalPeers.find((candidate) => candidate.name === name);
      const isInstalled = existsSync(join(this.smokeFolder, 'node_modules', name));
      if (!isInstalled) {
        if (accepted) {
          this.problems.push(`installedOptionalPeers: ${name} is no longer installed; drop it from the list`);
        }
        continue;
      }

      const dependents = await this.explain(name);
      if (accepted) {
        this.dependencies.log(`pack smoke: the optional peer ${name} is installed${dependents}, accepted: ${accepted.reason}`);
      } else {
        this.problems.push(`the optional peer ${name} was installed with the package${dependents}`);
      }
    }
  }

  private async checkTypes(modulesByFormat: Readonly<Record<ModuleFormat, readonly ExportedModule[]>>, packageJson: InstalledPackageJson): Promise<void> {
    function toTyped(format: ModuleFormat): PackSmokeTypedModule[] {
      return modulesByFormat[format].map((exportedModule) => ({ runtimeFile: exportedModule.filePath, specifier: exportedModule.specifier }));
    }

    const result = await typeCheckPackSmokeImports({
      cjsModules: toTyped('cjs'),
      esmModules: toTyped('esm'),
      packageType: packageJson.type,
      smokeFolder: this.smokeFolder
    });
    if (result.isUntyped) {
      this.dependencies.log('pack smoke: the package ships no type declarations, so no types were checked');
      return;
    }

    this.problems.push(...result.problems);
    this.dependencies.log(`pack smoke: type-checked the imports of ${result.summary}`);
  }

  private async explain(name: string): Promise<string> {
    const result = await this.dependencies.run(['npm', 'explain', name, '--json'], this.smokeFolder);
    try {
      const nodes = JSON.parse(result.stdout) as NpmExplainNode[];
      const dependents = nodes.flatMap((node) => node.dependents).map((dependent) => `${dependent.from.name ?? 'the project'} (${dependent.type})`);
      return dependents.length === 0 ? '' : ` by ${dependents.join(', ')}`;
    } catch {
      return '';
    }
  }

  // Returns the tarball's package name as npm recorded it in the smoke project, so a `name` the pack changed is what
  // gets checked.
  private async install(tarballPath: string): Promise<string> {
    await mkdir(this.smokeFolder);
    const smokePackageJson = { name: 'pack-smoke', private: true, version: '0.0.0' };
    await writeFile(join(this.smokeFolder, 'package.json'), `${JSON.stringify(smokePackageJson, null, JSON_INDENT)}\n`, 'utf-8');
    this.dependencies.log(`pack smoke: installing ${tarballPath}`);
    const result = await this.dependencies.run(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error', tarballPath], this.smokeFolder);
    if (result.exitCode !== 0) {
      throw new Error(`npm install of the tarball failed with exit code ${String(result.exitCode)}:\n${result.stderr}`);
    }

    const installedPackageJson = await readJson<SmokeProjectPackageJson>(join(this.smokeFolder, 'package.json'));
    const [name] = Object.keys(installedPackageJson.dependencies ?? {});
    if (name === undefined) {
      throw new Error('npm install recorded no dependency in the smoke project');
    }

    return name;
  }

  // Accepts a failure caused only by a missing host-provided package (recording which globs accepted it) or, in a
  // peer-bound module, by a missing optional peer; records any other failure as a problem.
  private judgeFailure(params: JudgeFailureParams): FailureVerdict {
    const { exportedModule, failure, format, optionalPeers, usedHostPatterns } = params;
    const missingPackage = getMissingPackage(failure);
    const hostPatterns = missingPackage === null ? [] : this.hostProvidedPackages.filter((pattern) => posix.matchesGlob(missingPackage, pattern));
    for (const pattern of hostPatterns) {
      usedHostPatterns.add(pattern);
    }
    if (hostPatterns.length > 0) {
      return 'host-provided';
    }

    const missingPeer = missingPackage !== null && optionalPeers.includes(missingPackage) ? missingPackage : null;
    const isPeerBound = this.peerBoundModules.some((pattern) => isMatchedBy(exportedModule, pattern));
    if (missingPeer !== null && isPeerBound) {
      return 'peer-bound';
    }

    const hint = missingPeer === null ? '' : ` (it needs the optional peer ${missingPeer}; list the module in peerBoundModules if that is its job)`;
    const reason = [failure.code, firstLine(failure.message)].filter((part) => part !== '').join(' ');
    this.problems.push(`${format === 'esm' ? 'import' : 'require'} ${failure.specifier}: ${reason}${hint}`);
    return 'problem';
  }

  private async pack(): Promise<string> {
    this.dependencies.log(`pack smoke: packing ${this.projectFolder}`);
    const result = await this.dependencies.run(['npm', 'pack', '--json', '--pack-destination', this.temporaryFolder], this.projectFolder);
    if (result.exitCode !== 0) {
      throw new Error(`npm pack failed with exit code ${String(result.exitCode)}:\n${result.stderr}`);
    }

    return join(this.temporaryFolder, parseNpmPackOutput(result.stdout).filename);
  }

  private async probe(probePath: string, format: ModuleFormat, modules: readonly ExportedModule[]): Promise<LoadFailure[]> {
    const listPath = join(this.temporaryFolder, `${format}-modules.json`);
    const resultPath = join(this.temporaryFolder, `${format}-failures.json`);
    await writeFile(listPath, JSON.stringify(modules.map((exportedModule) => exportedModule.specifier)), 'utf-8');
    const result = await this.dependencies.run(['node', probePath, format, listPath, resultPath], this.smokeFolder);
    if (result.exitCode !== 0 || !existsSync(resultPath)) {
      this.problems.push(`the ${format} probe crashed with exit code ${String(result.exitCode)}: ${firstLine(result.stderr)}`);
      return [];
    }

    return await readJson<LoadFailure[]>(resultPath);
  }
}

/**
 * Creates the real outside world: commands run through {@link exec}, progress written to stdout.
 *
 * @returns The dependencies.
 */
export function createNodePackSmokeDependencies(): PackSmokeDependencies {
  return {
    log(text): void {
      process.stdout.write(`${text}\n`);
    },
    async run(command, cwd): Promise<PackSmokeCommandResult> {
      const result = await exec([...command], { cwd, isQuiet: true, shouldIgnoreExitCode: true, shouldIncludeDetails: true });
      return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout };
    }
  };
}

/**
 * Packs the package, installs the tarball into an empty project, imports every exported module as an ES module and
 * requires it as CommonJS, each format in its own process, checks that no optional peer was installed, type-checks an
 * import of each from a consumer under `node16` ESM, `node16` CommonJS and `bundler` resolution, and runs every bin. The package must be built first: `npm pack` packs whatever the build left.
 *
 * @param options - What is accepted and how the bins are run.
 * @returns A {@link Promise} that resolves when the package passes.
 * @throws If the pack or the install fails, or with every problem found, one per line.
 */
export async function smokePack(options: SmokePackOptions = {}): Promise<void> {
  const {
    bins = [],
    dependencies = createNodePackSmokeDependencies(),
    hostProvidedPackages = [],
    installedOptionalPeers = [],
    peerBoundModules = [],
    projectFolder = process.cwd(),
    shouldCheckTypes = true
  } = options;
  const temporaryFolder = await mkdtemp(join(tmpdir(), 'pack-smoke-'));
  try {
    await new PackSmoke({ bins, dependencies, hostProvidedPackages, installedOptionalPeers, peerBoundModules, projectFolder, shouldCheckTypes, temporaryFolder }).run();
  } finally {
    await rm(temporaryFolder, { force: true, maxRetries: TEMPORARY_FOLDER_REMOVAL_RETRIES, recursive: true });
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n', 1).join('').trim();
}

// The name of the package a failure says is missing, or `null` for any other failure. Node's ES module loader names an
// installed package it cannot load (types only: no `main`, no `index.js`) by its path, `.../node_modules/obsidian/index.js`,
// and an absent one by its specifier, so a path is read from its last `node_modules` segment.
function getMissingPackage(failure: LoadFailure): null | string {
  const match = MODULE_NOT_FOUND_CODES.has(failure.code) ? MISSING_PACKAGE_REG_EXP.exec(failure.message) : null;
  if (!match) {
    return null;
  }

  const specifier = getMandatoryNamedGroup(match, 'specifier').replaceAll('\\', '/');
  const nodeModulesIndex = specifier.lastIndexOf(NODE_MODULES_SEGMENT);
  const bareSpecifier = nodeModulesIndex === -1 ? specifier : specifier.slice(nodeModulesIndex + NODE_MODULES_SEGMENT.length);
  return bareSpecifier.split('/', bareSpecifier.startsWith('@') ? SCOPED_NAME_SEGMENT_COUNT : 1).join('/');
}

function isJsonData(exportedModule: ExportedModule): boolean {
  return exportedModule.filePath.toLowerCase().endsWith('.json');
}

function isMatchedBy(exportedModule: ExportedModule, pattern: string): boolean {
  return exportedModule.subpaths.some((subpath) => posix.matchesGlob(subpath, pattern));
}

async function listExportedModules(params: ListExportedModulesParams): Promise<ExportedModule[]> {
  const { format, installedRoot, packageJson, packageName } = params;
  const conditions = CONDITIONS_BY_FORMAT[format];
  const modulesByFile = new Map<string, ExportedModule>();

  function addModule(subpath: string, target: string): void {
    const filePath = join(installedRoot, target);
    const known = modulesByFile.get(filePath);
    if (known) {
      known.subpaths.push(subpath);
      return;
    }
    modulesByFile.set(filePath, { filePath, specifier: subpath === '.' ? packageName : `${packageName}/${subpath}`, subpaths: [subpath] });
  }

  for (const [key, value] of Object.entries(toSubpathMap(packageJson))) {
    const target = resolveTarget(value, conditions);
    if (target === null) {
      continue;
    }

    const starIndex = key.indexOf('*');
    if (starIndex === -1) {
      addModule(key === '.' ? '.' : key.slice('./'.length), target);
      continue;
    }

    // A pattern's `*` matches any string, `/` included, so every file under the folder of the target's prefix that
    // carries the prefix and the suffix is one module: `./dist/lib/esm/*.mjs` takes `dist/lib/esm/a/b.mjs` as `a/b`.
    const [targetPrefix = '', targetSuffix = ''] = posix.normalize(target).split('*', PATTERN_TARGET_PART_COUNT);
    const searchFolder = posix.dirname(`${targetPrefix}_`);
    const searchPath = join(installedRoot, searchFolder);
    if (!existsSync(searchPath)) {
      continue;
    }

    const entries = await readdir(searchPath, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => posix.join(searchFolder, relative(searchPath, join(entry.parentPath, entry.name)).replaceAll('\\', '/')))
      .sort();
    for (const file of files) {
      if (!(file.startsWith(targetPrefix) && file.endsWith(targetSuffix))) {
        continue;
      }

      const star = file.slice(targetPrefix.length, file.length - targetSuffix.length);
      addModule(`${key.slice('./'.length, starIndex)}${star}${key.slice(starIndex + 1)}`, file);
    }
  }

  return [...modulesByFile.values()];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

function resolveTarget(value: ExportsValue | undefined, conditions: ReadonlySet<string>): null | string {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const target = resolveTarget(item, conditions);
      if (target !== null) {
        return target;
      }
    }
    return null;
  }

  for (const [condition, nested] of Object.entries(value)) {
    if (!conditions.has(condition)) {
      continue;
    }

    const target = resolveTarget(nested, conditions);
    if (target !== null) {
      return target;
    }
  }

  return null;
}

// Without `exports` a package exposes its `main`, which Node resolves to `index.js` when it is absent.
function toSubpathMap(packageJson: InstalledPackageJson): Readonly<Record<string, ExportsValue>> {
  const exports = packageJson.exports ?? packageJson.main ?? './index.js';
  const isSubpathMap = typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some((key) => key.startsWith('.'));
  return isSubpathMap ? exports : { '.': exports };
}

function toUnscopedName(packageName: string): string {
  return packageName.slice(packageName.lastIndexOf('/') + 1);
}
