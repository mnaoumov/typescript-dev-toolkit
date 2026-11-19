/**
 * @file
 *
 * The part of a release that reaches origin, made resumable. A release that stops after its local tag (a failed
 * push, a GitHub outage, Ctrl+C) says which steps are on origin, which one was in flight and the one command that
 * continues, and {@link continueRelease} continues from an existing local tag: every step checks origin first and
 * skips what is already there. Re-implemented after `obsidian-plugin-dev-kit`'s `src/release/publish-state.ts` and
 * `publish-command.ts` (MIT).
 */

import { errorToString } from '@mnaoumov/typescript-lib/error';

import { execFromRoot } from './root.ts';

// The fields of a git ls-remote line: the object name and the ref.
const LS_REMOTE_FIELD_COUNT = 2;

// The revision suffix that peels a tag to the commit it names.
const PEEL_TO_COMMIT = '^{commit}';

/**
 * Parameters for {@link assertReleaseResumable}.
 */
export interface AssertReleaseResumableParams {
  /**
   * The checked-out branch, or an empty string for a detached `HEAD`.
   */
  readonly branch: string;

  /**
   * The version whose release is resumed.
   */
  readonly version: string;
}

/**
 * Parameters for {@link continueRelease}.
 */
export interface ContinueReleaseParams {
  /**
   * Closes the issues the release carries. It must not throw for an already published release.
   *
   * @returns A {@link Promise} that resolves when the issues are closed.
   */
  readonly closeIssues: () => Promise<void>;

  /**
   * Where the steps are recorded, so a stop can be described.
   */
  readonly progress: ReleaseProgress;

  /**
   * Creates the GitHub release; called only when the release does not exist yet.
   *
   * @returns A {@link Promise} that resolves when the release is published.
   */
  readonly publishRelease: () => Promise<void>;

  /**
   * The commit the local tag names, as {@link assertReleaseResumable} returns it.
   */
  readonly tagSha: string;
}

/**
 * Parameters for {@link ReleaseProgress}.
 */
export interface ReleaseProgressConstructorParams {
  /**
   * The branch the release commit goes to.
   */
  readonly branch: string;

  /**
   * Whether the release is published before the branch is pushed. It decides the order of the steps.
   */
  readonly shouldPublishBeforePush: boolean;

  /**
   * The version being released, which is also its tag.
   */
  readonly version: string;
}

/**
 * A step of a release that reaches origin.
 */
export type ReleaseStep = 'close-issues' | 'publish-release' | 'push-branch' | 'push-tag';

interface ReleaseDraftState {
  readonly isDraft?: boolean;
}

interface StepTexts {
  readonly done: string;
  readonly inFlight: string;
  readonly label: string;
  readonly notDone: string;
}

/**
 * Records which steps of the release have reached origin, and describes a stop.
 */
export class ReleaseProgress {
  /**
   * The branch the release commit goes to.
   */
  public readonly branch: string;

  /**
   * The steps, in the order they run.
   */
  public readonly steps: readonly ReleaseStep[];

  /**
   * The version being released.
   */
  public readonly version: string;

  private currentStep: null | ReleaseStep = null;
  private readonly doneSteps = new Set<ReleaseStep>();

  /**
   * Creates the progress of one release.
   *
   * @param params - The {@link ReleaseProgressConstructorParams}.
   */
  public constructor(params: ReleaseProgressConstructorParams) {
    this.branch = params.branch;
    this.version = params.version;
    this.steps = params.shouldPublishBeforePush
      ? ['push-tag', 'publish-release', 'push-branch', 'close-issues']
      : ['push-branch', 'push-tag', 'publish-release', 'close-issues'];
  }

