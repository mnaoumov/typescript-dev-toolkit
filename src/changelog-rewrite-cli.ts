/**
 * @file
 *
 * The `rewrite-changelog` command: rewrites a project's published `CHANGELOG.md` sections, and optionally its GitHub
 * release notes, into the `grouped` layout, by wiring {@link rewriteChangelog} to the real git, `gh` and file system.
 *
 * It changes nothing unless `--write` is passed, so the first run is always a report of what it would do.
 */

import type { SpawnSyncReturns } from 'node:child_process';

import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import process from 'node:process';

import type { RewrittenChangelogSection } from './changelog-rewrite.ts';

import {
  rewriteChangelog,
  rewriteReleaseNotes
} from './changelog-rewrite.ts';

/**
 * The result of one command the `rewrite-changelog` command runs.
 */
export interface RewriteChangelogCommandResult {
  /**
   * The exit code.
   */
  readonly exitCode: number;

  /**
   * The standard error.
   */
  readonly stderr: string;

  /**
   * The standard output.
   */
  readonly stdout: string;
}

/**
 * The outside world of the `rewrite-changelog` command.
 */
export interface RewriteChangelogDependencies {
  /**
   * Runs a command in the working directory.
   *
   * @param file - The executable.
   * @param arguments_ - Its arguments.
   * @param input - What to write to its standard input.
   * @returns The result.
   */
  readonly exec: (file: string, arguments_: readonly string[], input?: string) => RewriteChangelogCommandResult;

  /**
   * Writes one line of the report.
   *
   * @param text - The line.
   */
  readonly log: (text: string) => void;

  /**
   * Reads a text file.
   *
   * @param path - The path.
   * @returns The content.
   */
  readonly readFile: (path: string) => string;

  /**
   * Writes a text file.
   *
   * @param path - The path.
   * @param content - The content.
   */
  readonly writeFile: (path: string, content: string) => void;
}

/**
 * The options of the `rewrite-changelog` command.
 */
export interface RewriteChangelogOptions {
  /**
   * The `CHANGELOG.md` to rewrite.
   */
  readonly changelogPath: string;

  /**
   * Whether a GitHub release whose notes are no longer its changelog section as it was is rewritten too.
   */
  readonly shouldOverwriteEditedReleases: boolean;

  /**
   * Whether the GitHub release of each rewritten section is rewritten too.
   */
  readonly shouldRewriteReleases: boolean;

  /**
   * Whether anything is changed. Without it the command only reports.
   */
  readonly shouldWrite: boolean;
}

interface ReleaseRecord {
  readonly body: string;
  readonly tag: string;
}

type ReleaseRewriteOutcome = 'failed' | 'ok';

interface TaggedRewrittenSection extends RewrittenChangelogSection {
  readonly tag: string;
}

const DEFAULT_CHANGELOG_PATH = 'CHANGELOG.md';

const KNOWN_ARGUMENTS = ['--write', '--releases', '--overwrite-edited-releases', '--path='];

/**
 * Creates the command's outside world: commands run with `spawnSync`, files read and written with `node:fs`, the
 * report written to stdout.
 *
 * @returns The dependencies.
 */
export function createNodeRewriteChangelogDependencies(): RewriteChangelogDependencies {
  return {
    exec(file, arguments_, input): RewriteChangelogCommandResult {
      return toResult(spawnSync(file, arguments_, { encoding: 'utf-8', input, maxBuffer: Number.MAX_SAFE_INTEGER }));
    },
    log(text): void {
      process.stdout.write(`${text}\n`);
    },
    readFile(path): string {
      return readFileSync(path, 'utf-8');
    },
    writeFile(path, content): void {
      writeFileSync(path, content, 'utf-8');
    }
  };
}

/**
 * Builds the command's options from the command line: `--write` applies the changes, `--releases` adds the GitHub
 * releases to them, `--overwrite-edited-releases` includes the releases whose notes were edited after publishing, and
 * `--path=<file>` names the changelog (`CHANGELOG.md` by default).
 *
 * @param cliArguments - The arguments after the command name.
 * @returns The options.
 */
export function parseRewriteChangelogArguments(cliArguments: readonly string[]): RewriteChangelogOptions {
  const unknown = cliArguments.filter((argument) => KNOWN_ARGUMENTS.every((known) => !(known.endsWith('=') ? argument.startsWith(known) : argument === known)));
  if (unknown.length > 0) {
    throw new Error(
      `rewrite-changelog: unknown argument ${unknown.map((argument) => `"${argument}"`).join(', ')}. Known: ${KNOWN_ARGUMENTS.join(', ')}.`
    );
  }

  const path = cliArguments.find((argument) => argument.startsWith('--path='))?.slice('--path='.length);
  return {
    changelogPath: path === undefined || path === '' ? DEFAULT_CHANGELOG_PATH : path,
    shouldOverwriteEditedReleases: cliArguments.includes('--overwrite-edited-releases'),
    shouldRewriteReleases: cliArguments.includes('--releases'),
    shouldWrite: cliArguments.includes('--write')
  };
}

