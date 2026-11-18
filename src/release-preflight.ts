/**
 * @file
 *
 * Checks, before anything is bumped, that a release can be pushed and published from this checkout.
 *
 * A release writes, commits, tags and pushes, and some of those cannot be undone once they reach `origin`. Every
 * check here answers something that used to surface only at the push or at `gh release create`, after the gate had
 * been paid for and, with `shouldPublishBeforePush`, after the tag and the release were already public:
 *
 * - `origin` is a GitHub repository, and the repository `gh` resolves (where the release is created) is that one.
 * - The signed-in `gh` account may write to it.
 * - `HEAD` is on the repository's default branch, as GitHub reports it.
 * - That branch is neither behind `origin` (the push would be refused) nor ahead of it (the release would tag commits
 *   no CI run has seen).
 * - The version's tag exists neither locally nor on `origin`.
 *
 * All problems are collected and reported together, each with its fix, so one run says everything that is wrong.
 *
 * The checks were re-implemented after the release preflight of `obsidian-plugin-dev-kit`, which ran the same set.
 */

import { errorToString } from '@mnaoumov/typescript-lib/error';

import { execFromRoot } from './root.ts';

/**
 * Params for {@link assertBranchNotBehindOrigin}.
 */
export interface AssertBranchNotBehindOriginParams {
  /**
   * The branch the release commit goes to.
   */
  readonly branch: string;

  /**
   * The version being released, for the message.
   */
  readonly newVersion: string;

  /**
   * The commit the release started from, which the release commit sits on.
   */
  readonly startSha: string;
}

/**
 * Params for {@link assertReleasePreflight}.
 */
export interface AssertReleasePreflightParams {
  /**
   * The version about to be released; its tag must not exist yet.
   */
  readonly newVersion: string;

  /**
   * Whether the release will push and publish. Without it only the local tag is checked, because nothing leaves the
   * machine.
   */
  readonly shouldCheckRemote: boolean;
}

/**
 * Params for {@link getReleasePreflightProblems}.
 */
export type GetReleasePreflightProblemsParams = AssertReleasePreflightParams;

/**
 * One reason the release cannot start, with what to do about it.
 */
export interface ReleasePreflightProblem {
  /**
   * What to do about it.
   */
  readonly fix: string;

  /**
   * What is wrong.
   */
  readonly problem: string;
}

interface GhBranchRef {
  readonly name?: string;
}

interface GhRepoView {
  readonly defaultBranchRef?: GhBranchRef | null;
  readonly nameWithOwner?: string;
  readonly viewerPermission?: string;
}

const PERMISSIONS_THAT_CAN_RELEASE = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);
const GITHUB_REMOTE_URL_REG_EXP = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(?<Slug>[^/]+\/[^/]+?)(?:\.git)?\/?$/;

/**
 * Fetches the release branch again and refuses when `origin` gained commits the release commit does not sit on.
 *
 * The preflight checked this before the gate, but the gate takes minutes and `origin` can move meanwhile. Run before
 * the first push, it stops the release while nothing has left the machine, instead of after the tag and the GitHub
 * release are public and only the branch push is refused.
 *
 * @param params - The {@link AssertBranchNotBehindOriginParams}.
 * @returns A {@link Promise} that resolves when `origin` has nothing the release commit lacks.
 */
export async function assertBranchNotBehindOrigin(params: AssertBranchNotBehindOriginParams): Promise<void> {
  const { branch, newVersion, startSha } = params;
  await fetchBranch(branch);
  const behind = await execFromRoot(['git', 'rev-list', '--count', `${startSha}..${toRemoteTrackingRef(branch)}`], { isQuiet: true });
  if (behind === '0') {
    return;
  }

  throw new Error(
    `Refusing to push ${newVersion}: origin/${branch} gained ${behind} commit(s) while the release ran, so the push would be refused. `
      + `Nothing has been pushed. The release commit and the tag ${newVersion} are local only: drop them with `
      + `\`git tag -d ${newVersion}\` and \`git reset --keep ${startSha}\`, then \`git pull --ff-only\` and release again.`
  );
}

/**
 * Checks everything described in the file overview and throws one error listing every problem found.
 *
 * @param params - The {@link AssertReleasePreflightParams}.
 * @returns A {@link Promise} that resolves when the release can start.
 */
export async function assertReleasePreflight(params: AssertReleasePreflightParams): Promise<void> {
  const problems = await getReleasePreflightProblems(params);
  if (problems.length === 0) {
    return;
  }

  const lines = problems.map((problem, index) => `${String(index + 1)}. ${problem.problem} Fix: ${problem.fix}`);
  throw new Error(`Refusing to release ${params.newVersion}: the release preflight found ${String(problems.length)} problem(s).\n${lines.join('\n')}`);
}

/**
 * Collects the problems {@link assertReleasePreflight} reports.
 *
 * @param params - The {@link GetReleasePreflightProblemsParams}.
 * @returns A {@link Promise} that resolves to every problem found, in the order they are reported.
 */
export async function getReleasePreflightProblems(params: GetReleasePreflightProblemsParams): Promise<ReleasePreflightProblem[]> {
  const { newVersion, shouldCheckRemote } = params;
  const problems: ReleasePreflightProblem[] = [];

  const localTag = await execFromRoot(['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${newVersion}`], {
    isQuiet: true,
    shouldIgnoreExitCode: true
  });
  if (localTag) {
    problems.push({
      fix: `if it is left over from an abandoned attempt, delete it with \`git tag -d ${newVersion}\`; otherwise pick a version above the latest tag.`,
      problem: `The tag ${newVersion} already exists locally.`
    });
  }

  if (!shouldCheckRemote) {
    return problems;
  }

  const originSlug = await readOriginSlug(problems);
  if (originSlug === null) {
    return problems;
  }

  const defaultBranch = await readGitHubRepo(originSlug, problems);
  if (defaultBranch !== null) {
    await addBranchProblems(defaultBranch, problems);
  }

  await addRemoteTagProblems(newVersion, problems);
  return problems;
}

