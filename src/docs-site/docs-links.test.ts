import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { assertDocsLinksResolve } from './docs-links.ts';

const SITE_BASE_URL = 'https://mnaoumov.dev/typescript-lib/';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createSite(files: Readonly<Partial<Record<string, string>>>): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-links-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content ?? '');
  }
  return root;
}

// Fires every timer at once: the fetch timeout, and every retry wait of a transient failure.
function fireTimersAtOnce(): void {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(castTo<typeof setTimeout>((callback: () => void) => {
    callback();
    return 0;
  }));
}

function stubFetch(statusByUrl: ReadonlyMap<string, 'throw' | number>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => {
    const status = statusByUrl.get(url) ?? HTTP_OK;
    if (status === 'throw') {
      return Promise.reject(new Error('offline'));
    }
    return Promise.resolve({ body: status === HTTP_OK ? { cancel: vi.fn(() => noopAsync()) } : null, headers: new Headers(), status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('assertDocsLinksResolve', () => {
  it('passes a site whose links all resolve, fetching each external URL once', async () => {
    const fetchMock = stubFetch(new Map());
    const root = createSite({
      '404.html': '<a href="/nowhere/">x</a>',
      'api/index.html': '<h2 id="top">Top</h2><a href="https://example.com/a">a</a>',
      'index.html': '<a href="./api/#top">api</a><a href="/typescript-lib/">home</a><a href="https://example.com/a">a</a><img src="logo.png">',
      'logo.png': ''
    });

    await expect(assertDocsLinksResolve({ outputDirectory: root, siteBaseUrl: SITE_BASE_URL })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports missing pages, missing fragments and failing external links', async () => {
    fireTimersAtOnce();
    stubFetch(new Map<string, 'throw' | number>([['https://example.com/gone', HTTP_NOT_FOUND], ['https://example.com/offline', 'throw']]));
    const root = createSite({
      'index.html': [
        '<a href="./missing/">m</a>',
        '<a href="./other/#nope">f</a>',
        '<a href="./other/#yes">y</a>',
        '<a href="./logo.png#x">u</a>',
        '<a href="./a%2F..%2F..%2F..%2Fx/">e</a>',
        '<a href="../../outside/">o</a>',
        '<a href="https://example.com/gone">g</a>',
        '<a href="https://example.com/offline">o</a>'
      ].join(''),
      'logo.png': '',
      'other/index.html': '<p id="yes"></p>'
    });

    await expect(assertDocsLinksResolve({ outputDirectory: root, siteBaseUrl: SITE_BASE_URL })).rejects.toThrow(/Detected \d+ broken documentation link\(s\)/);
  });

  it('fails first on a GitHub alert rendered as a plain blockquote', async () => {
    const fetchMock = stubFetch(new Map());
    const root = createSite({ 'index.html': '<blockquote><p>[!NOTE] text</p></blockquote>' });

    await expect(assertDocsLinksResolve({ outputDirectory: root, siteBaseUrl: SITE_BASE_URL })).rejects.toThrow('rendered as a plain blockquote');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an external request that takes too long', async () => {
    // The timeout fires at once, so the request starts already aborted.
    fireTimersAtOnce();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => init.signal?.aborted ? Promise.reject(new Error('aborted')) : Promise.resolve({ body: null, status: HTTP_OK })));
    const root = createSite({ 'index.html': '<a href="https://example.com/slow">s</a>' });

    await expect(assertDocsLinksResolve({ outputDirectory: root, siteBaseUrl: SITE_BASE_URL })).rejects.toThrow('a network failure');
  });
});
