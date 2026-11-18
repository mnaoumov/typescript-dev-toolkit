/**
 * @file
 *
 * Checks that the build output depends only on what git holds: the working tree is built, then the committed tree
 * (`git archive <ref>`) is extracted into a folder elsewhere and built there, and every output file must match byte for
 * byte.
 *
 * It catches a build input git does not hold (an untracked or ignored file, an uncommitted change) and an absolute
 * path of this machine in the output, because the second build runs in another folder. That matters wherever someone
 * else rebuilds from the tag, as the Obsidian community directory does for a plugin's `main.js`. It does not catch a
 * different Node, toolchain or dependency version, because both builds use this machine's `node_modules`.
 *
 * The idea, and the junction-plus-preserved-symlinks layout of the second build, come from `obsidian-plugin-dev-kit`
 * (MIT, Copyright (c) 2026 Dmitriy Yurkin, `src/release/reproducible.ts` and `committed-tree.ts` at `aa82d95`); this
 * module is a re-implementation, not a port.
 */

// cspell:ignore Dmitriy Yurkin

import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  join,
  relative
} from 'node:path';
import process from 'node:process';

import { exec } from './exec.ts';

/**
 * Parameters of {@link assertReproducibleBuild}.
 */
export interface AssertReproducibleBuildParams {
  /**
   * The command that builds the project, run in the project folder and in the copy of the committed tree.
   *
   * @default `['npm', 'run', 'build']`
   */
  readonly buildCommand?: readonly string[];

  /**
   * The outside world. The real one when omitted.
   */
  readonly dependencies?: ReproducibleBuildDependencies;

  /**
   * The build outputs to compare, as paths relative to the project folder: a file, or a folder whose files are all
   * compared. A path neither build produced is a failure.
   */
  readonly outputPaths: readonly string[];

  /**
   * The project folder. When it is a subfolder of the repository, only that subfolder is archived.
   *
   * @default the current working folder
   */
  readonly projectFolder?: string;

  /**
   * The commit-ish whose tree is built a second time.
   *
   * @default `'HEAD'`
   */
  readonly ref?: string;

  /**
   * Whether to build the working tree first. `false` compares the output the last build left, for a caller that has
   * just built.
   *
   * @default `true`
   */
  readonly shouldBuildWorkingTree?: boolean;
}

/**
 * Where two builds of one file first differ, as {@link findFirstDifference} reports it.
 */
export interface ByteDifference {
  /**
   * The 1-based column of {@link offset} in its line of the first file.
   */
  readonly column: number;

  /**
   * The bytes of the first file around {@link offset}, as a JSON string literal.
   */
  readonly firstContext: string;

  /**
   * The 1-based line of {@link offset} in the first file.
   */
  readonly line: number;

  /**
   * The offset of the first byte that differs, or the length of the shorter file when one is a prefix of the other.
   */
  readonly offset: number;

  /**
   * The bytes of the second file around {@link offset}, as a JSON string literal.
   */
  readonly secondContext: string;
}

/**
 * The outcome of one command {@link ReproducibleBuildDependencies.run} ran.
 */
export interface ReproducibleBuildCommandResult {
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
 * The outside world {@link assertReproducibleBuild} works through.
 */
export interface ReproducibleBuildDependencies {
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
   * @param options - Where and with which additional environment to run it.
   * @returns The result.
   */
  readonly run: (command: readonly string[], options: ReproducibleBuildRunOptions) => Promise<ReproducibleBuildCommandResult>;
}

/**
 * How {@link ReproducibleBuildDependencies.run} runs one command.
 */
export interface ReproducibleBuildRunOptions {
  /**
   * The folder to run it in.
   */
  readonly cwd: string;