  /**
   * Describes where the release stopped: each step done, in flight or not reached, and the command that resumes.
   *
   * @param isInterrupted - Whether Ctrl+C stopped it, so the step it was running may or may not have reached origin.
   * @returns The report, one line per statement.
   */
  public describeStop(isInterrupted: boolean): string {
    const verb = isInterrupted ? 'was interrupted' : 'stopped';
    const where = this.currentStep === null ? 'after its local commit and tag' : `while ${this.texts(this.currentStep).label}`;
    const lines = [`The release of ${this.version} ${verb} ${where}.`];
    for (const step of this.steps) {
      const texts = this.texts(step);
      if (this.doneSteps.has(step)) {
        lines.push(`- ${texts.done}`);
      } else if (step === this.currentStep && isInterrupted) {
        lines.push(`- ${texts.inFlight}`);
      } else {
        lines.push(`- ${texts.notDone}`);
      }
    }
    lines.push(
      `The local release commit and the tag ${this.version} are kept. Every step checks origin first and skips what is already there, so to continue run:`,
      `  ${getResumeCommand(this.version)}`
    );
    return lines.join('\n');
  }

  /**
   * Runs one step and records it as done once it succeeds.
   *
   * @param step - The step.
   * @param action - What the step does.
   * @returns A {@link Promise} that resolves when the step is done.
   */
  public async run(step: ReleaseStep, action: () => Promise<void>): Promise<void> {
    this.currentStep = step;
    await action();
    this.doneSteps.add(step);
    this.currentStep = null;
  }

  private texts(step: ReleaseStep): StepTexts {
    const { branch, version } = this;
    const textsByStep: Record<ReleaseStep, StepTexts> = {
      'close-issues': {
        done: 'The issues the release carries are closed.',
        inFlight: 'Closing the issues the release carries was in flight; a resume skips the ones already closed.',
        label: 'closing the issues the release carries',
        notDone: 'The issues the release carries are not closed yet.'
      },
      'publish-release': {
        done: `The GitHub release ${version} is published.`,
        inFlight: `Publishing the GitHub release ${version} was in flight: \`gh release view ${version}\` shows whether it exists.`,
        label: `publishing the GitHub release ${version}`,
        notDone: `The GitHub release ${version} is not published.`
      },
      'push-branch': {
        done: `The release commit is on origin's ${branch}.`,
        inFlight: `The push of ${branch} was in flight: \`git ls-remote origin refs/heads/${branch}\` shows whether it arrived.`,
        label: `pushing ${branch}`,
        notDone: `The branch ${branch} was not pushed.`
      },
      'push-tag': {
        done: `The tag ${version} is on origin.`,
        inFlight: `The push of the tag ${version} was in flight: \`git ls-remote --tags origin refs/tags/${version}\` shows whether it arrived.`,
        label: `pushing the tag ${version}`,
        notDone: `The tag ${version} was not pushed.`
      }
    };
    return textsByStep[step];
  }
}

/**
 * Checks that a stopped release can be continued from here: its local tag exists, and the checkout is on a branch
 * with `HEAD` at the tagged commit, which is where a stopped release leaves it. Then it fetches origin's branch, so
 * {@link continueRelease} can tell whether the branch was pushed.
 *
 * @param params - The {@link AssertReleaseResumableParams}.
 * @returns A {@link Promise} that resolves to the commit the tag names.
 */
