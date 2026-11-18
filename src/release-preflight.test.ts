import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  assertBranchNotBehindOrigin,
  assertReleasePreflight,
  getReleasePreflightProblems,
  parseGitHubRemoteSlug
} from './release-preflight.ts';

const { mockExecFromRoot } = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string | string[]) => Promise<string>>()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot
}));

const START_SHA = 'a'.repeat(40);

interface RepoState {
  readonly branch?: string;
  readonly counts?: string;
  readonly fetchError?: string;
  readonly ghError?: string;
  readonly ghView?: object;
  readonly localTag?: string;
  readonly lsRemoteError?: string;
  readonly originUrl?: string;
  readonly remoteTag?: string;
}

function playRepo(state: RepoState = {}): string[] {
  const commands: string[] = [];
  mockExecFromRoot.mockImplementation((command) => {
    const text = Array.isArray(command) ? command.join(' ') : command;
    commands.push(text);
    if (text.startsWith('git rev-parse --verify --quiet refs/tags/')) {
      return Promise.resolve(state.localTag ?? '');
    }
    if (text === 'git config --get remote.origin.url') {
      return Promise.resolve(state.originUrl ?? 'https://github.com/owner/repo.git');
    }
    if (text.startsWith('gh repo view')) {
      return state.ghError === undefined
        ? Promise.resolve(JSON.stringify(state.ghView ?? { defaultBranchRef: { name: 'main' }, nameWithOwner: 'owner/repo', viewerPermission: 'ADMIN' }) ?? '')
        : Promise.reject(new Error(state.ghError));
    }
    if (text === 'git branch --show-current') {
      return Promise.resolve(state.branch ?? 'main');
    }
    if (text.startsWith('git fetch')) {
      return state.fetchError === undefined ? Promise.resolve('') : Promise.reject(new Error(state.fetchError));
    }
    if (text.startsWith('git rev-list --left-right --count')) {
      return Promise.resolve(state.counts ?? '0\t0');
    }
    if (text.startsWith('git ls-remote')) {
      return state.lsRemoteError === undefined ? Promise.resolve(state.remoteTag ?? '') : Promise.reject(new Error(state.lsRemoteError));
    }
    return Promise.reject(new Error(`unexpected command: ${text}`));
  });
  return commands;
}