  /**
   * Environment variables merged over the inherited ones.
   */
  readonly env?: Readonly<Record<string, string>>;
}

interface BuildCopyParams {
  readonly buildCommand: readonly string[];
  readonly commit: string;
  readonly dependencies: ReproducibleBuildDependencies;
  readonly outputPaths: readonly string[];
  readonly projectFolder: string;
  readonly ref: string;
  readonly temporaryFolder: string;
}

interface CompareOutputsParams {
  readonly first: ReadonlyMap<string, Buffer>;
  readonly outputPaths: readonly string[];
  readonly second: ReadonlyMap<string, Buffer>;
}

/**
 * The bytes shown on each side of the first difference.
 */
const CONTEXT_BYTE_COUNT = 20;

const DEFAULT_BUILD_COMMAND: readonly string[] = ['npm', 'run', 'build'];

const LIKELY_CAUSES = 'Likely causes: a file the build reads that git does not hold (untracked, ignored by .gitignore, or excluded by '
  + 'export-ignore), an uncommitted change, an absolute path of this machine in the output (process.cwd(), __dirname, '
  + 'import.meta.url, a path in a comment or a source map), or a timestamp or random value inlined at build time.';

const LINE_FEED = 0x0A;

const MISSING_INPUT_HINT = 'The committed tree does not build although the working tree does, so an input of the build is not in the '
  + 'commit: a file that is untracked, ignored by .gitignore or excluded by export-ignore, or an uncommitted change. Commit it, '
  + 'or fix what reads it.';

const OUTPUT_TAIL_LINE_COUNT = 20;

const SHOWN_UNCOMMITTED_COUNT = 3;

// Windows can hold a file of the removed folder open for a moment after the build exits.
const TEMPORARY_FOLDER_REMOVAL_RETRIES = 3;

/**
 * Builds the working tree and the committed tree, the second extracted from `git archive` into a folder elsewhere with
 * the project's `node_modules` reachable through a junction, and requires every file under {@link
 * AssertReproducibleBuildParams.outputPaths} to be identical byte for byte.
 *
 * The second build runs with `NODE_PRESERVE_SYMLINKS=1`, so Node keeps the copy's `node_modules/...` paths instead of
 * resolving them to the project's real folder; a bundler that writes module paths into its output must honour the same
 * variable, or the paths differ.
 *
 * `git archive` applies `export-ignore` and `export-subst` from `.gitattributes`, which a checkout does not, and writes
 * Git LFS files as their pointer text. The copy holds no `.git`, so a build step that runs git fails there.
 *
 * @param params - What to build and compare.
 * @returns A {@link Promise} that resolves when every output matches.
 * @throws If a build fails, the ref does not name a commit, or with every difference found, one per line.
 */
export async function assertReproducibleBuild(params: AssertReproducibleBuildParams): Promise<void> {
  const {
    buildCommand = DEFAULT_BUILD_COMMAND,
    dependencies = createNodeReproducibleBuildDependencies(),
    outputPaths,
    projectFolder = process.cwd(),
    ref = 'HEAD',
    shouldBuildWorkingTree = true
  } = params;
  if (outputPaths.length === 0) {
    throw new Error('assertReproducibleBuild needs at least one output path to compare.');
  }

  // eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation -- `^{commit}` is git's peel syntax, not an interpolation.
  const commitResult = await dependencies.run(['git', 'rev-parse', '--short', '--verify', '--quiet', `${ref}^{commit}`], { cwd: projectFolder });
  const commit = commitResult.stdout.trim();
  if (commitResult.exitCode !== 0 || commit === '') {
    throw new Error(`${ref} does not name a commit in ${projectFolder}, so there is no committed tree to build.`);
  }

  if (shouldBuildWorkingTree) {
    dependencies.log(`Building the working tree: ${buildCommand.join(' ')}`);
    await runBuild(dependencies, buildCommand, { cwd: projectFolder }, 'the working tree does not build');
  }

  const first = await collectOutputs(projectFolder, outputPaths);
  const statusResult = await dependencies.run(['git', '--no-optional-locks', 'status', '--porcelain'], { cwd: projectFolder });
  const uncommitted = statusResult.stdout.split('\n').filter((line) => line.trim() !== '');

  // The real path: on macOS the temp folder is reached through a symlink (`/var` -> `/private/var`), and a bundler then
  // writes `../..` paths for files it finds through the other spelling.
  const temporaryFolder = await mkdtemp(join(await realpath(tmpdir()), 'reproducible-build-'));
  let second: Map<string, Buffer>;
  try {
    second = await buildCopy({ buildCommand, commit, dependencies, outputPaths, projectFolder, ref, temporaryFolder });
  } finally {
    await removeTemporaryFolder(temporaryFolder);
  }

  const problems = compareOutputs({ first, outputPaths, second });
  if (problems.length === 0) {
    dependencies.log(`${String(first.size)} output file(s) identical byte for byte between the working tree and the committed tree (${ref} ${commit}).`);
    return;
  }

  const lines = [
    `The build is not reproducible from the committed tree (${ref} ${commit}):`,
    ...problems.map((problem) => `- ${problem}`),
    LIKELY_CAUSES
  ];
  if (uncommitted.length > 0) {
    const shown = uncommitted.slice(0, SHOWN_UNCOMMITTED_COUNT).map((line) => line.trim()).join(', ');
    const more = uncommitted.length > SHOWN_UNCOMMITTED_COUNT ? ', ...' : '';
    lines.push(`The working tree has ${String(uncommitted.length)} uncommitted change(s) (${shown}${more}): commit them first to rule them out.`);
  }
  throw new Error(lines.join('\n'));
}

/**
 * Creates the real outside world: commands run through {@link exec}, progress written to stdout.
 *
 * @returns The dependencies.
 */
export function createNodeReproducibleBuildDependencies(): ReproducibleBuildDependencies {
  return {
    log(text): void {
      process.stdout.write(`${text}\n`);
    },
    async run(command, options): Promise<ReproducibleBuildCommandResult> {
      const result = await exec([...command], {
        cwd: options.cwd,
        env: options.env ?? {},
        isQuiet: true,
        shouldIgnoreExitCode: true,
        shouldIncludeDetails: true
      });
      return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout };
    }
  };
}