/**
 * Parses the `<owner>/<repo>` out of a GitHub remote URL.
 *
 * @param url - The remote URL, HTTPS or SSH.
 * @returns The `<owner>/<repo>`, or `null` when the URL is not a GitHub repository's.
 */
export function parseGitHubRemoteSlug(url: string): null | string {
  return GITHUB_REMOTE_URL_REG_EXP.exec(url.trim())?.groups?.['Slug'] ?? null;
}

async function addBranchProblems(defaultBranch: string, problems: ReleasePreflightProblem[]): Promise<void> {
  const branch = await execFromRoot(['git', 'branch', '--show-current'], { isQuiet: true });
  if (branch !== defaultBranch) {
    problems.push({
      fix: `switch with \`git switch ${defaultBranch}\`.`,
      problem: `Releases are cut from the default branch ${defaultBranch}, but this is ${branch ? `the branch ${branch}` : 'a detached HEAD'}.`
    });
    return;
  }

  try {
    await fetchBranch(defaultBranch);
  } catch (error) {
    problems.push({
      fix: 'check the network and your access to origin, then release again.',
      problem: `Could not fetch ${defaultBranch} from origin: ${errorToString(error)}`
    });
    return;
  }

  const counts = await execFromRoot(['git', 'rev-list', '--left-right', '--count', `HEAD...${toRemoteTrackingRef(defaultBranch)}`], { isQuiet: true });
  const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number);
  if (behind > 0) {
    problems.push({
      fix: 'run `git pull --ff-only` first.',
      problem: `${defaultBranch} is ${String(behind)} commit(s) behind origin/${defaultBranch}, so the release push would be refused.`
    });
  }

  if (ahead > 0) {
    problems.push({
      fix: 'push them first, wait for CI to pass on them, and release again.',
      problem: `${defaultBranch} is ${String(ahead)} commit(s) ahead of origin/${defaultBranch}: no CI run has seen them, and the release would tag them.`
    });
  }
}

async function addRemoteTagProblems(newVersion: string, problems: ReleasePreflightProblem[]): Promise<void> {
  let remoteTag: string;
  try {
    remoteTag = await execFromRoot(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${newVersion}`], { isQuiet: true });
  } catch (error) {
    problems.push({
      fix: 'check the network and your access to origin, then release again.',
      problem: `Could not ask origin whether the tag ${newVersion} exists: ${errorToString(error)}`
    });
    return;
  }

  if (remoteTag) {
    problems.push({
      fix: 'a published tag is never moved or deleted; pick a version above the latest tag.',
      problem: `The tag ${newVersion} already exists on origin.`
    });
  }
}

async function fetchBranch(branch: string): Promise<void> {
  await execFromRoot(['git', 'fetch', '--no-tags', 'origin', `+refs/heads/${branch}:${toRemoteTrackingRef(branch)}`], { isQuiet: true });
}

async function readGitHubRepo(originSlug: string, problems: ReleasePreflightProblem[]): Promise<null | string> {
  let repo: GhRepoView;
  try {
    repo = JSON.parse(await execFromRoot(['gh', 'repo', 'view', '--json', 'nameWithOwner,viewerPermission,defaultBranchRef'], { isQuiet: true })) as GhRepoView;
  } catch (error) {
    problems.push({
      fix: 'sign in with `gh auth login`, or switch to the account that can push to origin with `gh auth switch` (check `gh auth status`).',
      problem: `gh cannot see the repository: ${errorToString(error)}`
    });
    return null;
  }

  const nameWithOwner = repo.nameWithOwner ?? '';
  if (nameWithOwner.toLowerCase() !== originSlug.toLowerCase()) {
    problems.push({
      fix: `point gh at origin with \`gh repo set-default ${originSlug}\`.`,
      problem: `gh resolves this checkout to ${nameWithOwner || 'no repository'}, but origin is ${originSlug}, so the tag and the GitHub release would go to different repositories.`
    });
    return null;
  }

  const permission = repo.viewerPermission ?? '';
  if (!PERMISSIONS_THAT_CAN_RELEASE.has(permission)) {
    problems.push({
      fix: 'switch to an account that can push to the repository with `gh auth switch` (check `gh auth status`).',
      problem: `The signed-in gh account has ${permission ? permission.toLowerCase() : 'no'} access to ${originSlug}, and releasing needs write access.`
    });
  }

  const defaultBranch = repo.defaultBranchRef?.name ?? '';
  if (!defaultBranch) {
    problems.push({
      fix: 'push a branch to the repository and set it as the default on GitHub.',
      problem: `GitHub reports no default branch for ${originSlug}.`
    });
    return null;
  }

  return defaultBranch;
}

async function readOriginSlug(problems: ReleasePreflightProblem[]): Promise<null | string> {
  const originUrl = await execFromRoot(['git', 'config', '--get', 'remote.origin.url'], { isQuiet: true, shouldIgnoreExitCode: true });
  if (!originUrl) {
    problems.push({
      fix: 'add it with `git remote add origin <url>`.',
      problem: 'The repository has no remote called origin.'
    });
    return null;
  }

  const slug = parseGitHubRemoteSlug(originUrl);
  if (slug === null) {
    problems.push({
      fix: 'the release needs origin to be https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git.',
      problem: `origin (${originUrl}) is not a GitHub repository URL.`
    });
  }

  return slug;
}

function toRemoteTrackingRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}
