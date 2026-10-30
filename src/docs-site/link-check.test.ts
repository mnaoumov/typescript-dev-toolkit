import type { Mock } from 'vitest';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import dedent from 'dedent';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  BrokenLink,
  DocumentationPage,
  ExternalLinkProbeResult,
  ExternalLinkRetryOptions,
  LinkCheckFileSystem
} from './link-check.ts';

import {
  collectBrokenExternalLinks,
  collectBrokenLinks,
  collectExternalTargets,
  DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS,
  DEFAULT_EXTERNAL_LINK_RETRY_MAX_DELAY_IN_MILLISECONDS,
  DEFAULT_EXTERNAL_LINK_RETRY_TOTAL_BUDGET_IN_MILLISECONDS,
  extractIds,
  extractLinks,
  formatBrokenLinks,
  getOutputRelativePath,
  getPageUrl,
  isInternalDocUrl,
  NETWORK_FAILURE_STATUS,
  parseRetryAfterInMilliseconds,
  resolveWithinRoot
} from './link-check.ts';

const SITE_BASE_URL = 'https://mnaoumov.dev/typescript-lib/';
const PAGE_URL = 'https://mnaoumov.dev/typescript-lib/p/';
const EXTERNAL_URL = 'https://mnaoumov.dev/obsidian-lib/api/x/';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;
const THIRD_ATTEMPT = 3;
const RETRY_AFTER_IN_MILLISECONDS = 7000;
const JITTER_INITIAL_DELAY_IN_MILLISECONDS = 100;

type FetchUrlStatus = (url: string) => Promise<ExternalLinkProbeResult | number>;

interface RecordingRetry {
  readonly delays: number[];
  readonly retry: ExternalLinkRetryOptions;
}
const UNBOUNDED_CONCURRENCY = 20;
const UNIQUE_URL_COUNT = 3;
const CONCURRENCY_LIMIT = 3;
const TARGET_COUNT = 10;
const PROBE_DELAY_IN_MILLISECONDS = 5;

describe('link-check parsing helpers', () => {
  it('extracts href and src values while ignoring other attributes', () => {
    expect(extractLinks('<a href="/a">x</a><img src=\'/b.png\'><link rel="stylesheet" href="/c.css">')).toEqual(['/a', '/b.png', '/c.css']);
  });

  it('extracts element ids', () => {
    expect(extractIds('<h2 id="alpha">A</h2><h3 id=\'bravo\'>B</h3><p>none</p>')).toEqual(new Set(['alpha', 'bravo']));
  });

  it('derives the served URL from an index page and a leaf page', () => {
    expect(getPageUrl('index.html', SITE_BASE_URL)).toBe('https://mnaoumov.dev/typescript-lib/');
    expect(getPageUrl('api/foo/index.html', SITE_BASE_URL)).toBe('https://mnaoumov.dev/typescript-lib/api/foo/');
    expect(getPageUrl(String.raw`guides\bar.html`, SITE_BASE_URL)).toBe('https://mnaoumov.dev/typescript-lib/guides/bar.html');
  });
});

describe('isInternalDocUrl / getOutputRelativePath', () => {
  it('treats same-origin under-base URLs as internal and decodes their output path', () => {
    const url = new URL('https://mnaoumov.dev/typescript-lib/api/abort%20controller/');
    expect(isInternalDocUrl(url, SITE_BASE_URL)).toBe(true);
    expect(getOutputRelativePath(url, SITE_BASE_URL)).toBe('api/abort controller/');
  });

  it('treats other origins and out-of-base paths as external', () => {
    expect(isInternalDocUrl(new URL('https://developer.mozilla.org/x'), SITE_BASE_URL)).toBe(false);
    expect(isInternalDocUrl(new URL('https://mnaoumov.dev/other/'), SITE_BASE_URL)).toBe(false);
  });
});

describe('resolveWithinRoot', () => {
  it('resolves paths that stay inside the output root', () => {
    expect(resolveWithinRoot('/repo/docs/dist', 'api/foo/index.html')).toBe('/repo/docs/dist/api/foo/index.html');
    expect(resolveWithinRoot('/repo/docs/dist', '')).toBe('/repo/docs/dist');
  });

  it('rejects paths that escape the output root', () => {
    expect(resolveWithinRoot('/repo/docs/dist', '../secret')).toBeNull();
    expect(resolveWithinRoot('/repo/docs/dist', 'api/../../secret')).toBeNull();
  });
});