/**
 * Finds where two builds of one file first differ.
 *
 * @param first - The bytes of the first build.
 * @param second - The bytes of the second build.
 * @returns The first difference, or `null` when the bytes are equal.
 */
export function findFirstDifference(first: Uint8Array, second: Uint8Array): ByteDifference | null {
  const sharedLength = Math.min(first.length, second.length);
  let offset = 0;
  while (offset < sharedLength && first[offset] === second[offset]) {
    offset++;
  }

  if (offset === sharedLength && first.length === second.length) {
    return null;
  }

  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    if (first[index] !== LINE_FEED) {
      continue;
    }

    line++;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    firstContext: getContext(first, offset),
    line,
    offset,
    secondContext: getContext(second, offset)
  };
}

async function buildCopy(params: BuildCopyParams): Promise<Map<string, Buffer>> {
  const { buildCommand, commit, dependencies, outputPaths, projectFolder, ref, temporaryFolder } = params;
  const copyFolder = join(temporaryFolder, 'tree');
  await mkdir(copyFolder);
  dependencies.log(`Extracting the committed tree (${ref} ${commit}) to ${copyFolder}`);
  // Run in the project folder, `git archive` takes only that folder, so a project in a subfolder of a repository works.
  await runChecked(dependencies, ['git', 'archive', '--format=tar', '-o', join(temporaryFolder, 'tree.tar'), commit], { cwd: projectFolder });
  // A relative archive path, because GNU tar (which Git for Windows puts on the PATH) reads `C:\...` as a remote host.
  await runChecked(dependencies, ['tar', '-xf', '../tree.tar'], { cwd: copyFolder });

  const linkPath = join(copyFolder, 'node_modules');
  const projectNodeModules = join(projectFolder, 'node_modules');
  const shouldLink = existsSync(projectNodeModules) && !existsSync(linkPath);
  if (shouldLink) {
    // A junction needs no privilege on Windows; the type is ignored elsewhere.
    await symlink(projectNodeModules, linkPath, 'junction');
  }

  try {
    dependencies.log(`Building the committed tree: ${buildCommand.join(' ')}`);
    await runBuild(dependencies, buildCommand, { cwd: copyFolder, env: { NODE_PRESERVE_SYMLINKS: '1' } }, `the committed tree (${ref} ${commit}) does not build`, MISSING_INPUT_HINT);
    return await collectOutputs(copyFolder, outputPaths);
  } finally {
    if (shouldLink) {
      // Removed on its own first, so the folder removal can never walk into the project's real `node_modules`.
      await unlink(linkPath);
    }
  }
}

