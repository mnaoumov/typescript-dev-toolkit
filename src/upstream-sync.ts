/**
 * @file
 *
 * Watches the upstreams a repository mirrors and opens one update PR per upstream that moved.
 *
 * Everything here is driven by `upstreams.json` and the handler commands it names, so any repository that vendors
 * upstream code can use it: through the `sync-upstreams` bin, or the reusable `sync-upstreams.yml` workflow.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { matchesGlob } from 'node:path';

/**
 * What a command printed and how it exited.
 */
export interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * An upstream followed on a GitHub branch or tag, pinned to a commit.
 */
export interface GitUpstreamEntry {
  /**
   * The pinned commit: the last upstream state the handler was run against.
   */
  commit: string;
  /**
   * The shell command that turns a newer upstream state into changes in this repository.
   */
  handler: string;
  name: string;
  /**
   * The paths watched upstream, as globs relative to the repository root. A move that touches none of them opens no PR.
   */
  paths: readonly string[];
  /**
   * The branch or tag followed.
   */
  ref: string;
  /**
   * `<owner>/<repo>` on GitHub.
   */
  repo: string;
  /**
   * The shell command that checks the handler's result. Overrides the file's top-level `verify`.
   */
  verify?: string;
}

/**
 * An upstream followed as an npm package's dist-tag, pinned to a version.
 */
export interface NpmUpstreamEntry {
  handler: string;
  name: string;
  /**
   * The package name.
   */
  npm: string;
  /**
   * The dist-tag followed. `latest` when absent.
   */
  tag?: string;
  verify?: string;
  /**
   * The pinned version.
   */
  version: string;
}

/**
 * Everything the sync does to the outside world, so a test can stand a fixture in for it.
 */
export interface SyncDependencies {
  /**
   * Runs an executable with arguments and no shell.
   */
  exec: (file: string, arguments_: readonly string[], env?: Readonly<Record<string, string>>) => CommandResult;
  /**
   * GETs a URL and parses the JSON it returns, throwing on an HTTP error.
   */
  fetchJson: (url: string) => Promise<unknown>;
  log: (text: string) => void;
  /**
   * Runs a command line through the shell: a handler or a verify command.
   */
  shell: (command: string, env?: Readonly<Record<string, string>>) => CommandResult;
}

/**
 * The PR an upstream move asks for.
 */
export interface SyncPlan {
  branch: string;
  status: UpstreamStatus;
  title: string;
}

/**
 * What happened to one entry.
 */
export interface SyncResult {
  /**
   * Set when checking or applying threw: the job reports it and moves on to the next entry.
   */
  readonly error?: string;
  readonly name: string;
  /**
   * `planned` in a dry run, `opened`/`updated` when a PR was pushed, `unchanged` when the branch already held this result.
   */
  readonly outcome: 'current' | 'error' | 'opened' | 'planned' | 'unchanged' | 'unwatched' | 'updated';
  readonly prNumber?: number;
}

/**
 * What {@link syncUpstreams} syncs, and how.
 */
export interface SyncUpstreamsOptions {
  /**
   * The branch each PR targets and each update branch is cut from.
   */
  readonly baseBranch: string;
  /**
   * The path to `upstreams.json`, which the sync updates the pin in.
   */
  readonly configPath: string;
  /**
   * Plan and print every PR, and change nothing.
   */
  readonly dryRun: boolean;
  /**
   * Only the entries with these names, or every entry when empty.
   */
  readonly only: readonly string[];
}

/**
 * One upstream that `upstreams.json` lists: a git one or an npm one.
 */
export type UpstreamEntry = GitUpstreamEntry | NpmUpstreamEntry;

/**
 * The content of `upstreams.json`.
 */
export interface UpstreamsConfig {
  upstreams: readonly UpstreamEntry[];
  /**
   * The shell command that checks every handler's result, unless an entry names its own.
   */
  verify?: string;
}

/**
 * What one comparison of an entry with its upstream found.
 */
export interface UpstreamStatus {
  /**
   * The upstream paths that changed and are watched, sorted. Always empty for an npm upstream.
   */
  changedPaths: readonly string[];
  /**
   * A link that shows what changed between the pin and the head.
   */
  compareUrl: string;
  entry: UpstreamEntry;
  /**
   * The commit or version the upstream is at now.
   */
  head: string;
  /**
   * The commit or version `upstreams.json` records.
   */
  pin: string;
  /**
   * `current`: nothing to do. `moved`: a PR is due. `unwatched`: upstream moved, but no watched path changed.
   */
  state: 'current' | 'moved' | 'unwatched';
  /**
   * Whether GitHub truncated the compare's file list, so a watched path may be missing from `changedPaths`.
   */
  truncated: boolean;
}

