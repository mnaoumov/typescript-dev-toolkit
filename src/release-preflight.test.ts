import type { PackageJson } from 'type-fest';

import { noop } from '@mnaoumov/typescript-lib/function';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvePathFromRootSafeParams } from './root.ts';

import {
  assertBranchNotBehindOrigin,
  assertReleasePreflight,
  getReleasePreflightProblems,
  parseGitHubRemoteSlug
} from './release-preflight.ts';

const { mockExecFromRoot, mockReadJson, mockReadPackageJson } = vi.hoisted(() => ({
  mockExecFromRoot: vi.fn<(command: string | string[]) => Promise<string>>(),
  mockReadJson: vi.fn<(path: string) => Promise<unknown>>(),
  mockReadPackageJson: vi.fn<() => Promise<PackageJson>>()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: ({ path }: ResolvePathFromRootSafeParams): string => `/project/${path}`
}));

vi.mock('./json.ts', () => ({
  readJson: mockReadJson
}));

vi.mock('./npm.ts', () => ({
  readPackageJson: mockReadPackageJson
}));

const START_SHA = 'a'.repeat(40);

interface RepoState {
  readonly branch?: string;
  readonly counts?: string;
  readonly fetchError?: string;
  readonly ghError?: string;
  readonly ghView?: object;
  // `object`, not `PackageJson`: a manifest may set `version: undefined` to stand for one with no version.
  readonly installedManifests?: Readonly<Record<string, object>>;
  readonly installedVersions?: Readonly<Record<string, string>>;
  readonly localTag?: string;
  readonly lsRemoteError?: string;
  readonly originUrl?: string;
  readonly packageJson?: PackageJson;
  readonly publishedVersionLists?: Readonly<Record<string, string>>;
  readonly publishedVersions?: Readonly<Record<string, string>>;
  readonly registryError?: string;
  readonly remoteTag?: string;
  readonly versionListError?: string;
}

function playRegistry(state: RepoState, command: string): Promise<string> {
  const [, , name = '', field = ''] = command.split(' ', 4);
  if (field === 'versions') {
    return state.versionListError === undefined
      ? Promise.resolve(state.publishedVersionLists?.[name] ?? '[]')
      : Promise.reject(new Error(state.versionListError));
  }
  return state.registryError === undefined
    ? Promise.resolve(state.publishedVersions?.[name] ?? '')
    : Promise.reject(new Error(state.registryError));
}

