import type { MockInstance } from 'vitest';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { execFromRoot } from '../root.ts';
import { syncRepoHomepage } from './repo-homepage.ts';

vi.mock('../root.ts', () => ({ execFromRoot: vi.fn() }));

const SITE = 'https://example.com/pkg/';
const FIX_COMMAND = `gh repo edit someone/pkg --homepage ${SITE}`;
const READ_COMMAND = ['gh', 'api', 'repos/someone/pkg', '--jq', '.homepage // ""'];

const mockExecFromRoot = vi.mocked(execFromRoot);

function mockHomepage(homepage: string, patchError?: Error): void {
  mockExecFromRoot.mockImplementation(castTo<typeof execFromRoot>(async (command: readonly string[]) => {
    await noopAsync();
    if (command.includes('PATCH')) {
      if (patchError) {
        throw patchError;
      }
      return '';
    }
    return `${homepage}\n`;
  }));
}

describe('syncRepoHomepage', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_ACTIONS', '');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  });

  it('does nothing when the homepage already is the site', async () => {
    mockHomepage(SITE);

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'set', owner: 'someone', repo: 'pkg' });

    expect(mockExecFromRoot).toHaveBeenCalledExactlyOnceWith(READ_COMMAND, { isQuiet: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports a mismatch with the fixing command in check mode, and changes nothing', async () => {
    mockHomepage('https://www.npmjs.com/package/pkg');

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'check', owner: 'someone', repo: 'pkg' });

    expect(mockExecFromRoot).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      `The GitHub homepage of someone/pkg is 'https://www.npmjs.com/package/pkg', not the site ${SITE}. To set it: ${FIX_COMMAND}`
    );
  });

  it('adds a GitHub Actions annotation when run in a workflow', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    mockHomepage('');

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'check', owner: 'someone', repo: 'pkg' });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenLastCalledWith(
      `::warning title=Repository homepage::The GitHub homepage of someone/pkg is empty, not the site ${SITE}. To set it: ${FIX_COMMAND}`
    );
  });

  it('sets a mismatched homepage in set mode', async () => {
    mockHomepage('');

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'set', owner: 'someone', repo: 'pkg' });

    expect(mockExecFromRoot).toHaveBeenLastCalledWith(['gh', 'api', '--method', 'PATCH', 'repos/someone/pkg', '-f', `homepage=${SITE}`], { isQuiet: true });
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(`Set the GitHub homepage of someone/pkg to ${SITE} (was empty).`);
  });

  it('describes a thrown non-Error by its string', async () => {
    mockExecFromRoot.mockRejectedValue('offline');

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'check', owner: 'someone', repo: 'pkg' });

    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(`Could not read the GitHub homepage of someone/pkg (offline). To set it: ${FIX_COMMAND}`);
  });

  it('reports when the credentials cannot set the homepage', async () => {
    mockHomepage('https://old.example.com/', new Error('HTTP 403: Resource not accessible by integration'));

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'set', owner: 'someone', repo: 'pkg' });

    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      `The GitHub homepage of someone/pkg is 'https://old.example.com/', not the site ${SITE}, and setting it failed: `
        + `HTTP 403: Resource not accessible by integration. A workflow token cannot change repository settings; with an account that can: ${FIX_COMMAND}`
    );
  });

  it('warns rather than fails when the repository cannot be read', async () => {
    mockExecFromRoot.mockRejectedValue(new Error('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.\nCommand: gh api repos/someone/pkg'));

    await syncRepoHomepage({ homepageUrl: SITE, mode: 'set', owner: 'someone', repo: 'pkg' });

    expect(mockExecFromRoot).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      `Could not read the GitHub homepage of someone/pkg (gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.). To set it: ${FIX_COMMAND}`
    );
  });
});