interface GitHubCommit {
  sha: string;
}

interface GitHubCompare {
  files?: readonly GitHubCompareFile[];
}

/**
 * One file of a GitHub compare, as the API spells it.
 */
interface GitHubCompareFile {
  filename: string;

  previous_filename?: string;
}

interface NpmPackument {
  'dist-tags': Record<string, string>;
}

interface StepResult {
  readonly command: string;
  readonly result: CommandResult;
}

/**
 * The handler and verify runs a PR body reports.
 */
interface StepResults {
  handler: StepResult;
  verify: null | StepResult;
}

/**
 * `upstreams.json` read loosely, to write one value back without disturbing the rest.
 */
interface UpstreamsFileShape {
  upstreams: Record<string, unknown>[];
}

/**
 * GitHub's compare API lists at most this many files, and says nothing when it stops.
 */
const COMPARE_FILE_LIMIT = 300;

const SHORT_SHA_LENGTH = 12;

/**
 * The tail of a command's output a PR body quotes: enough to read a failure, short enough to stay under GitHub's body limit.
 */
const OUTPUT_TAIL_LINES = 60;

/**
 * The most lines that report a failure a failed step's section opens with, ahead of its output tail.
 */
const FAILURE_LINE_LIMIT = 20;

const JSON_INDENT_SPACES = 2;

/**
 * The ESC that opens a terminal control sequence, either as the byte or as the caret text `^[` a log viewer or an
 * earlier copy turned it into. Both reached a PR body: create-obsidian-plugin#2 carried the caret form.
 */
const ESC = String.raw`(?:\u001B|\^\[)`;

/**
 * Control Sequence Introducer sequences (colors, cursor moves), Operating System Command sequences (hyperlinks,
 * titles, ended by BEL or ST, also as `^G`), and the two-character escapes. A two-character escape is matched only as
 * the byte, because its caret text also spells an ordinary regular expression, such as `^[A-Z]`.
 */
const TERMINAL_CONTROL_REG_EXP = new RegExp(
  String.raw`${ESC}\[[0-?]*[ -/]*[@-~]|${ESC}\][^\u0007\u001B^]*(?:\u0007|\^G|${ESC}\\)|\u001B[@-Z\\-_]`,
  'g'
);

/**
 * A line that reports a failure, which a failed step's section quotes first, because the tail may be a green test run
 * that finished after it.
 */
const FAILURE_LINE_REG_EXP = /step-failed|\bfail(?:s|ed|ure|ing)?\b|\berror\b|\bnot found\b|\bERR!|[✗×]/i;

/**
 * Writes the PR body.
 *
 * @param plan - The plan.
 * @param steps - The handler and verify runs, or `null` in a dry run, where neither runs.
 * @param diffStat - `git diff --stat` of the update commit, or `null` in a dry run.
 * @returns The body, in Markdown.
 */
export function buildPrBody(plan: SyncPlan, steps: null | StepResults, diffStat: null | string): string {
  const { entry, head, pin } = plan.status;
  const source = isGitUpstream(entry) ? `\`${entry.repo}@${entry.ref}\`` : `npm \`${entry.npm}@${entry.tag ?? 'latest'}\``;
  const lines = [
    `Upstream \`${entry.name}\` moved: ${source} from \`${pin}\` to \`${head}\`.`,
    '',
    `Compare: ${plan.status.compareUrl}`,
    ''
  ];

  if (isGitUpstream(entry)) {
    lines.push('### Changed upstream files', '', ...plan.status.changedPaths.map((path) => `- \`${path}\``));
    if (plan.status.truncated) {
      lines.push(`- GitHub lists at most ${String(COMPARE_FILE_LIMIT)} files: open the compare link for the rest.`);
    }
    lines.push('');
  }

  if (steps === null) {
    lines.push('### Handler', '', `\`${entry.handler}\`: not run (dry run).`, '');
  } else {
    lines.push(...describeStep('Handler', steps.handler));
    if (steps.verify !== null) {
      lines.push(...describeStep('Verify', steps.verify));
    }
  }

  if (diffStat !== null) {
    lines.push('### Generated changes', '', '```text', cleanCommandOutput(diffStat).trimEnd(), '```', '');
  }

  lines.push('This PR was opened by the upstream-sync job and is never merged automatically.');
  return `${lines.join('\n')}\n`;
}

/**
 * Turns a command's captured output into plain text a PR body can quote: terminal control sequences are removed,
 * whether they arrived as ESC bytes or as their caret-rendered `^[[...m` text, and a line a progress display rewrote
 * with `\r` keeps only its last state.
 *
 * @param output - The captured output.
 * @returns The plain text.
 */
