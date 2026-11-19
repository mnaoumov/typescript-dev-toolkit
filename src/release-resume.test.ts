import { noopAsync } from '@mnaoumov/typescript-lib/function';
import dedent from 'dedent';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  assertReleaseResumable,
  continueRelease,
  getResumeCommand,
  ReleaseProgress
} from './release-resume.ts';

const { mockExecFromRoot } = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string | string[], options?: object) => Promise<unknown>>()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot
}));

const TAG_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

interface ContinueOutcome {
  readonly commands: string[];
  readonly publishRelease: ReturnType<typeof vi.fn>;
}

interface Origin {
  readonly branchContainsTag?: boolean;
  readonly releaseJson?: string;
  readonly releaseViewError?: string;
  readonly remoteTagLines?: string;
}

function newProgress(shouldPublishBeforePush = false): ReleaseProgress {
  return new ReleaseProgress({ branch: 'main', shouldPublishBeforePush, version: '1.2.3' });
}

function playOrigin(origin: Origin = {}): string[] {
  const commands: string[] = [];
  mockExecFromRoot.mockImplementation((command) => {
    const text = Array.isArray(command) ? command.join(' ') : command;
    commands.push(text);
    if (text.startsWith('git merge-base --is-ancestor')) {
      return Promise.resolve({ exitCode: origin.branchContainsTag ? 0 : 1 });
    }
    if (text.startsWith('git ls-remote --tags')) {
      return Promise.resolve(origin.remoteTagLines ?? '');
    }
    if (text.startsWith('gh release view')) {
      return origin.releaseViewError === undefined ? Promise.resolve(origin.releaseJson ?? '{"isDraft":false}') : Promise.reject(new Error(origin.releaseViewError));
    }
    return Promise.resolve('');
  });
  return commands;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ReleaseProgress', () => {
  it('should order the steps the way each release mode runs them', () => {
    expect(newProgress().steps).toEqual(['push-branch', 'push-tag', 'publish-release', 'close-issues']);
    expect(newProgress(true).steps).toEqual(['push-tag', 'publish-release', 'push-branch', 'close-issues']);
  });

  it('should describe a stop before any step', () => {
    expect(newProgress().describeStop(false)).toBe(dedent`
      The release of 1.2.3 stopped after its local commit and tag.
      - The branch main was not pushed.
      - The tag 1.2.3 was not pushed.
      - The GitHub release 1.2.3 is not published.
      - The issues the release carries are not closed yet.
      The local release commit and the tag 1.2.3 are kept. Every step checks origin first and skips what is already there, so to continue run:
        npm run version '--' 1.2.3 --resume
    `);
  });

  it('should mark the done steps and the failed one', async () => {
    const progress = newProgress();
    await progress.run('push-branch', noopAsync);
    await expect(progress.run('push-tag', () => Promise.reject(new Error('refused')))).rejects.toThrow('refused');
    const report = progress.describeStop(false);
    expect(report).toContain('The release of 1.2.3 stopped while pushing the tag 1.2.3.');
    expect(report).toContain('- The release commit is on origin\'s main.');
    expect(report).toContain('- The tag 1.2.3 was not pushed.');
  });

  it.each(
    [
      ['push-branch', 'The push of main was in flight: `git ls-remote origin refs/heads/main` shows whether it arrived.'],
      ['push-tag', 'The push of the tag 1.2.3 was in flight: `git ls-remote --tags origin refs/tags/1.2.3` shows whether it arrived.'],
      ['publish-release', 'Publishing the GitHub release 1.2.3 was in flight: `gh release view 1.2.3` shows whether it exists.'],
      ['close-issues', 'Closing the issues the release carries was in flight; a resume skips the ones already closed.']
    ] as const
  )('should say how to check the %s step an interrupt caught in flight', async (step, inFlight) => {
    const progress = newProgress();
    let report = '';
    await progress.run(step, () => {
      report = progress.describeStop(true);
      return noopAsync();
    });
    expect(report).toContain('The release of 1.2.3 was interrupted while ');
    expect(report).toContain(`- ${inFlight}`);
  });

  it('should describe every step done', async () => {
    const progress = newProgress();
    for (const step of progress.steps) {
      await progress.run(step, noopAsync);
    }
    const report = progress.describeStop(true);
    expect(report).toContain('The release of 1.2.3 was interrupted after its local commit and tag.');
    expect(report).toContain('- The GitHub release 1.2.3 is published.');
    expect(report).toContain('- The issues the release carries are closed.');
    expect(report).toContain('- The tag 1.2.3 is on origin.');
  });
});

describe('getResumeCommand', () => {
  it('should quote the npm separator for PowerShell', () => {
    expect(getResumeCommand('2.0.0-beta.1')).toBe('npm run version \'--\' 2.0.0-beta.1 --resume');
  });
});