// Every file under the output paths, keyed by its `/`-separated path relative to the root. A path that does not exist
// contributes nothing, so a missing output shows up in the comparison as a file one side lacks.
async function collectOutputs(rootFolder: string, outputPaths: readonly string[]): Promise<Map<string, Buffer>> {
  const outputs = new Map<string, Buffer>();
  for (const outputPath of outputPaths) {
    const fullPath = join(rootFolder, outputPath);
    if (!existsSync(fullPath)) {
      continue;
    }

    const stats = await lstat(fullPath);
    const entries = stats.isDirectory() ? await readdir(fullPath, { recursive: true, withFileTypes: true }) : [];
    const files = stats.isDirectory()
      ? entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
      : [fullPath];
    for (const file of files) {
      outputs.set(toPosixPath(relative(rootFolder, file)), await readFile(file));
    }
  }

  return outputs;
}

function compareOutputs(params: CompareOutputsParams): string[] {
  const { first, outputPaths, second } = params;
  const problems: string[] = [];
  const paths = [...new Set([...first.keys(), ...second.keys()])].sort();
  for (const outputPath of outputPaths) {
    const prefix = toPosixPath(outputPath).replace(/\/+$/, '');
    if (paths.every((path) => !(path === prefix || path.startsWith(`${prefix}/`)))) {
      problems.push(`${outputPath} was produced by neither build.`);
    }
  }

  for (const path of paths) {
    const firstBytes = first.get(path);
    const secondBytes = second.get(path);
    if (secondBytes === undefined) {
      problems.push(`${path} is built from the working tree but not from the committed tree.`);
      continue;
    }

    if (firstBytes === undefined) {
      problems.push(`${path} is built from the committed tree but not from the working tree.`);
      continue;
    }

    const difference = findFirstDifference(firstBytes, secondBytes);
    if (difference !== null) {
      problems.push(
        `${path} differs: first at byte ${String(difference.offset)} (line ${String(difference.line)}, column ${String(difference.column)}), `
          + `${String(firstBytes.length)} and ${String(secondBytes.length)} bytes; working tree ${difference.firstContext}, committed tree ${difference.secondContext}.`
      );
    }
  }

  return problems;
}

function getContext(bytes: Uint8Array, offset: number): string {
  const window = bytes.subarray(Math.max(0, offset - CONTEXT_BYTE_COUNT), offset + CONTEXT_BYTE_COUNT);
  return JSON.stringify(Buffer.from(window).toString('utf-8'));
}

async function removeTemporaryFolder(temporaryFolder: string): Promise<void> {
  await rm(temporaryFolder, { force: true, maxRetries: TEMPORARY_FOLDER_REMOVAL_RETRIES, recursive: true });
}

async function runBuild(
  dependencies: ReproducibleBuildDependencies,
  buildCommand: readonly string[],
  runOptions: ReproducibleBuildRunOptions,
  failure: string,
  hint?: string
): Promise<void> {
  const result = await dependencies.run(buildCommand, runOptions);
  if (result.exitCode === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-OUTPUT_TAIL_LINE_COUNT);
  const lines = [`${failure}: ${buildCommand.join(' ')} exited with ${String(result.exitCode)}.`];
  if (hint !== undefined) {
    lines.push(hint);
  }
  lines.push(...output);
  throw new Error(lines.join('\n'));
}

async function runChecked(dependencies: ReproducibleBuildDependencies, command: readonly string[], runOptions: ReproducibleBuildRunOptions): Promise<void> {
  const result = await dependencies.run(command, runOptions);
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with ${String(result.exitCode)}: ${result.stderr.trim()}`);
  }
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}
