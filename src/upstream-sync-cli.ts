/**
 * @file
 *
 * The `sync-upstreams` command: reads its arguments, wires {@link syncUpstreams} to the real git, `gh`, GitHub API and
 * npm registry, and turns the results into an exit code.
 */

import type { SpawnSyncReturns } from 'node:child_process';

import { spawnSync } from 'node:child_process';
import process from 'node:process';

import type {
  CommandResult,
  SyncDependencies,
  SyncUpstreamsOptions
} from './upstream-sync.ts';

import { syncUpstreams } from './upstream-sync.ts';

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_CONFIG_PATH = 'upstreams.json';

/**
 * Creates the sync's outside world: commands run with `spawnSync`, JSON fetched with `fetch`, output to stdout.
 * `GITHUB_TOKEN`, when set, is sent to the GitHub API and nowhere else.
 *
 * @returns The dependencies.
 */
export function createNodeSyncDependencies(): SyncDependencies {
  return {
    exec(file, arguments_, env): CommandResult {
      return toResult(spawnSync(file, arguments_, { encoding: 'utf-8', env: { ...process.env, ...env } }));
    },
    async fetchJson(url): Promise<unknown> {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      const token = process.env['GITHUB_TOKEN'];
      if (token && url.startsWith('https://api.github.com/')) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`GET ${url} failed: HTTP ${String(response.status)}.`);
      }
      return await response.json();
    },
    log(text): void {
      process.stdout.write(`${text}\n`);
    },
    shell(command, env): CommandResult {
      process.stdout.write(`> ${command}\n`);
      const result = toResult(spawnSync(command, { encoding: 'utf-8', env: { ...process.env, ...env }, shell: true }));
      process.stdout.write(result.output);
      return result;
    }
  };
}

/**
 * Builds the sync options from the command line.
 *
 * `--dry-run` prints each PR it would open and changes nothing. `--only=<name>[,<name>]` limits the sync to those
 * entries, `--base=<branch>` names the branch the PRs target (`main` by default), and `--config=<path>` names the
 * `upstreams.json` (the one in the working directory by default).
 *
 * @param cliArguments - The arguments after the command name.
 * @returns The options.
 */
export function parseSyncUpstreamsArguments(cliArguments: readonly string[]): SyncUpstreamsOptions {
  const known = ['--dry-run', '--only=', '--base=', '--config='];
  const unknown = cliArguments.filter((argument) => known.every((prefix) => !(prefix.endsWith('=') ? argument.startsWith(prefix) : argument === prefix)));
  if (unknown.length > 0) {
    throw new Error(`sync-upstreams: unknown argument ${unknown.map((argument) => `"${argument}"`).join(', ')}. Known: --dry-run, --only=, --base=, --config=.`);
  }
  return {
    baseBranch: readOption(cliArguments, 'base') ?? DEFAULT_BASE_BRANCH,
    configPath: readOption(cliArguments, 'config') ?? DEFAULT_CONFIG_PATH,
    dryRun: cliArguments.includes('--dry-run'),
    only: readOption(cliArguments, 'only')?.split(',').filter((name) => name !== '') ?? []
  };
}

/**
 * Runs the `sync-upstreams` command.
 *
 * @param cliArguments - The arguments after the command name.
 * @param dependencies - The outside world. The real one when omitted.
 * @returns The exit code: `1` when the arguments or `upstreams.json` are wrong or any entry failed, `0` otherwise.
 */
export async function runSyncUpstreamsCli(cliArguments: readonly string[], dependencies: SyncDependencies = createNodeSyncDependencies()): Promise<number> {
  try {
    const results = await syncUpstreams(parseSyncUpstreamsArguments(cliArguments), dependencies);
    return results.some((result) => result.outcome === 'error') ? 1 : 0;
  } catch (error) {
    // A wrong argument or config is the user's to fix, so it gets its message rather than a stack trace.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// An empty value counts as absent, because a workflow passes an unset input as one.
function readOption(cliArguments: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = cliArguments.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return value === '' ? undefined : value;
}

function toResult(result: SpawnSyncReturns<string>): CommandResult {
  return result.error ? { exitCode: 1, output: result.error.message } : { exitCode: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}
