import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  GetNpmVersionLinkLineParams,
  NpmRegistryResponse
} from './npm-release-link.ts';

import { getNpmVersionLinkLine } from './npm-release-link.ts';

const REPO_URL = 'https://github.com/mnaoumov/typescript-lib';

function params(overrides: Partial<GetNpmVersionLinkLineParams>): GetNpmVersionLinkLineParams {
  return {
    fetchRegistry: registry({ body: { repository: { type: 'git', url: 'git+https://github.com/mnaoumov/typescript-lib.git' } }, status: 200 }),
    isPrivate: false,
    packageName: '@mnaoumov/typescript-lib',
    repoUrl: REPO_URL,
    version: '4.0.0',
    warn: vi.fn(),
    ...overrides
  };
}

function registry(response: NpmRegistryResponse): (url: string) => Promise<NpmRegistryResponse> {
  return vi.fn<(url: string) => Promise<NpmRegistryResponse>>().mockResolvedValue(response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getNpmVersionLinkLine', () => {
  it('should link the version page of a scoped package published from this repository', async () => {
    const fetchRegistry = registry({ body: { repository: { url: 'git+https://github.com/mnaoumov/typescript-lib.git' } }, status: 200 });
    expect(await getNpmVersionLinkLine(params({ fetchRegistry }))).toBe(
      '**npm**: https://www.npmjs.com/package/@mnaoumov/typescript-lib/v/4.0.0'
    );
    expect(fetchRegistry).toHaveBeenCalledWith('https://registry.npmjs.org/@mnaoumov%2ftypescript-lib');
  });

  it('should link an unscoped package and drop a leading v from the version', async () => {
    expect(
      await getNpmVersionLinkLine(params({
        fetchRegistry: registry({ body: { repository: 'https://github.com/Owner/Library' }, status: 200 }),
        packageName: 'library',
        repoUrl: 'https://github.com/owner/library',
        version: 'v1.2.3'
      }))
    ).toBe('**npm**: https://www.npmjs.com/package/library/v/1.2.3');
  });

  it('should accept an ssh repository URL', async () => {
    expect(
      await getNpmVersionLinkLine(params({
        fetchRegistry: registry({ body: { repository: { url: 'git@github.com:mnaoumov/typescript-lib.git' } }, status: 200 })
      }))
    ).not.toBeNull();
  });

  it('should give no link for a private package, without asking the registry', async () => {
    const fetchRegistry = registry({ body: {}, status: 200 });
    expect(await getNpmVersionLinkLine(params({ fetchRegistry, isPrivate: true }))).toBeNull();
    expect(fetchRegistry).not.toHaveBeenCalled();
  });

  it('should give no link for a package without a name', async () => {
    expect(await getNpmVersionLinkLine(params({ packageName: undefined }))).toBeNull();
  });

  it('should give no link when the release repository is not on GitHub', async () => {
    expect(await getNpmVersionLinkLine(params({ repoUrl: 'https://gitlab.com/owner/library' }))).toBeNull();
  });

  it('should give no link for a package not on npm yet, with no warning', async () => {
    const warn = vi.fn();
    expect(await getNpmVersionLinkLine(params({ fetchRegistry: registry({ body: null, status: 404 }), warn }))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('should give no link when the npm package of that name belongs to another repository', async () => {
    expect(
      await getNpmVersionLinkLine(params({
        fetchRegistry: registry({ body: { repository: { url: 'git+https://github.com/someone-else/typescript-lib.git' } }, status: 200 })
      }))
    ).toBeNull();
  });

  it.each([
    ['no repository', {}],
    ['a repository without a url', { repository: { type: 'git' } }],
    ['a body that is not an object', 'text'],
    ['a null body', null]
  ])('should give no link when the registry document carries %s', async (_, body) => {
    expect(await getNpmVersionLinkLine(params({ fetchRegistry: registry({ body, status: 200 }) }))).toBeNull();
  });

  it('should warn and give no link when the registry answers an error status', async () => {
    const warn = vi.fn();
    expect(await getNpmVersionLinkLine(params({ fetchRegistry: registry({ body: null, status: 503 }), warn }))).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  it('should warn and give no link when the registry cannot be reached', async () => {
    const warn = vi.fn();
    const fetchRegistry = vi.fn<(url: string) => Promise<NpmRegistryResponse>>().mockRejectedValue(new Error('offline'));
    expect(await getNpmVersionLinkLine(params({ fetchRegistry, warn }))).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'));
  });

  it('should read the full registry document through the global fetch by default', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ repository: { url: 'git+https://github.com/mnaoumov/typescript-lib.git' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { fetchRegistry: _, ...rest } = params({});
    expect(await getNpmVersionLinkLine(rest)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@mnaoumov%2ftypescript-lib',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('should not parse the body of a failed default fetch', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 404 })));
    const { fetchRegistry: _, ...rest } = params({});
    expect(await getNpmVersionLinkLine(rest)).toBeNull();
  });

  it('should warn through console.warn by default', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { warn: _, ...rest } = params({ fetchRegistry: registry({ body: null, status: 500 }) });
    expect(await getNpmVersionLinkLine(rest)).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