describe('checkLinks (internal, offline)', () => {
  const pages: DocumentationPage[] = [{
    html: [
      '<a href="/typescript-lib/api/bravo/">ok page</a>',
      '<a href="../bravo/#known">ok fragment</a>',
      '<a href="/typescript-lib/api/bravo/#ghost">bad fragment</a>',
      '<a href="/typescript-lib/api/missing/">bad page</a>',
      '<a href="https://developer.mozilla.org/x">external ignored</a>',
      '<a href="mailto:me@example.com">mail ignored</a>'
    ].join(''),
    relativePath: 'api/alpha/index.html'
  }];

  const fileSystem: LinkCheckFileSystem = {
    readIds: (pageKey) => pageKey === 'api/bravo/index.html' ? new Set(['known']) : new Set(),
    resolveExistingPage: (outputRelativePath) => {
      const trimmed = outputRelativePath.replace(/\/$/u, '');
      return trimmed === 'api/bravo' ? 'api/bravo/index.html' : null;
    }
  };

  it('reports missing pages and missing fragments while ignoring external and non-http links', () => {
    expect(collectBrokenLinks(pages, fileSystem, SITE_BASE_URL)).toEqual([
      { pageUrl: 'https://mnaoumov.dev/typescript-lib/api/alpha/', reason: 'missing-fragment', targetUrl: 'https://mnaoumov.dev/typescript-lib/api/bravo/#ghost' },
      { pageUrl: 'https://mnaoumov.dev/typescript-lib/api/alpha/', reason: 'missing-page', targetUrl: 'https://mnaoumov.dev/typescript-lib/api/missing/' }
    ]);
  });
});

describe('collectExternalTargets (dedup)', () => {
  it('deduplicates external URLs across pages and records one referencing page', () => {
    const pages: DocumentationPage[] = [
      { html: '<a href="https://developer.mozilla.org/x">a</a><a href="https://github.com/y">b</a>', relativePath: 'p1/index.html' },
      { html: '<a href="https://developer.mozilla.org/x">dup</a><a href="/typescript-lib/internal/">skip</a><a href="mailto:x@y.z">skip</a>', relativePath: 'p2/index.html' }
    ];

    expect(collectExternalTargets(pages, SITE_BASE_URL)).toEqual(
      new Map([
        ['https://developer.mozilla.org/x', 'https://mnaoumov.dev/typescript-lib/p1/'],
        ['https://github.com/y', 'https://mnaoumov.dev/typescript-lib/p1/']
      ])
    );
  });
});

describe('checkExternalTargets (network, concurrency-bounded)', () => {
  it('probes each unique URL once and reports non-200 and network failures', async () => {
    const targets = new Map([
      ['https://down.example/', 'https://mnaoumov.dev/typescript-lib/p/'],
      ['https://missing.example/', 'https://mnaoumov.dev/typescript-lib/p/'],
      ['https://ok.example/', 'https://mnaoumov.dev/typescript-lib/p/']
    ]);
    const statusByUrl: Record<string, number> = {
      'https://down.example/': NETWORK_FAILURE_STATUS,
      'https://missing.example/': HTTP_NOT_FOUND,
      'https://ok.example/': HTTP_OK
    };
    const fetchUrlStatus = vi.fn((url: string) => Promise.resolve(statusByUrl[url] ?? HTTP_OK));

    // A zero budget makes the network failure final at once; the retry has its own tests below.
    const brokenLinks = await collectBrokenExternalLinks(targets, fetchUrlStatus, UNBOUNDED_CONCURRENCY, { retry: { totalBudgetInMilliseconds: 0 } });

    expect(fetchUrlStatus).toHaveBeenCalledTimes(UNIQUE_URL_COUNT);
    expect(brokenLinks).toEqual([
      { httpStatus: NETWORK_FAILURE_STATUS, pageUrl: 'https://mnaoumov.dev/typescript-lib/p/', reason: 'external-error', targetUrl: 'https://down.example/' },
      { httpStatus: HTTP_NOT_FOUND, pageUrl: 'https://mnaoumov.dev/typescript-lib/p/', reason: 'external-error', targetUrl: 'https://missing.example/' }
    ]);
  });

  it('never exceeds the configured concurrency', async () => {
    const targets = new Map(Array.from({ length: TARGET_COUNT }, (_unused, index) => [`https://host-${String(index)}.example/`, 'https://mnaoumov.dev/typescript-lib/p/']));
    let inFlight = 0;
    let maxInFlight = 0;

    function fetchUrlStatus(): Promise<number> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolvePromise) => {
        globalThis.setTimeout(() => {
          inFlight--;
          resolvePromise(HTTP_OK);
        }, PROBE_DELAY_IN_MILLISECONDS);
      });
    }

    await collectBrokenExternalLinks(targets, fetchUrlStatus, CONCURRENCY_LIMIT);

    expect(maxInFlight).toBe(CONCURRENCY_LIMIT);
  });

  it('caps the probes of one host and keeps probing other hosts meanwhile', async () => {
    const sameHostTargets = Array.from({ length: TARGET_COUNT }, (_unused, index) => [`https://same.example/${String(index)}`, PAGE_URL] as const);
    const targets = new Map([...sameHostTargets, ['https://other.example/', PAGE_URL]]);
    let sameHostInFlight = 0;
    let maxSameHostInFlight = 0;
    const startedUrls: string[] = [];

    function fetchUrlStatus(url: string): Promise<number> {
      startedUrls.push(url);
      const isSameHost = url.startsWith('https://same.example/');
      if (isSameHost) {
        sameHostInFlight++;
        maxSameHostInFlight = Math.max(maxSameHostInFlight, sameHostInFlight);
      }
      return new Promise((resolvePromise) => {
        globalThis.setTimeout(() => {
          if (isSameHost) {
            sameHostInFlight--;
          }
          resolvePromise(HTTP_OK);
        }, PROBE_DELAY_IN_MILLISECONDS);
      });
    }

    await collectBrokenExternalLinks(targets, fetchUrlStatus, UNBOUNDED_CONCURRENCY, { perHostConcurrency: CONCURRENCY_LIMIT });

    expect(maxSameHostInFlight).toBe(CONCURRENCY_LIMIT);
    expect(startedUrls.indexOf('https://other.example/')).toBe(CONCURRENCY_LIMIT);
  });
});