/**
 * Runs the `rewrite-changelog` command in the working directory, which is the repository root.
 *
 * @param cliArguments - The arguments after the command name.
 * @param dependencies - The outside world. The real one when omitted.
 * @returns The exit code: `1` when the arguments are wrong, git cannot be read or a release edit failed, `0` otherwise.
 */
export async function runRewriteChangelogCli(
  cliArguments: readonly string[],
  dependencies: RewriteChangelogDependencies = createNodeRewriteChangelogDependencies()
): Promise<number> {
  try {
    return await runRewriteChangelog(parseRewriteChangelogArguments(cliArguments), dependencies);
  } catch (error) {
    // A wrong argument or an unreadable repository is the user's to fix, so it gets its message rather than a stack trace.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function execOrThrow(dependencies: RewriteChangelogDependencies, file: string, arguments_: readonly string[]): string {
  const result = dependencies.exec(file, arguments_);
  if (result.exitCode !== 0) {
    throw new Error(`rewrite-changelog: ${file} ${arguments_.join(' ')} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

/**
 * Reads the notes of every GitHub release of the repository in one paginated call, since one `gh release view` per
 * release takes minutes on a project with hundreds of them.
 *
 * @param dependencies - The outside world.
 * @returns The notes, by tag.
 */
function readReleaseNotes(dependencies: RewriteChangelogDependencies): Map<string, string> {
  const output = execOrThrow(dependencies, 'gh', [
    'api',
    '--paginate',
    'repos/{owner}/{repo}/releases?per_page=100',
    '--jq',
    '.[] | {tag: .tag_name, body: (.body // "")}'
  ]);
  const notesByTag = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    const release = JSON.parse(line) as ReleaseRecord;
    notesByTag.set(release.tag, release.body);
  }

  return notesByTag;
}

function rewriteRelease(
  section: TaggedRewrittenSection,
  releaseNotes: string | undefined,
  options: RewriteChangelogOptions,
  dependencies: RewriteChangelogDependencies
): ReleaseRewriteOutcome {
  if (releaseNotes === undefined) {
    dependencies.log(`release ${section.tag}: left alone, the repository has no GitHub release for it`);
    return 'ok';
  }

  const notes = rewriteReleaseNotes(releaseNotes, section, options.shouldOverwriteEditedReleases);
  if (notes === null) {
    dependencies.log(`release ${section.tag}: left alone, its notes are not the changelog section as it was (--overwrite-edited-releases rewrites it)`);
    return 'ok';
  }

  if (!options.shouldWrite) {
    dependencies.log(`release ${section.tag}: would be rewritten`);
    return 'ok';
  }

  const edit = dependencies.exec('gh', ['release', 'edit', section.tag, '--notes-file', '-'], notes);
  if (edit.exitCode !== 0) {
    dependencies.log(`release ${section.tag}: the edit FAILED: ${edit.stderr.trim()}`);
    return 'failed';
  }

  dependencies.log(`release ${section.tag}: rewritten`);
  return 'ok';
}

async function runRewriteChangelog(options: RewriteChangelogOptions, dependencies: RewriteChangelogDependencies): Promise<number> {
  const changelog = dependencies.readFile(options.changelogPath);
  const tags = execOrThrow(dependencies, 'git', ['tag', '--list']).split(/\r?\n/).filter(Boolean);
  const result = await rewriteChangelog(changelog, {
    getCommitMessages: (fromTag, toTag) =>
      Promise.resolve(
        execOrThrow(dependencies, 'git', ['log', '--format=%B', '--first-parent', '-z', fromTag === undefined ? toTag : `${fromTag}..${toTag}`])
          .split('\0')
          .filter((message) => message.trim() !== '')
      ),
    tags
  });

  for (const section of result.rewritten) {
    const tagNote = section.tag === undefined ? ', no tag, so grouped from the bullets alone' : '';
    dependencies.log(`${section.version}: rewritten, ${String(section.matchedCount)} of ${String(section.oldBody.split('\n').length)} bullets matched to commits${tagNote}`);
  }

  for (const section of result.kept) {
    dependencies.log(`${section.version}: kept, ${section.reason}`);
  }

  if (options.shouldWrite) {
    dependencies.writeFile(options.changelogPath, result.content);
    dependencies.log(`${options.changelogPath}: written`);
  } else {
    dependencies.log(`${options.changelogPath}: dry run, nothing written (pass --write to apply)`);
  }

  let isSuccess = true;
  if (options.shouldRewriteReleases) {
    const notesByTag = readReleaseNotes(dependencies);
    for (const section of result.rewritten) {
      if (section.tag !== undefined) {
        isSuccess = rewriteRelease({ ...section, tag: section.tag }, notesByTag.get(section.tag), options, dependencies) === 'ok' && isSuccess;
      }
    }
  }

  return isSuccess ? 0 : 1;
}

function toResult(result: SpawnSyncReturns<string>): RewriteChangelogCommandResult {
  return result.error
    ? { exitCode: 1, stderr: result.error.message, stdout: '' }
    : { exitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
}
