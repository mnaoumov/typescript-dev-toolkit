/**
 * @file
 *
 * Git-derived file listings for the repo-walking scripts.
 *
 * Tooling that walks the repository must skip whatever `.gitignore` skips — otherwise every script grows its
 * own hand-maintained ignore list, the lists drift apart, and a path that is gitignored but not enumerated
 * (a nested `node_modules` under a test fixture, say) is walked anyway. Most tools have a native switch for
 * this; the ones that do not take a file list instead, and that is what this module produces.
 *
 * Asking git rather than parsing `.gitignore` is deliberate: it honors nested ignore files, `!` negations,
 * `.git/info/exclude`, and the user's global excludes, at no cost to us.
 *
 * It also reads a tracked file as it is about to be COMMITTED ({@link readIndexContent}), for a gate that
 * asserts something about those bytes. Such a gate typically runs from `nano-staged` beside `lint:fix` and
 * `format`, which rewrite staged files in place, and nano-staged runs its per-pattern task groups with
 * `Promise.all`, so a gate reading the working tree races the fixer. Reading the index makes the ordering
 * irrelevant rather than enforced.
 */

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

import { execFromRoot } from './root.ts';

/**
 * Options for {@link getNonIgnoredFiles}.
 */
export interface GetNonIgnoredFilesOptions {
  /**
   * Git pathspecs limiting the listing, e.g. `['*.md']`. When omitted, every non-ignored file is listed.
   *
   * @default `[]`
   */
  readonly patterns?: readonly string[] | undefined;
}

/**
 * Separates the paths in `git ls-files -z` output. Using the NUL form avoids git's quoting of paths that
 * contain unusual characters, which would otherwise have to be unescaped.
 */
const NUL_SEPARATOR = '\0';

/**
 * Lists the repository files that `.gitignore` does not exclude.
 *
 * Covers both tracked files and untracked-but-not-ignored ones, so a brand-new file is checked before it is
 * ever committed.
 *
 * @param options - The {@link GetNonIgnoredFilesOptions}.
 * @returns A {@link Promise} that resolves with the matching paths, relative to the root folder and
 * separated by `/`; or with `null` when git cannot answer — it is not installed, or the project is not a
 * git repository (a tarball checkout, for instance). Callers fall back to their own listing in that case.
 */
export async function getNonIgnoredFiles(options?: GetNonIgnoredFilesOptions): Promise<null | string[]> {
  const { patterns = [] } = options ?? {};
  const command = [
    'git',
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    ...patterns.length > 0 ? ['--', ...patterns] : []
  ];

  let stdout: string;
  try {
    stdout = await execFromRoot(command, { isQuiet: true });
  } catch {
    return null;
  }

  // `--cached --others` can name the same path twice (e.g. a file staged for deletion that is still on disk).
  return [...new Set(stdout.split(NUL_SEPARATOR).filter((path) => path !== ''))];
}

/**
 * Reads one tracked file's content out of the git index - stage 0, the bytes `git commit` would write.
 *
 * This spawns `git` directly rather than going through `execFromRoot`, for two reasons, either of which alone
 * would be enough: `execFromRoot` decodes stdout as UTF-8, which a binary blob does not survive, and it strips
 * one trailing newline, so every text file would read as differing from its source by its last line.
 *
 * The path is passed in the `:./<path>` form, which git resolves against the directory it runs from rather
 * than against the top of the working tree, so this stays correct when `root` is a subpackage of the
 * repository rather than its top.
 *
 * No smudge filter or line-ending conversion is applied: `git cat-file blob` hands the blob back verbatim.
 *
 * @param root - The directory the path is relative to, which is also the directory git is run from.
 * @param repoRelativePath - The file's path relative to `root`, posix-spelled.
 * @returns A {@link Promise} that resolves with the staged bytes, or with `null` when the path has no stage-0
 * index entry - it is untracked, staged for deletion, or unmerged. It rejects on any other git failure, `not a
 * git repository` among them, because the bytes a commit would write have no honest answer where there are no
 * commits.
 */
export function readIndexContent(root: string, repoRelativePath: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    /*
     * No shell: a path is passed as an argv entry rather than as text something has to quote, and the
     * leading `:` is a git revision sigil that a shell would be free to read as its own.
     */
    const child = spawn('git', ['-C', root, 'cat-file', 'blob', `:./${repoRelativePath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error: Error) => {
      reject(new Error(`Could not run \`git cat-file\` for ${repoRelativePath}.`, { cause: error }));
    });

    child.on('close', (exitCode: null | number) => {
      if (exitCode === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }

      /*
       * Git answers a path it cannot find in the index with exit 128 and a `fatal:` line, and so does a folder
       * that is not a repository, so the stderr text is what separates the absence of a staged blob from
       * everything else.
       */
      if (isMissingIndexPath(stderr)) {
        resolve(null);
        return;
      }

      const exitCodeText = exitCode === null ? '(null)' : String(exitCode);
      reject(new Error(`\`git cat-file blob :./${repoRelativePath}\` failed with exit code ${exitCodeText}:\n${stderr.trim()}`));
    });
  });
}

function isMissingIndexPath(stderr: string): boolean {
  return stderr.includes('does not exist') || stderr.includes('not in the index') || stderr.includes('Not a valid object name');
}