export function cleanCommandOutput(output: string): string {
  return output
    .replaceAll(TERMINAL_CONTROL_REG_EXP, '')
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => toLastLineState(line))
    .join('\n');
}

/**
 * Compares one entry with its upstream.
 *
 * @param entry - The entry.
 * @param dependencies - The outside world.
 * @returns What the comparison found.
 */
export async function compareWithUpstream(entry: UpstreamEntry, dependencies: Pick<SyncDependencies, 'fetchJson'>): Promise<UpstreamStatus> {
  if (!isGitUpstream(entry)) {
    const tag = entry.tag ?? 'latest';
    const packument = await dependencies.fetchJson(`https://registry.npmjs.org/${entry.npm.replace('/', '%2f')}`) as NpmPackument;
    const head = packument['dist-tags'][tag];
    if (head === undefined) {
      throw new Error(`npm package ${entry.npm} has no dist-tag "${tag}".`);
    }
    return {
      changedPaths: [],
      compareUrl: `https://www.npmjs.com/package/${entry.npm}/v/${head}`,
      entry,
      head,
      pin: entry.version,
      state: head === entry.version ? 'current' : 'moved',
      truncated: false
    };
  }

  const commit = await dependencies.fetchJson(`https://api.github.com/repos/${entry.repo}/commits/${encodeURIComponent(entry.ref)}`) as GitHubCommit;
  const head = commit.sha;
  const compareUrl = `https://github.com/${entry.repo}/compare/${entry.commit}...${head}`;
  if (head === entry.commit) {
    return { changedPaths: [], compareUrl, entry, head, pin: entry.commit, state: 'current', truncated: false };
  }

  const compare = await dependencies.fetchJson(`https://api.github.com/repos/${entry.repo}/compare/${entry.commit}...${head}`) as GitHubCompare;
  const files = compare.files ?? [];
  const touched = new Set(files.flatMap((file) => file.previous_filename === undefined ? [file.filename] : [file.filename, file.previous_filename]));
  const changedPaths = [...touched].filter((path) => entry.paths.some((glob) => matchesGlob(path, glob))).sort();
  const isTruncated = files.length >= COMPARE_FILE_LIMIT;
  return {
    changedPaths,
    compareUrl,
    entry,
    head,
    pin: entry.commit,
    state: changedPaths.length > 0 || isTruncated ? 'moved' : 'unwatched',
    truncated: isTruncated
  };
}

/**
 * Parses and validates an `upstreams.json`.
 *
 * @param text - The file's content.
 * @returns The config.
 */
export function parseUpstreamsConfig(text: string): UpstreamsConfig {
  const config = JSON.parse(text) as Partial<UpstreamsConfig>;
  if (!Array.isArray(config.upstreams)) {
    throw new TypeError('upstreams.json has no "upstreams" array.');
  }
  // Read through `Reflect.get`, because nothing about the parsed entries is known yet.
  const entries: readonly object[] = config.upstreams;
  const names = new Set<unknown>();
  for (const entry of entries) {
    const name: unknown = Reflect.get(entry, 'name');
    const label = typeof name === 'string' ? `"${name}"` : 'with no name';
    const isGit = 'repo' in entry;
    const required = isGit ? ['name', 'repo', 'ref', 'commit', 'handler'] : ['name', 'npm', 'version', 'handler'];
    for (const key of required) {
      if (typeof Reflect.get(entry, key) !== 'string') {
        throw new TypeError(`upstreams.json: entry ${label} needs a string "${key}".`);
      }
    }
    if (isGit && !Array.isArray(Reflect.get(entry, 'paths'))) {
      throw new Error(`upstreams.json: entry ${label} needs a "paths" array.`);
    }
    if (names.has(name)) {
      throw new Error(`upstreams.json: the name ${label} is used twice.`);
    }
    names.add(name);
  }
  return config as UpstreamsConfig;
}

/**
 * Plans the PR a moved upstream asks for.
 *
 * @param status - The comparison of a moved entry.
 * @returns The branch and title.
 */
export function planSync(status: UpstreamStatus): SyncPlan {
  return {
    branch: `upstream/${status.entry.name}`,
    status,
    title: `chore(upstream): sync ${status.entry.name} to ${shorten(status.head)}`
  };
}

/**
 * Checks every entry, and opens or updates one PR per moved upstream.
 *
 * A handler or verify failure still opens the PR, as a draft with the failure in its body, so a breaking upstream change
 * is seen rather than skipped. An error in the sync itself, such as a failed API call, is reported in the entry's result
 * and the next entry still runs.
 *
 * @param options - What to sync, and how.
 * @param dependencies - The outside world.
 * @returns One result per entry checked.
 */