describe('assertReleaseResumable', () => {
  function playLocal(tagSha: string, headSha: string): string[] {
    const commands: string[] = [];
    mockExecFromRoot.mockImplementation((command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      commands.push(text);
      if (text.startsWith('git rev-parse --verify --quiet')) {
        return Promise.resolve(tagSha);
      }
      return Promise.resolve(text === 'git rev-parse HEAD' ? headSha : '');
    });
    return commands;
  }

  it('should return the tagged commit and fetch the branch', async () => {
    const commands = playLocal(TAG_SHA, TAG_SHA);
    await expect(assertReleaseResumable({ branch: 'main', version: '1.2.3' })).resolves.toBe(TAG_SHA);
    expect(commands).toContain('git fetch origin +refs/heads/main:refs/remotes/origin/main');
    expect(mockExecFromRoot).toHaveBeenCalledWith(['git', 'fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main'], { isQuiet: true, shouldIgnoreExitCode: true });
  });

  it('should refuse a version with no local tag', async () => {
    playLocal('', TAG_SHA);
    await expect(assertReleaseResumable({ branch: 'main', version: '1.2.3' })).rejects.toThrow('there is no local tag 1.2.3');
  });

  it('should refuse a detached HEAD', async () => {
    playLocal(TAG_SHA, TAG_SHA);
    await expect(assertReleaseResumable({ branch: '', version: '1.2.3' })).rejects.toThrow('HEAD is detached');
  });

  it('should refuse a HEAD away from the tagged commit', async () => {
    const commands = playLocal(TAG_SHA, OTHER_SHA);
    await expect(assertReleaseResumable({ branch: 'main', version: '1.2.3' })).rejects.toThrow(`HEAD is ${OTHER_SHA}, but the tag 1.2.3 names ${TAG_SHA}`);
    expect(commands.some((command) => command.startsWith('git fetch'))).toBe(false);
  });
});

describe('continueRelease', () => {
  async function continueWith(origin: Origin): Promise<ContinueOutcome> {
    const commands = playOrigin(origin);
    const publishRelease = vi.fn(noopAsync);
    await continueRelease({ closeIssues: noopAsync, progress: newProgress(), publishRelease, tagSha: TAG_SHA });
    return { commands, publishRelease };
  }

  it('should do every step when nothing reached origin', async () => {
    const closeIssues = vi.fn(noopAsync);
    const publishRelease = vi.fn(noopAsync);
    const commands = playOrigin({ releaseViewError: 'release not found' });
    const progress = newProgress();
    await continueRelease({ closeIssues, progress, publishRelease, tagSha: TAG_SHA });
    expect(commands.filter((command) => command.startsWith('git push'))).toEqual([
      `git push origin ${TAG_SHA}:refs/heads/main`,
      'git push origin refs/tags/1.2.3:refs/tags/1.2.3'
    ]);
    expect(publishRelease).toHaveBeenCalledOnce();
    expect(closeIssues).toHaveBeenCalledOnce();
    expect(progress.describeStop(false)).toContain('- The issues the release carries are closed.');
  });

  it('should skip what is already on origin', async () => {
    const { commands, publishRelease } = await continueWith({
      branchContainsTag: true,
      remoteTagLines: `${OTHER_SHA}\trefs/tags/1.2.3\n${TAG_SHA}\trefs/tags/1.2.3^{}\n`
    });
    expect(commands.some((command) => command.startsWith('git push'))).toBe(false);
    expect(commands.some((command) => command.startsWith('gh release edit'))).toBe(false);
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it('should take a lightweight tag on origin naming the commit as pushed', async () => {
    const { commands } = await continueWith({ branchContainsTag: true, remoteTagLines: `${TAG_SHA}\trefs/tags/1.2.3` });
    expect(commands.some((command) => command.startsWith('git push'))).toBe(false);
  });

  it('should publish a release left as a draft', async () => {
    const { commands, publishRelease } = await continueWith({ branchContainsTag: true, releaseJson: '{"isDraft":true}', remoteTagLines: `${TAG_SHA}\trefs/tags/1.2.3` });
    expect(commands).toContain('gh release edit 1.2.3 --draft=false');
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it('should refuse a tag on origin that names another commit', async () => {
    playOrigin({ remoteTagLines: `${OTHER_SHA}\trefs/tags/1.2.3^{}` });
    const progress = newProgress();
    await expect(continueRelease({ closeIssues: noopAsync, progress, publishRelease: noopAsync, tagSha: TAG_SHA })).rejects.toThrow(
      `origin already has a tag 1.2.3 naming ${OTHER_SHA}, not the release commit ${TAG_SHA}`
    );
    expect(progress.describeStop(false)).toContain('stopped while pushing the tag 1.2.3');
  });

  it('should rethrow a release lookup that failed for another reason', async () => {
    playOrigin({ branchContainsTag: true, releaseViewError: 'HTTP 502', remoteTagLines: `${TAG_SHA}\trefs/tags/1.2.3` });
    const publishRelease = vi.fn(noopAsync);
    await expect(continueRelease({ closeIssues: noopAsync, progress: newProgress(), publishRelease, tagSha: TAG_SHA })).rejects.toThrow('HTTP 502');
    expect(publishRelease).not.toHaveBeenCalled();
  });

  it('should run the steps in the publish-before-push order', async () => {
    const order: string[] = [];
    playOrigin({ releaseViewError: 'release not found' });
    const implementation = mockExecFromRoot.getMockImplementation();
    mockExecFromRoot.mockImplementation((command, options) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      if (text.startsWith('git push')) {
        order.push(text.includes('refs/tags/') ? 'tag' : 'branch');
      }
      return implementation?.(command, options) ?? Promise.resolve('');
    });
    await continueRelease({
      closeIssues: () => {
        order.push('issues');
        return noopAsync();
      },
      progress: newProgress(true),
      publishRelease: () => {
        order.push('release');
        return noopAsync();
      },
      tagSha: TAG_SHA
    });
    expect(order).toEqual(['tag', 'release', 'branch', 'issues']);
  });
});