function playRepo(state: RepoState = {}): string[] {
  const commands: string[] = [];
  mockReadPackageJson.mockResolvedValue(state.packageJson ?? { name: 'consumer' });
  mockReadJson.mockImplementation((path) => {
    const name = /^\/project\/node_modules\/(?<Name>.+)\/package\.json$/.exec(path)?.groups?.['Name'] ?? '';
    const version = state.installedVersions?.[name];
    return version === undefined ? Promise.reject(new Error(`ENOENT: ${path}`)) : Promise.resolve({ name, version, ...state.installedManifests?.[name] });
  });
  mockExecFromRoot.mockImplementation((command) => {
    const text = Array.isArray(command) ? command.join(' ') : command;
    commands.push(text);
    if (text.startsWith('npm view ')) {
      return playRegistry(state, text);
    }
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

describe('getReleasePreflightProblems toolkit check', () => {
  const TOOLKIT = '@mnaoumov/typescript-dev-toolkit';
  const OBSIDIAN_TOOLKIT = '@mnaoumov/obsidian-dev-toolkit';
  const CONSUMER: PackageJson = {
    dependencies: { '@mnaoumov/typescript-lib': '^4.0.0' },
    devDependencies: { [OBSIDIAN_TOOLKIT]: '^12.0.0', [TOOLKIT]: '^8.0.0' },
    name: 'consumer'
  };

  async function toolkitProblemsOf(state: RepoState): Promise<string[]> {
    const commands = playRepo({ packageJson: CONSUMER, ...state });
    const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false });
    expect(commands[0]).toBe('git rev-parse --verify --quiet refs/tags/1.0.1');
    return problems.map((problem) => `${problem.problem} Fix: ${problem.fix}`);
  }

  it('should pass toolkits that are current, and ask only about @mnaoumov toolkits', async () => {
    const commands = playRepo({
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' },
      packageJson: CONSUMER,
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' }
    });
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false })).resolves.toEqual([]);
    expect(commands.filter((command) => command.startsWith('npm view'))).toEqual([
      `npm view ${OBSIDIAN_TOOLKIT} version`,
      `npm view ${TOOLKIT} version`
    ]);
  });

  it('should refuse a toolkit behind the published one, naming both versions and the fix', async () => {
    await expect(toolkitProblemsOf({
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.1.0' },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' }
    })).resolves.toEqual([
      `${TOOLKIT} 8.1.0 is installed, but 8.2.0 is published, so the release would be built and gated with an outdated toolkit. `
      + `Fix: update it with \`npm install ${TOOLKIT}@8.2.0\` (or the project's dependency update), commit and push the update, then release again.`
    ]);
  });

  it('should refuse as usual when another toolkit\'s range on it admits the published version', async () => {
    await expect(toolkitProblemsOf({
      installedManifests: { [OBSIDIAN_TOOLKIT]: { dependencies: { [TOOLKIT]: '^8.0.0' } } },
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.1.0' },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' }
    })).resolves.toEqual([expect.stringContaining(`${TOOLKIT} 8.1.0 is installed, but 8.2.0 is published`)]);
  });

  it('should pass, warning and naming the other toolkit, when its range excludes the published major and the installed one is the newest it allows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    const commands = playRepo({
      installedManifests: { [OBSIDIAN_TOOLKIT]: { dependencies: { [TOOLKIT]: '^8.0.0' } } },
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.2.0', [TOOLKIT]: '8.3.0' },
      packageJson: CONSUMER,
      publishedVersionLists: { [TOOLKIT]: JSON.stringify(['8.2.0', '8.3.0', '9.0.0-beta.0', '9.0.0']) },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.2.0', [TOOLKIT]: '9.0.0' }
    });
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false })).resolves.toEqual([]);
    expect(commands).toContain(`npm view ${TOOLKIT} versions --json`);
    expect(warn).toHaveBeenCalledWith(
      `${TOOLKIT} 9.0.0 is published, but ${OBSIDIAN_TOOLKIT} 12.2.0 declares ${TOOLKIT} ^8.0.0, which excludes it. ${TOOLKIT} stays at 8.3.0 until a release of `
        + `${OBSIDIAN_TOOLKIT} takes 9.0.0; installing it now would put a second copy beside that one.`
    );
  });

  it('should refuse with the newest version every holding range allows, never the excluded major', async () => {
    await expect(toolkitProblemsOf({
      installedManifests: {
        '@mnaoumov/a-toolkit': { peerDependencies: { [TOOLKIT]: '^8.1.0' } },
        '@mnaoumov/b-toolkit': { optionalDependencies: { [TOOLKIT]: '>=8.0.0 <8.3.0' } },
        [OBSIDIAN_TOOLKIT]: { dependencies: { [TOOLKIT]: 'workspace:*' } }
      },
      installedVersions: { '@mnaoumov/a-toolkit': '1.0.0', '@mnaoumov/b-toolkit': '2.0.0', [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.1.0' },
      packageJson: {
        devDependencies: { '@mnaoumov/a-toolkit': '^1.0.0', '@mnaoumov/b-toolkit': '^2.0.0', [OBSIDIAN_TOOLKIT]: '^12.0.0', [TOOLKIT]: '^8.0.0' },
        name: 'consumer'
      },
      publishedVersionLists: { [TOOLKIT]: JSON.stringify(['8.1.0', '8.2.0', '8.3.0', '9.0.0']) },
      publishedVersions: { '@mnaoumov/a-toolkit': '1.0.0', '@mnaoumov/b-toolkit': '2.0.0', [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '9.0.0' }
    })).resolves.toEqual([
      `${TOOLKIT} 8.1.0 is installed, but 8.2.0 is the newest version that @mnaoumov/a-toolkit and @mnaoumov/b-toolkit allow, `
      + 'so the release would be built and gated with an outdated toolkit. '
      + `Fix: update it with \`npm install ${TOOLKIT}@8.2.0\` (or the project's dependency update), commit and push the update, then release again. `
      + `Do not install 9.0.0 itself: @mnaoumov/a-toolkit 1.0.0 declares ${TOOLKIT} ^8.1.0, @mnaoumov/b-toolkit 2.0.0 declares ${TOOLKIT} >=8.0.0 <8.3.0, `
      + 'so it would be a second copy beside that one.'
    ]);
  });

  it('should warn when no published version fits the holding range, read a one-version list, and name a dependent with no version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    await expect(toolkitProblemsOf({
      installedManifests: { [OBSIDIAN_TOOLKIT]: { dependencies: { [TOOLKIT]: '^7.0.0' }, version: undefined } },
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.1.0' },
      publishedVersionLists: { [TOOLKIT]: JSON.stringify('9.0.0') },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '9.0.0' }
    })).resolves.toEqual([expect.stringContaining(`${OBSIDIAN_TOOLKIT} is declared but not installed`)]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${OBSIDIAN_TOOLKIT} unknown declares ${TOOLKIT} ^7.0.0, which excludes it. ${TOOLKIT} stays at 8.1.0`));
  });

  it('should report a held toolkit whose published versions cannot be listed as unchecked', async () => {
    await expect(toolkitProblemsOf({
      installedManifests: { [OBSIDIAN_TOOLKIT]: { dependencies: { [TOOLKIT]: '^8.0.0' } } },
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.1.0' },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '9.0.0' },
      versionListError: 'offline'
    })).resolves.toEqual([
      expect.stringContaining(`Could not check whether ${TOOLKIT} is current: asking the npm registry for its latest version failed: `)
    ]);
  });

  it('should treat a local prerelease of the next version as ahead, and an older prerelease as behind', async () => {
    await expect(toolkitProblemsOf({
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.1.0-beta.0', [TOOLKIT]: '8.2.0-beta.1' },
      publishedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' }
    })).resolves.toEqual([
      expect.stringContaining(`${TOOLKIT} 8.2.0-beta.1 is installed, but 8.2.0 is published`)
    ]);
  });

  it('should refuse a declared toolkit that is not installed', async () => {
    await expect(toolkitProblemsOf({
      installedVersions: { [TOOLKIT]: '8.2.0' },
      publishedVersions: { [TOOLKIT]: '8.2.0' }
    })).resolves.toEqual([
      `${OBSIDIAN_TOOLKIT} is declared but not installed, so the release would run without the tooling it declares. Fix: run \`npm install\`, then release again.`
    ]);
  });

  it('should refuse, as could not check, when the registry cannot be reached', async () => {
    const problems = await toolkitProblemsOf({
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' },
      registryError: 'npm error code ENOTFOUND'
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(`Could not check whether ${OBSIDIAN_TOOLKIT} is current: asking the npm registry for its latest version failed: `);
    expect(problems[0]).toContain('ENOTFOUND');
    expect(problems[0]).toContain('pass `--no-toolkit-check`');
  });

  it('should refuse, as could not check, when the registry answers something that is not a version', async () => {
    await expect(toolkitProblemsOf({
      installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' },
      publishedVersions: { [TOOLKIT]: '8.2.0' }
    })).resolves.toEqual([
      expect.stringContaining(
        `Could not check whether ${OBSIDIAN_TOOLKIT} is current: asking the npm registry for its latest version failed: `
          + 'the registry answered \'\', which is not a version.'
      )
    ]);
  });

  it('should read an installed package.json without a version as not installed', async () => {
    playRepo({ packageJson: { devDependencies: { [TOOLKIT]: '^8.0.0' }, name: 'consumer' } });
    mockReadJson.mockResolvedValue({ name: TOOLKIT });
    const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false });
    expect(problems.map((problem) => problem.problem)).toEqual([`${TOOLKIT} is declared but not installed, so the release would run without the tooling it declares.`]);
  });

  it('should read toolkits from every dependency field, and a package.json without any', async () => {
    const commands = playRepo({
      installedVersions: { '@mnaoumov/a-toolkit': '1.0.0', '@mnaoumov/b-toolkit': '1.0.0' },
      packageJson: { name: 'consumer', optionalDependencies: { '@mnaoumov/a-toolkit': '^1.0.0' }, peerDependencies: { '@mnaoumov/b-toolkit': '^1.0.0' } },
      publishedVersions: { '@mnaoumov/a-toolkit': '1.0.0', '@mnaoumov/b-toolkit': '1.0.0' }
    });
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false })).resolves.toEqual([]);
    expect(commands.filter((command) => command.startsWith('npm view'))).toHaveLength(2);
    const noDependencyCommands = playRepo({ packageJson: {} });
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false })).resolves.toEqual([]);
    expect(noDependencyCommands).toEqual(['git rev-parse --verify --quiet refs/tags/1.0.1']);
  });

  it('should skip the toolkit itself in its own repository', async () => {
    const commands = playRepo({
      installedVersions: { '@mnaoumov/typescript-test-toolkit': '1.1.0' },
      packageJson: { devDependencies: { '@mnaoumov/typescript-test-toolkit': '^1.1.0', [TOOLKIT]: '^8.0.0' }, name: TOOLKIT },
      publishedVersions: { '@mnaoumov/typescript-test-toolkit': '1.1.0', [TOOLKIT]: '9.0.0' }
    });
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false })).resolves.toEqual([]);
    expect(commands.filter((command) => command.startsWith('npm view'))).toEqual(['npm view @mnaoumov/typescript-test-toolkit version']);
  });

  it('should skip the check when asked to, and say so', async () => {
    const commands = playRepo({ packageJson: CONSUMER, registryError: 'offline' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(noop);
    await expect(getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false, shouldCheckToolkits: false })).resolves.toEqual([]);
    expect(commands).toEqual(['git rev-parse --verify --quiet refs/tags/1.0.1']);
    expect(mockReadPackageJson).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '--no-toolkit-check: the installed @mnaoumov toolkits were not compared with the npm registry, so this release may ship on an outdated toolkit.'
    );
    warnSpy.mockRestore();
  });

  it('should report toolkit problems after the git ones', async () => {
    playRepo({ installedVersions: { [OBSIDIAN_TOOLKIT]: '12.0.0', [TOOLKIT]: '8.2.0' }, localTag: START_SHA, packageJson: CONSUMER, registryError: 'offline' });
    const problems = await getReleasePreflightProblems({ newVersion: '1.0.1', shouldCheckRemote: false });
    expect(problems.map((problem) => problem.problem.split(':', 1)[0])).toEqual([
      'The tag 1.0.1 already exists locally.',
      `Could not check whether ${OBSIDIAN_TOOLKIT} is current`,
      `Could not check whether ${TOOLKIT} is current`
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