export async function syncUpstreams(options: SyncUpstreamsOptions, dependencies: SyncDependencies): Promise<SyncResult[]> {
  const config = parseUpstreamsConfig(readFileSync(options.configPath, 'utf-8'));
  const unknown = options.only.filter((name) => config.upstreams.every((entry) => entry.name !== name));
  if (unknown.length > 0) {
    throw new Error(`upstreams.json has no entry named ${unknown.map((name) => `"${name}"`).join(', ')}.`);
  }

  const results: SyncResult[] = [];
  for (const entry of config.upstreams) {
    if (options.only.length > 0 && !options.only.includes(entry.name)) {
      continue;
    }
    try {
      results.push(await syncEntry(entry, config, options, dependencies));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.log(`${entry.name}: ERROR ${message}`);
      results.push({ error: message, name: entry.name, outcome: 'error' });
    }
  }
  return results;
}

/**
 * Records `head` as the entry's pin in `upstreams.json`, unless the handler already moved it, keeping the file's
 * key order and formatting.
 *
 * @param configPath - The path to `upstreams.json`.
 * @param status - The comparison.
 */
export function writePin(configPath: string, status: UpstreamStatus): void {
  const text = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(text) as UpstreamsFileShape;
  const key = isGitUpstream(status.entry) ? 'commit' : 'version';
  const target = parsed.upstreams.find((entry) => entry['name'] === status.entry.name);
  if (target?.[key] !== status.pin) {
    return;
  }
  target[key] = status.head;
  writeFileSync(configPath, `${JSON.stringify(parsed, null, JSON_INDENT_SPACES)}\n`);
}