async function problemsOf(state: RepoState): Promise<string[]> {
  playRepo(state);
  const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: true });
  return problems.map((problem) => problem.problem);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('parseGitHubRemoteSlug', () => {
  it.each([
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo/', 'owner/repo'],
    ['https://user@github.com/owner/repo.git', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['ssh://git@github.com/owner/my.repo.git\n', 'owner/my.repo']
  ])('should read %s as %s', (url, slug) => {
    expect(parseGitHubRemoteSlug(url)).toBe(slug);
  });

  it.each(['https://gitlab.com/owner/repo.git', 'https://github.com/owner', 'F:/repos/repo'])('should refuse %s', (url) => {
    expect(parseGitHubRemoteSlug(url)).toBeNull();
  });
});

describe('getReleasePreflightProblems', () => {
  it('should find nothing on a default branch in step with origin', async () => {
    const commands = playRepo();
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: true })).resolves.toEqual([]);
    expect(commands).toContain('git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main');
    expect(commands).toContain('git rev-list --left-right --count HEAD...refs/remotes/origin/main');
    expect(commands).toContain('git ls-remote --tags origin refs/tags/1.0.1');
  });

  it('should check only the local tag when nothing will be pushed', async () => {
    const commands = playRepo({ localTag: START_SHA });
    const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false });
    expect(problems.map((problem) => problem.problem)).toEqual(['The tag 1.0.1 already exists locally.']);
    expect(commands).toEqual(['git rev-parse --verify --quiet refs/tags/1.0.1']);
  });

  it('should report a missing origin and stop there', async () => {
    await expect(problemsOf({ originUrl: '' })).resolves.toEqual(['The repository has no remote called origin.']);
  });

  it('should report an origin that is not on GitHub', async () => {
    await expect(problemsOf({ originUrl: 'https://gitlab.com/owner/repo.git' })).resolves.toEqual([
      'origin (https://gitlab.com/owner/repo.git) is not a GitHub repository URL.'
    ]);
  });

  it('should report gh failing, and still check the remote tag', async () => {
    const problems = await problemsOf({ ghError: 'To get started with GitHub CLI, please run: gh auth login', remoteTag: `${START_SHA}\trefs/tags/1.0.1` });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('gh cannot see the repository: ');
    expect(problems[0]).toContain('gh auth login');
    expect(problems[1]).toBe('The tag 1.0.1 already exists on origin.');
  });

  it('should report gh resolving another repository than origin', async () => {
    await expect(problemsOf({ ghView: { nameWithOwner: 'upstream/repo' } })).resolves.toEqual([
      'gh resolves this checkout to upstream/repo, but origin is owner/repo, so the tag and the GitHub release would go to different repositories.'
    ]);
    await expect(problemsOf({ ghView: {} })).resolves.toEqual([
      'gh resolves this checkout to no repository, but origin is owner/repo, so the tag and the GitHub release would go to different repositories.'
    ]);
  });

  it('should compare the repository case-insensitively', async () => {
    await expect(problemsOf({ ghView: { defaultBranchRef: { name: 'main' }, nameWithOwner: 'Owner/Repo', viewerPermission: 'WRITE' } })).resolves.toEqual([]);
  });

  it('should report an account that cannot write', async () => {
    await expect(problemsOf({ ghView: { defaultBranchRef: { name: 'main' }, nameWithOwner: 'owner/repo', viewerPermission: 'READ' } })).resolves.toEqual([
      'The signed-in gh account has read access to owner/repo, and releasing needs write access.'
    ]);
    await expect(problemsOf({ ghView: { defaultBranchRef: { name: 'main' }, nameWithOwner: 'owner/repo' } })).resolves.toEqual([
      'The signed-in gh account has no access to owner/repo, and releasing needs write access.'
    ]);
  });

  it('should report a repository GitHub knows no default branch for', async () => {
    await expect(problemsOf({ ghView: { defaultBranchRef: null, nameWithOwner: 'owner/repo', viewerPermission: 'MAINTAIN' } })).resolves.toEqual([
      'GitHub reports no default branch for owner/repo.'
    ]);
  });

  it('should report another branch, or a detached HEAD, without fetching', async () => {
    await expect(problemsOf({ branch: 'T1' })).resolves.toEqual(['Releases are cut from the default branch main, but this is the branch T1.']);
    const commands = playRepo({ branch: '' });
    const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: true });
    expect(problems.map((problem) => problem.problem)).toEqual(['Releases are cut from the default branch main, but this is a detached HEAD.']);
    expect(commands.some((command) => command.startsWith('git fetch'))).toBe(false);
  });

  it('should report a failed fetch', async () => {
    const problems = await problemsOf({ fetchError: 'Could not resolve host: github.com' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Could not fetch main from origin: ');
    expect(problems[0]).toContain('Could not resolve host');
  });

  it('should report a branch behind origin', async () => {
    await expect(problemsOf({ counts: '0\t3' })).resolves.toEqual(['main is 3 commit(s) behind origin/main, so the release push would be refused.']);
  });

  it('should report a branch ahead of origin', async () => {
    await expect(problemsOf({ counts: '2\t0' })).resolves.toEqual([
      'main is 2 commit(s) ahead of origin/main: no CI run has seen them, and the release would tag them.'
    ]);
  });

  it('should read missing counts as in step', async () => {
    await expect(problemsOf({ counts: '' })).resolves.toEqual([]);
  });

  it('should report a remote tag that could not be read', async () => {
    const problems = await problemsOf({ lsRemoteError: 'Permission denied (publickey)' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Could not ask origin whether the tag 1.0.1 exists: ');
  });

  it('should report every problem together', async () => {
    await expect(problemsOf({ counts: '1\t1', localTag: START_SHA, remoteTag: `${START_SHA}\trefs/tags/1.0.1` })).resolves.toEqual([
      'The tag 1.0.1 already exists locally.',
      'main is 1 commit(s) behind origin/main, so the release push would be refused.',
      'main is 1 commit(s) ahead of origin/main: no CI run has seen them, and the release would tag them.',
      'The tag 1.0.1 already exists on origin.'
    ]);
  });
});

describe('assertReleasePreflight', () => {
  it('should pass when nothing is wrong', async () => {
    playRepo();
    await expect(assertReleasePreflight({ newVersion: '1.0.1', shouldCheckRemote: true })).resolves.toBeUndefined();
  });

  it('should list every problem with its fix', async () => {
    playRepo({ branch: 'T1', localTag: START_SHA });
    await expect(assertReleasePreflight({ newVersion: '1.0.1', shouldCheckRemote: true })).rejects.toThrow(
      'Refusing to release 1.0.1: the release preflight found 2 problem(s).\n'
        + '1. The tag 1.0.1 already exists locally. Fix: if it is left over from an abandoned attempt, delete it with `git tag -d 1.0.1`; '
        + 'otherwise pick a version above the latest tag.\n'
        + '2. Releases are cut from the default branch main, but this is the branch T1. Fix: switch with `git switch main`.'
    );
  });
});

describe('assertBranchNotBehindOrigin', () => {
  function playBehind(behind: string): string[] {
    const commands: string[] = [];
    mockExecFromRoot.mockImplementation((command) => {
      const text = Array.isArray(command) ? command.join(' ') : command;
      commands.push(text);
      return Promise.resolve(text.startsWith('git rev-list') ? behind : '');
    });
    return commands;
  }

  it('should pass when origin has nothing new', async () => {
    const commands = playBehind('0');
    await expect(assertBranchNotBehindOrigin({ branch: 'main', newVersion: '1.0.1', startSha: START_SHA })).resolves.toBeUndefined();
    expect(commands).toEqual([
      'git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main',
      `git rev-list --count ${START_SHA}..refs/remotes/origin/main`
    ]);
  });

  it('should refuse, with the way back, when origin moved', async () => {
    playBehind('2');
    await expect(assertBranchNotBehindOrigin({ branch: 'main', newVersion: '1.0.1', startSha: START_SHA })).rejects.toThrow(
      'Refusing to push 1.0.1: origin/main gained 2 commit(s) while the release ran, so the push would be refused. Nothing has been pushed. '
        + `The release commit and the tag 1.0.1 are local only: drop them with \`git tag -d 1.0.1\` and \`git reset --keep ${START_SHA}\`, `
        + 'then `git pull --ff-only` and release again.'
    );
  });
});