describe('collectBrokenExternalLinks (retry)', () => {
  function createRetry(): RecordingRetry {
    const delays: number[] = [];
    return {
      delays,
      retry: {
        random: () => 1,
        sleep: (milliseconds): Promise<void> => {
          delays.push(milliseconds);
          return noopAsync();
        }
      }
    };
  }

  function sequence(...results: (ExternalLinkProbeResult | number)[]): Mock<FetchUrlStatus> {
    return vi.fn<FetchUrlStatus>(() => Promise.resolve(results.shift() ?? HTTP_OK));
  }

  it('passes a 503 that recovers on the third attempt, backing off exponentially', async () => {
    const { delays, retry } = createRetry();
    const fetchUrlStatus = sequence(HTTP_SERVICE_UNAVAILABLE, NETWORK_FAILURE_STATUS, HTTP_OK);

    await expect(collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, { retry })).resolves.toEqual([]);

    expect(fetchUrlStatus).toHaveBeenCalledTimes(THIRD_ATTEMPT);
    expect(delays).toEqual([DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS, 2 * DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS]);
  });

  it('fails a 404 at once, without retrying', async () => {
    const { delays, retry } = createRetry();
    const fetchUrlStatus = sequence(HTTP_NOT_FOUND);

    await expect(collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, { retry })).resolves.toEqual([
      { httpStatus: HTTP_NOT_FOUND, pageUrl: PAGE_URL, reason: 'external-error', targetUrl: EXTERNAL_URL }
    ]);

    expect(fetchUrlStatus).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });

  it('retries a 408, the server timing out its own upstream', async () => {
    const { delays, retry } = createRetry();
    const fetchUrlStatus = sequence(HTTP_REQUEST_TIMEOUT, HTTP_OK);

    await expect(collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, { retry })).resolves.toEqual([]);

    expect(delays).toEqual([DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS]);
  });

  it('waits at least the Retry-After of a 429', async () => {
    const { delays, retry } = createRetry();
    const fetchUrlStatus = sequence({ retryAfterInMilliseconds: RETRY_AFTER_IN_MILLISECONDS, status: HTTP_TOO_MANY_REQUESTS }, { status: HTTP_OK });

    await expect(collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, { retry })).resolves.toEqual([]);

    expect(delays).toEqual([RETRY_AFTER_IN_MILLISECONDS]);
  });

  it('jitters each wait into the upper half of its backoff and caps it at the longest wait', async () => {
    const delays: number[] = [];
    const fetchUrlStatus = sequence(HTTP_SERVICE_UNAVAILABLE, HTTP_SERVICE_UNAVAILABLE, HTTP_OK);

    await collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, {
      retry: {
        initialDelayInMilliseconds: JITTER_INITIAL_DELAY_IN_MILLISECONDS,
        maxDelayInMilliseconds: JITTER_INITIAL_DELAY_IN_MILLISECONDS,
        random: () => 0,
        sleep: (milliseconds): Promise<void> => {
          delays.push(milliseconds);
          return noopAsync();
        }
      }
    });

    expect(delays).toEqual([JITTER_INITIAL_DELAY_IN_MILLISECONDS / 2, JITTER_INITIAL_DELAY_IN_MILLISECONDS / 2]);
  });

  it('reports a 5xx that outlasts the budget, after spending exactly the budget', async () => {
    const { delays, retry } = createRetry();
    const fetchUrlStatus = vi.fn(() => Promise.resolve(HTTP_SERVICE_UNAVAILABLE));

    await expect(collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1, { retry })).resolves.toEqual([
      { httpStatus: HTTP_SERVICE_UNAVAILABLE, pageUrl: PAGE_URL, reason: 'external-error', targetUrl: EXTERNAL_URL }
    ]);

    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(DEFAULT_EXTERNAL_LINK_RETRY_TOTAL_BUDGET_IN_MILLISECONDS);
    expect(Math.max(...delays)).toBe(DEFAULT_EXTERNAL_LINK_RETRY_MAX_DELAY_IN_MILLISECONDS);
  });

  it('waits on a real timer when no sleep is injected', async () => {
    vi.useFakeTimers();
    try {
      const fetchUrlStatus = sequence(HTTP_SERVICE_UNAVAILABLE, HTTP_OK);
      const resultPromise = collectBrokenExternalLinks(new Map([[EXTERNAL_URL, PAGE_URL]]), fetchUrlStatus, 1);
      await vi.runAllTimersAsync();
      await expect(resultPromise).resolves.toEqual([]);
      expect(fetchUrlStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseRetryAfterInMilliseconds', () => {
  const NOW_IN_MILLISECONDS = Date.parse('2026-10-16T12:00:00Z');

  it('reads a number of seconds', () => {
    expect(parseRetryAfterInMilliseconds(' 7 ', NOW_IN_MILLISECONDS)).toBe(RETRY_AFTER_IN_MILLISECONDS);
  });

  it('reads an HTTP date, never going negative', () => {
    expect(parseRetryAfterInMilliseconds('Fri, 16 Oct 2026 12:00:07 GMT', NOW_IN_MILLISECONDS)).toBe(RETRY_AFTER_IN_MILLISECONDS);
    expect(parseRetryAfterInMilliseconds('Fri, 16 Oct 2026 11:00:00 GMT', NOW_IN_MILLISECONDS)).toBe(0);
  });

  it('returns undefined for an absent or unreadable header', () => {
    expect(parseRetryAfterInMilliseconds(null, NOW_IN_MILLISECONDS)).toBeUndefined();
    expect(parseRetryAfterInMilliseconds('  ', NOW_IN_MILLISECONDS)).toBeUndefined();
    expect(parseRetryAfterInMilliseconds('soon', NOW_IN_MILLISECONDS)).toBeUndefined();
  });
});

describe('formatBrokenLinks', () => {
  it('describes each broken-link reason', () => {
    expect(formatBrokenLinks([
      { pageUrl: 'https://s/p1/', reason: 'missing-page', targetUrl: 'https://s/gone/' },
      { pageUrl: 'https://s/p2/', reason: 'missing-fragment', targetUrl: 'https://s/x/#f' },
      { httpStatus: HTTP_SERVER_ERROR, pageUrl: 'https://s/p3/', reason: 'external-error', targetUrl: 'https://ext/' },
      { httpStatus: NETWORK_FAILURE_STATUS, pageUrl: 'https://s/p4/', reason: 'external-error', targetUrl: 'https://dead/' }
    ])).toBe(dedent`
      https://s/p1/ links to missing page https://s/gone/.
      https://s/p2/ links to missing fragment https://s/x/#f.
      https://s/p3/ links to external URL https://ext/ that returned HTTP 500.
      https://s/p4/ links to external URL https://dead/ that returned a network failure.
    `);
  });
});

describe('formatBrokenLinks with an unknown reason', () => {
  it('fails loudly rather than formatting it', () => {
    expect(() => formatBrokenLinks([castTo<BrokenLink>({ pageUrl: 'a', reason: 'unknown', targetUrl: 'b' })])).toThrow();
  });
});

describe('resolveWithinRoot at the filesystem root', () => {
  it('keeps the bare root', () => {
    expect(resolveWithinRoot('/', '')).toBe('/');
  });
});