function applyPlan(plan: SyncPlan, config: UpstreamsConfig, options: SyncUpstreamsOptions, dependencies: SyncDependencies): SyncResult {
  const { entry } = plan.status;
  // No color: the output is quoted in a PR body, where a color code is only noise. `CI` is left alone, because it
  // changes what some tools do, not just how they print.
  const env = { FORCE_COLOR: '0', NO_COLOR: '1', UPSTREAM_NAME: entry.name, UPSTREAM_TARGET: plan.status.head };
  const handler: StepResult = { command: entry.handler, result: dependencies.shell(entry.handler, env) };
  writePin(options.configPath, plan.status);
  const verifyCommand = entry.verify ?? config.verify;
  const verify: null | StepResult = verifyCommand === undefined ? null : { command: verifyCommand, result: dependencies.shell(verifyCommand, env) };
  const isFailed = handler.result.exitCode !== 0 || (verify !== null && verify.result.exitCode !== 0);

  execOrThrow(dependencies, 'git', ['add', '--all']);
  execOrThrow(dependencies, 'git', ['commit', '--no-verify', '--message', plan.title]);
  const diffStat = execOrThrow(dependencies, 'git', ['diff', '--stat', 'HEAD~1', 'HEAD']);

  const body = buildPrBody(plan, { handler, verify }, diffStat);
  const isRemoteBranch = dependencies.exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', plan.branch]).exitCode === 0;
  if (isRemoteBranch) {
    execOrThrow(dependencies, 'git', ['fetch', 'origin', plan.branch]);
    if (dependencies.exec('git', ['diff', '--quiet', 'FETCH_HEAD', 'HEAD']).exitCode === 0) {
      // The body is still rewritten, so a change to how it is written reaches a PR whose branch has not moved.
      const open = findOpenPr(dependencies, plan.branch);
      if (open !== null) {
        execOrThrow(dependencies, 'gh', ['pr', 'edit', open, '--body', body]);
      }
      dependencies.log(`${entry.name}: ${plan.branch} already holds this result; nothing pushed${open === null ? '' : `, PR #${open}'s body rewritten`}.`);
      return { name: entry.name, outcome: 'unchanged' };
    }
  }
  execOrThrow(dependencies, 'git', ['push', '--force', 'origin', `HEAD:refs/heads/${plan.branch}`]);

  const existing = findOpenPr(dependencies, plan.branch);
  if (existing !== null) {
    const prNumber = Number(existing);
    execOrThrow(dependencies, 'gh', ['pr', 'edit', existing, '--title', plan.title, '--body', body]);
    execOrThrow(dependencies, 'gh', isFailed ? ['pr', 'ready', existing, '--undo'] : ['pr', 'ready', existing]);
    dependencies.log(`${entry.name}: updated PR #${existing}${isFailed ? ' (draft: a step failed)' : ''}.`);
    return { name: entry.name, outcome: 'updated', prNumber };
  }

  const url = execOrThrow(dependencies, 'gh', [
    'pr',
    'create',
    '--base',
    options.baseBranch,
    '--head',
    plan.branch,
    '--title',
    plan.title,
    '--body',
    body,
    ...(isFailed ? ['--draft'] : [])
  ]).trim();
  dependencies.log(`${entry.name}: opened ${url}${isFailed ? ' (draft: a step failed)' : ''}.`);
  const prNumber = Number(/\/pull\/(?<Number>\d+)/.exec(url)?.groups?.['Number'] ?? NaN);
  return Number.isNaN(prNumber) ? { name: entry.name, outcome: 'opened' } : { name: entry.name, outcome: 'opened', prNumber };
}

function describeStep(heading: string, step: StepResult): string[] {
  const isPassed = step.result.exitCode === 0;
  const outputLines = cleanCommandOutput(step.result.output).trimEnd().split('\n');
  const tail = outputLines.slice(-OUTPUT_TAIL_LINES).join('\n');
  const failureLines = isPassed ? [] : outputLines.filter((line) => FAILURE_LINE_REG_EXP.test(line)).slice(0, FAILURE_LINE_LIMIT);
  return [
    `### ${heading}`,
    '',
    `\`${step.command}\`: ${isPassed ? 'passed' : `**FAILED** (exit ${String(step.result.exitCode)})`}.`,
    '',
    ...(failureLines.length === 0 ? [] : ['Lines reporting the failure:', '', '```text', ...failureLines, '```', '']),
    isPassed ? '<details><summary>Output</summary>' : '<details open><summary>Output</summary>',
    '',
    '```text',
    tail,
    '```',
    '',
    '</details>',
    ''
  ];
}

function execOrThrow(dependencies: SyncDependencies, file: string, arguments_: readonly string[]): string {
  const result = dependencies.exec(file, arguments_);
  if (result.exitCode !== 0) {
    throw new Error(`${file} ${arguments_.join(' ')} failed (exit ${String(result.exitCode)}): ${result.output.trim()}`);
  }
  return result.output;
}

function findOpenPr(dependencies: SyncDependencies, branch: string): null | string {
  const number = execOrThrow(dependencies, 'gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '--jq', '.[0].number']).trim();
  return number === '' || number === 'null' ? null : number;
}

function isGitUpstream(entry: UpstreamEntry): entry is GitUpstreamEntry {
  return 'repo' in entry;
}

function shorten(head: string): string {
  return /^[0-9a-f]{40}$/.test(head) ? head.slice(0, SHORT_SHA_LENGTH) : head;
}

async function syncEntry(entry: UpstreamEntry, config: UpstreamsConfig, options: SyncUpstreamsOptions, dependencies: SyncDependencies): Promise<SyncResult> {
  const status = await compareWithUpstream(entry, dependencies);
  if (status.state === 'current') {
    dependencies.log(`${entry.name}: current at ${shorten(status.head)}.`);
    return { name: entry.name, outcome: 'current' };
  }
  if (status.state === 'unwatched') {
    dependencies.log(`${entry.name}: moved to ${shorten(status.head)}, but no watched path changed since ${shorten(status.pin)}.`);
    return { name: entry.name, outcome: 'unwatched' };
  }

  const plan = planSync(status);
  if (options.dryRun) {
    dependencies.log(`${entry.name}: moved from ${shorten(status.pin)} to ${shorten(status.head)}. Would push ${plan.branch} and open:`);
    dependencies.log(`  title: ${plan.title}`);
    dependencies.log(buildPrBody(plan, null, null).replaceAll(/^/gm, '  | '));
    return { name: entry.name, outcome: 'planned' };
  }

  // The update commit takes every file in the tree, so a file left lying around would be pushed with it.
  const dirty = execOrThrow(dependencies, 'git', ['status', '--porcelain']).trim();
  if (dirty !== '') {
    throw new Error(`the working tree is not clean, and the update commit would take these files with it:\n${dirty}`);
  }
  execOrThrow(dependencies, 'git', ['fetch', 'origin', options.baseBranch]);
  execOrThrow(dependencies, 'git', ['checkout', '-B', plan.branch, `origin/${options.baseBranch}`]);
  try {
    return applyPlan(plan, config, options, dependencies);
  } finally {
    dependencies.exec('git', ['checkout', '--force', options.baseBranch]);
    dependencies.exec('git', ['branch', '--delete', '--force', plan.branch]);
  }
}

function toLastLineState(line: string): string {
  const states = line.replace(/\r+$/, '');
  return states.slice(states.lastIndexOf('\r') + 1);
}
