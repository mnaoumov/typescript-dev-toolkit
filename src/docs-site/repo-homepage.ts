/**
 * @file
 *
 * Keeps a repository's GitHub homepage pointing at its documentation site.
 *
 * The URL is the site's own (`site` + `base` of its Astro configuration), so nothing here knows which origin or
 * account a site belongs to. It reads and writes through the `gh` CLI with whatever credentials it already has.
 *
 * A workflow's `GITHUB_TOKEN` cannot change a repository's settings, so in CI a mismatch is reported, never fixed:
 * the report prints the `gh repo edit` line that fixes it. Nothing here ever fails a build.
 */

import { execFromRoot } from '../root.ts';

/**
 * What a site build does about its repository's GitHub homepage.
 *
 * - `off`: nothing.
 * - `check`: report a homepage that is not the site's URL, with the command that sets it.
 * - `set`: set a homepage that is not the site's URL, and report it when the credentials cannot.
 */
export type RepoHomepageMode = 'check' | 'off' | 'set';

/**
 * Params for {@link syncRepoHomepage}.
 */
export interface SyncRepoHomepageParams {
  /**
   * The URL the homepage should be: the site's base URL.
   */
  readonly homepageUrl: string;

  /**
   * Whether to set a mismatched homepage or only report it.
   */
  readonly mode: Exclude<RepoHomepageMode, 'off'>;

  /**
   * The GitHub account the repository belongs to.
   */
  readonly owner: string;

  /**
   * The repository's name.
   */
  readonly repo: string;
}

/**
 * Compares a repository's GitHub homepage with its site's URL, and sets it or reports the mismatch.
 *
 * It only warns: an unreadable repository, a mismatch it may not fix and a failed update each print the reason and
 * the `gh repo edit` line, and inside GitHub Actions also a `::warning::` annotation.
 *
 * @param params - The repository, the site's URL and the mode.
 */
export async function syncRepoHomepage(params: SyncRepoHomepageParams): Promise<void> {
  const { homepageUrl, mode, owner, repo } = params;
  const repoSlug = `${owner}/${repo}`;
  const fixCommand = `gh repo edit ${repoSlug} --homepage ${homepageUrl}`;

  let currentHomepage: string;
  try {
    const output = await execFromRoot(['gh', 'api', `repos/${repoSlug}`, '--jq', '.homepage // ""'], { isQuiet: true });
    currentHomepage = output.trim();
  } catch (error) {
    warn(`Could not read the GitHub homepage of ${repoSlug} (${describeError(error)}). To set it: ${fixCommand}`);
    return;
  }

  if (currentHomepage === homepageUrl) {
    return;
  }

  const shownHomepage = currentHomepage === '' ? 'empty' : `'${currentHomepage}'`;

  if (mode === 'check') {
    warn(`The GitHub homepage of ${repoSlug} is ${shownHomepage}, not the site ${homepageUrl}. To set it: ${fixCommand}`);
    return;
  }

  try {
    await execFromRoot(['gh', 'api', '--method', 'PATCH', `repos/${repoSlug}`, '-f', `homepage=${homepageUrl}`], { isQuiet: true });
  } catch (error) {
    warn(
      `The GitHub homepage of ${repoSlug} is ${shownHomepage}, not the site ${homepageUrl}, and setting it failed: ${describeError(error)}. `
        + `A workflow token cannot change repository settings; with an account that can: ${fixCommand}`
    );
    return;
  }

  console.warn(`Set the GitHub homepage of ${repoSlug} to ${homepageUrl} (was ${shownHomepage}).`);
}

// The first line only: `execFromRoot`'s error carries the whole command, stderr and stdout after it.
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const newlineIndex = message.indexOf('\n');
  return newlineIndex === -1 ? message : message.slice(0, newlineIndex);
}

function warn(message: string): void {
  console.warn(message);
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    console.warn(`::warning title=Repository homepage::${message}`);
  }
}