export async function assertReleaseResumable(params: AssertReleaseResumableParams): Promise<string> {
  const { branch, version } = params;
  const tagSha = await execFromRoot(['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${version}${PEEL_TO_COMMIT}`], { isQuiet: true, shouldIgnoreExitCode: true });
  if (!tagSha) {
    throw new Error(`Cannot resume the release of ${version}: there is no local tag ${version}. Only a release that got as far as its tag can be resumed; run the release again instead.`);
  }

  if (!branch) {
    throw new Error(`Cannot resume the release of ${version}: HEAD is detached. Switch to the branch the release was made on, at the commit tagged ${version}.`);
  }

  const headSha = await execFromRoot(['git', 'rev-parse', 'HEAD'], { isQuiet: true });
  if (headSha !== tagSha) {
    throw new Error(
      `Cannot resume the release of ${version}: HEAD is ${headSha}, but the tag ${version} names ${tagSha}. `
        + `The release publishes the checked-out tree, so check out ${branch} at the tagged commit first.`
    );
  }

  // A branch origin does not have yet fails the fetch; the push step then creates it.
  await execFromRoot(['git', 'fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { isQuiet: true, shouldIgnoreExitCode: true });
  return tagSha;
}

/**
 * Continues a release from its existing local tag, once {@link assertReleaseResumable} has passed. Each step checks
 * origin first:
 *
 * - the branch is pushed (never forced) only when origin's branch does not contain the tagged commit yet;
 * - the tag is pushed only when origin has none, and a tag on origin naming another commit is refused;
 * - the release is created only when none exists, and a draft is published;
 * - the issues are closed by `closeIssues`, which skips what is already done.
 *
 * @param params - The {@link ContinueReleaseParams}.
 * @returns A {@link Promise} that resolves when every step is done.
 */
export async function continueRelease(params: ContinueReleaseParams): Promise<void> {
  const { progress, tagSha } = params;
  const { branch, version } = progress;
  const actions: Record<ReleaseStep, () => Promise<void>> = {
    'close-issues': () => params.closeIssues(),
    'publish-release': publishReleaseIfMissing,
    'push-branch': pushBranchIfMissing,
    'push-tag': pushTagIfMissing
  };
  for (const step of progress.steps) {
    await progress.run(step, actions[step]);
  }

  async function publishReleaseIfMissing(): Promise<void> {
    let releaseJson: string;
    try {
      releaseJson = await execFromRoot(['gh', 'release', 'view', version, '--json', 'isDraft'], { isQuiet: true });
    } catch (error) {
      if (!/release not found/i.test(errorToString(error))) {
        throw error;
      }
      await params.publishRelease();
      return;
    }

    const release = JSON.parse(releaseJson) as ReleaseDraftState;
    if (release.isDraft === true) {
      await execFromRoot(['gh', 'release', 'edit', version, '--draft=false'], { isQuiet: true });
    }
  }

  async function pushBranchIfMissing(): Promise<void> {
    const result = await execFromRoot(['git', 'merge-base', '--is-ancestor', tagSha, `refs/remotes/origin/${branch}`], {
      isQuiet: true,
      shouldIgnoreExitCode: true,
      shouldIncludeDetails: true
    });
    if (result.exitCode === 0) {
      return;
    }
    // Exit 1 is "not an ancestor"; any other failure (no such branch on origin) is answered by the push itself.
    await execFromRoot(['git', 'push', 'origin', `${tagSha}:refs/heads/${branch}`], { isQuiet: true });
  }

  async function pushTagIfMissing(): Promise<void> {
    const remoteTagSha = await readRemoteTagSha();
    if (remoteTagSha === tagSha) {
      return;
    }
    if (remoteTagSha) {
      throw new Error(
        `Refusing to push the tag ${version}: origin already has a tag ${version} naming ${remoteTagSha}, not the release commit ${tagSha}. `
          + 'Find out which release is right before deleting either tag.'
      );
    }
    await execFromRoot(['git', 'push', 'origin', `refs/tags/${version}:refs/tags/${version}`], { isQuiet: true });
  }

  async function readRemoteTagSha(): Promise<string> {
    const output = await execFromRoot(['git', 'ls-remote', '--tags', 'origin', `refs/tags/${version}`, `refs/tags/${version}^{}`], { isQuiet: true });
    const refs = new Map(
      output.split(/\r?\n/).filter(Boolean).map((line) => {
        const [sha = '', ref = ''] = line.split(/\s+/, LS_REMOTE_FIELD_COUNT);
        return [ref, sha] as const;
      })
    );
    // An annotated tag is listed twice: the tag object, then the commit it names (`^{}`).
    return refs.get(`refs/tags/${version}^{}`) ?? refs.get(`refs/tags/${version}`) ?? '';
  }
}

/**
 * The command that resumes a stopped release of a version.
 *
 * @param version - The version.
 * @returns The command, as typed in PowerShell or a POSIX shell.
 */
export function getResumeCommand(version: string): string {
  return `npm run version '--' ${version} --resume`;
}
