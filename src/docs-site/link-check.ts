/**
 * @file
 *
 * Validation of the links emitted by the built documentation HTML.
 *
 * Internal (same-site) links are validated offline: every `href`/`src` must resolve to a real
 * file in the build output, and every `#fragment` must resolve to a real element id on the
 * target page.
 *
 * External links can only be validated over the network, so those requests are heavily
 * deduplicated — each unique external URL is fetched at most once regardless of how many of the
 * thousands of generated pages reference it — and run through a bounded concurrency pool.
 */

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import {
  assertNever,
  ensureNonNullable
} from '@mnaoumov/typescript-lib/type-guards';
import { normalize } from 'node:path/posix';

const LINK_ATTRIBUTE_REGEX = /\b(?:href|src)=(?<quote>['"])(?<value>.*?)\k<quote>/giu;
const ID_ATTRIBUTE_REGEX = /\bid=(?<quote>['"])(?<value>.*?)\k<quote>/giu;
const HTTP_OK_STATUS = 200;

/**
 * The {@link BrokenLink.httpStatus} sentinel for a network-level failure (timeout, DNS,
 * connection refused) where no HTTP response was received.
 */
export const NETWORK_FAILURE_STATUS = 0;

/**
 * A single link that does not resolve.
 */
export interface BrokenLink {
  /**
   * The HTTP status returned by an external link, when {@link BrokenLink.reason} is
   * `external-error`. `0` denotes a network-level failure (timeout, DNS, connection refused).
   */
  readonly httpStatus?: number;

  /**
   * The absolute URL of the page that contains the broken link.
   */
  readonly pageUrl: string;

  /**
   * Why the link is considered broken.
   */
  readonly reason: 'external-error' | 'missing-fragment' | 'missing-page';

  /**
   * The resolved absolute URL the link points at.
   */
  readonly targetUrl: string;
}

/**
 * Options for {@link collectBrokenExternalLinks}.
 */
export interface CollectBrokenExternalLinksOptions {
  /**
   * The maximum number of in-flight probes against one host. Defaults to {@link DEFAULT_EXTERNAL_LINK_PER_HOST_CONCURRENCY}.
   */
  readonly perHostConcurrency?: number;

  /**
   * How a transient failure is retried.
   */
  readonly retry?: ExternalLinkRetryOptions;
}

/**
 * A single built documentation page to validate.
 */
export interface DocumentationPage {
  /**
   * The page's rendered HTML.
   */
  readonly html: string;

  /**
   * The page's path relative to the build-output root, e.g. `api/foo/index.html`.
   */
  readonly relativePath: string;
}

/**
 * What one probe of an external URL learned.
 */
export interface ExternalLinkProbeResult {
  /**
   * How long the server asked the client to wait before asking again (its `Retry-After` header), when it said.
   */
  readonly retryAfterInMilliseconds?: number | undefined;

  /**
   * The HTTP status, or {@link NETWORK_FAILURE_STATUS} when no response was received.
   */
  readonly status: number;
}

/**
 * How {@link collectBrokenExternalLinks} retries a transient failure: a network failure, an HTTP `408`, an HTTP `429` or an HTTP `5xx`.
 *
 * Each wait doubles from {@link ExternalLinkRetryOptions.initialDelayInMilliseconds} up to
 * {@link ExternalLinkRetryOptions.maxDelayInMilliseconds}, is jittered into its upper half, and is never shorter than the
 * server's `Retry-After`. The waits of one URL never add up to more than
 * {@link ExternalLinkRetryOptions.totalBudgetInMilliseconds}; the status of the last attempt is final.
 */
export interface ExternalLinkRetryOptions {
  /**
   * The first wait. Defaults to {@link DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS}.
   */
  readonly initialDelayInMilliseconds?: number;

  /**
   * The longest single wait the backoff grows to. Defaults to {@link DEFAULT_EXTERNAL_LINK_RETRY_MAX_DELAY_IN_MILLISECONDS}.
   */
  readonly maxDelayInMilliseconds?: number;

  /**
   * Returns a number in `[0, 1)` for the jitter. Defaults to `Math.random`.
   */
  readonly random?: () => number;

  /**
   * Waits the given time. Defaults to a `setTimeout`.
   */
  readonly sleep?: (milliseconds: number) => Promise<void>;

  /**
   * The most one URL may spend waiting between its attempts. Defaults to
   * {@link DEFAULT_EXTERNAL_LINK_RETRY_TOTAL_BUDGET_IN_MILLISECONDS}.
   */
  readonly totalBudgetInMilliseconds?: number;
}

/**
 * Filesystem access the link checker needs, injected so the pure decision logic can be tested
 * against an in-memory stub instead of a real build output.
 */
export interface LinkCheckFileSystem {
  /**
   * Reads the element ids present on an already-resolved page.
   *
   * @param pageKey - The key returned by {@link LinkCheckFileSystem.resolveExistingPage}.
   * @returns The set of element ids on that page.
   */
  readonly readIds: (pageKey: string) => Set<string>;

  /**
   * Resolves an output-relative path to an existing page.
   *
   * @param outputRelativePath - The decoded path relative to the build-output root.
   * @returns A stable key (e.g. the resolved absolute file path) for the existing page, or
   *   `null` when nothing exists at that path or the path escapes the build-output root.
   */
  readonly resolveExistingPage: (outputRelativePath: string) => null | string;
}

/**
 * The default {@link CollectBrokenExternalLinksOptions.perHostConcurrency}. A documentation site links thousands of
 * pages of its sibling sites, all on one host, and GitHub Pages answers a burst of them with a `503`.
 */
export const DEFAULT_EXTERNAL_LINK_PER_HOST_CONCURRENCY = 8;

/**
 * The default {@link ExternalLinkRetryOptions.initialDelayInMilliseconds}.
 */
export const DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS = 1000;

/**
 * The default {@link ExternalLinkRetryOptions.maxDelayInMilliseconds}.
 */
export const DEFAULT_EXTERNAL_LINK_RETRY_MAX_DELAY_IN_MILLISECONDS = 16_000;

/**
 * The default {@link ExternalLinkRetryOptions.totalBudgetInMilliseconds}.
 */
export const DEFAULT_EXTERNAL_LINK_RETRY_TOTAL_BUDGET_IN_MILLISECONDS = 45_000;

const HTTP_REQUEST_TIMEOUT_STATUS = 408;
const HTTP_TOO_MANY_REQUESTS_STATUS = 429;
const HTTP_SERVER_ERROR_MIN_STATUS = 500;
const MILLISECONDS_PER_SECOND = 1000;
const JITTER_FLOOR = 0.5;
const BACKOFF_FACTOR = 2;

interface PendingProbe {
  readonly host: string;
  readonly index: number;
  readonly pageUrl: string;
  readonly url: string;
}

/**
 * Validates the deduplicated external URLs over the network through a bounded concurrency pool.
 *
 * A network failure, an HTTP `408`, an HTTP `429` and an HTTP `5xx` are retried with an exponential, jittered backoff that honors
 * `Retry-After` (see {@link ExternalLinkRetryOptions}); any other status, a `404` included, is final at once. Probes of
 * one host are also capped at {@link CollectBrokenExternalLinksOptions.perHostConcurrency}, and a probe of another host
 * is started while one host is at its cap.
 *
 * @param targets - The unique external URL → referencing page map from {@link collectExternalTargets}.
 * @param fetchUrlStatus - Injected probe returning the HTTP status for a URL (`0` for a network failure), or an
 *   {@link ExternalLinkProbeResult} that also carries the server's `Retry-After`.
 * @param concurrency - The maximum number of in-flight probes.
 * @param options - The per-host cap and the retry policy.
 * @returns Every external URL that did not return HTTP `200`, in the map's iteration order.
 */
export async function collectBrokenExternalLinks(
  targets: Map<string, string>,
  fetchUrlStatus: (url: string) => Promise<ExternalLinkProbeResult | number>,
  concurrency: number,
  options: CollectBrokenExternalLinksOptions = {}
): Promise<BrokenLink[]> {
  const perHostConcurrency = Math.max(1, options.perHostConcurrency ?? DEFAULT_EXTERNAL_LINK_PER_HOST_CONCURRENCY);
  const pending: PendingProbe[] = [...targets].map(([url, pageUrl], index) => ({ host: new URL(url).host, index, pageUrl, url }));
  const results: (BrokenLink | null)[] = Array.from({ length: pending.length }, () => null);
  const inFlightByHost = new Map<string, number>();
  const waiters: (() => void)[] = [];

  async function runWorker(): Promise<void> {
    while (pending.length > 0) {
      const position = pending.findIndex((probe) => (inFlightByHost.get(probe.host) ?? 0) < perHostConcurrency);
      if (position === -1) {
        // Every pending URL is on a host at its cap, so a probe is in flight there and wakes this worker when it ends.
        await new Promise<void>((resolvePromise) => {
          waiters.push(resolvePromise);
        });
        continue;
      }

      const [probe] = pending.splice(position, 1);
      const { host, index, pageUrl, url } = ensureNonNullable(probe);
      inFlightByHost.set(host, (inFlightByHost.get(host) ?? 0) + 1);
      try {
        const httpStatus = await probeWithRetry(url, fetchUrlStatus, options.retry ?? {});
        if (httpStatus !== HTTP_OK_STATUS) {
          results[index] = { httpStatus, pageUrl, reason: 'external-error', targetUrl: url };
        }
      } finally {
        inFlightByHost.set(host, ensureNonNullable(inFlightByHost.get(host)) - 1);
        for (const wake of waiters.splice(0)) {
          wake();
        }
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  // Indexed assignment above keeps failures in the map's iteration order; drop the successful gaps.
  return results.filter((brokenLink): brokenLink is BrokenLink => brokenLink !== null);
}

/**
 * Finds every internal link across the built documentation pages that does not resolve.
 *
 * External and non-HTTP links are ignored. Each internal link must resolve to an existing page,
 * and each `#fragment` must resolve to an existing element id on the target page.
 *
 * @param pages - The built documentation pages to validate.
 * @param fileSystem - Injected access to the build output.
 * @param siteBaseUrl - The absolute base URL the site is served from (with a trailing slash).
 * @returns Every broken internal link, in page-then-document order.
 */
export function collectBrokenLinks(pages: DocumentationPage[], fileSystem: LinkCheckFileSystem, siteBaseUrl: string): BrokenLink[] {
  const brokenLinks: BrokenLink[] = [];

  for (const page of pages) {
    const pageUrl = getPageUrl(page.relativePath, siteBaseUrl);
    for (const rawLink of extractLinks(page.html)) {
      const targetUrl = new URL(rawLink, pageUrl);
      if (!isInternalDocUrl(targetUrl, siteBaseUrl)) {
        continue;
      }

      const pageKey = fileSystem.resolveExistingPage(getOutputRelativePath(targetUrl, siteBaseUrl));
      if (pageKey === null) {
        brokenLinks.push({ pageUrl, reason: 'missing-page', targetUrl: targetUrl.href });
        continue;
      }

      const fragment = targetUrl.hash.slice(1);
      if (fragment.length > 0 && !fileSystem.readIds(pageKey).has(fragment)) {
        brokenLinks.push({ pageUrl, reason: 'missing-fragment', targetUrl: targetUrl.href });
      }
    }
  }

  return brokenLinks;
}

/**
 * Collects every unique external URL referenced across the built pages, deduplicated.
 *
 * Only HTTP(S) links that are not {@link isInternalDocUrl} are returned. Each unique URL maps to
 * the first page that referenced it, so a later failure can be reported with a concrete example
 * page even though the URL is fetched only once.
 *
 * @param pages - The built documentation pages to scan.
 * @param siteBaseUrl - The absolute base URL the site is served from (with a trailing slash).
 * @returns A map from each unique external URL to one referencing page URL.
 */
export function collectExternalTargets(pages: DocumentationPage[], siteBaseUrl: string): Map<string, string> {
  const targets = new Map<string, string>();

  for (const page of pages) {
    const pageUrl = getPageUrl(page.relativePath, siteBaseUrl);
    for (const rawLink of extractLinks(page.html)) {
      const targetUrl = new URL(rawLink, pageUrl);
      if ((targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') || isInternalDocUrl(targetUrl, siteBaseUrl)) {
        continue;
      }

      const externalUrl = `${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`;
      if (!targets.has(externalUrl)) {
        targets.set(externalUrl, pageUrl);
      }
    }
  }

  return targets;
}

/**
 * Extracts the values of every `id` attribute in a chunk of HTML.
 *
 * @param html - The HTML to scan.
 * @returns The set of element ids.
 */
export function extractIds(html: string): Set<string> {
  return new Set([...html.matchAll(ID_ATTRIBUTE_REGEX)].map((match) => getMandatoryNamedGroup(match, 'value')));
}

/**
 * Extracts the values of every `href`/`src` attribute in a chunk of HTML.
 *
 * @param html - The HTML to scan.
 * @returns The raw link values, in document order (duplicates preserved).
 */
export function extractLinks(html: string): string[] {
  return [...html.matchAll(LINK_ATTRIBUTE_REGEX)].map((match) => getMandatoryNamedGroup(match, 'value'));
}

/**
 * Formats broken links into a human-readable multi-line report.
 *
 * @param brokenLinks - The broken links to describe.
 * @returns One line per broken link.
 */
export function formatBrokenLinks(brokenLinks: BrokenLink[]): string {
  return brokenLinks
    .map((brokenLink) => {
      switch (brokenLink.reason) {
        case 'external-error': {
          return `${brokenLink.pageUrl} links to external URL ${brokenLink.targetUrl} that returned ${describeHttpStatus(brokenLink.httpStatus)}.`;
        }
        case 'missing-fragment': {
          return `${brokenLink.pageUrl} links to missing fragment ${brokenLink.targetUrl}.`;
        }
        case 'missing-page': {
          return `${brokenLink.pageUrl} links to missing page ${brokenLink.targetUrl}.`;
        }
        default: {
          return assertNever(brokenLink.reason);
        }
      }
    })
    .join('\n');
}

/**
 * Computes the build-output-relative path for an internal documentation URL.
 *
 * @param targetUrl - The resolved absolute link URL (must be {@link isInternalDocUrl}).
 * @param siteBaseUrl - The absolute base URL the site is served from (with a trailing slash).
 * @returns The decoded path relative to the build-output root.
 */
export function getOutputRelativePath(targetUrl: URL, siteBaseUrl: string): string {
  const base = new URL(siteBaseUrl);
  return decodeURIComponent(targetUrl.pathname.slice(base.pathname.length));
}

/**
 * Computes the absolute URL a built page is served at.
 *
 * @param relativePath - The page's path relative to the build-output root.
 * @param siteBaseUrl - The absolute base URL the site is served from (with a trailing slash).
 * @returns The page's absolute URL.
 */
export function getPageUrl(relativePath: string, siteBaseUrl: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  const urlPath = normalized === 'index.html' ? '' : normalized.replace(/index\.html$/u, '');
  return new URL(urlPath, siteBaseUrl).href;
}

/**
 * Determines whether a resolved link points at a page hosted by this documentation site.
 *
 * @param targetUrl - The resolved absolute link URL.
 * @param siteBaseUrl - The absolute base URL the site is served from (with a trailing slash).
 * @returns `true` when the link is same-origin and under the site base path.
 */
export function isInternalDocUrl(targetUrl: URL, siteBaseUrl: string): boolean {
  const base = new URL(siteBaseUrl);
  return targetUrl.origin === base.origin && targetUrl.pathname.startsWith(base.pathname);
}

/**
 * Reads an HTTP `Retry-After` header, which is either a number of seconds or an HTTP date.
 *
 * @param headerValue - The header's value, or `null` when the response has none.
 * @param nowInMilliseconds - The current time, against which a date is measured.
 * @returns How long to wait, never negative, or `undefined` when the header is absent or unreadable.
 */
export function parseRetryAfterInMilliseconds(headerValue: null | string, nowInMilliseconds: number): number | undefined {
  const trimmed = headerValue?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }

  if (/^\d+$/u.test(trimmed)) {
    return Number(trimmed) * MILLISECONDS_PER_SECOND;
  }

  const dateInMilliseconds = Date.parse(trimmed);
  return Number.isNaN(dateInMilliseconds) ? undefined : Math.max(0, dateInMilliseconds - nowInMilliseconds);
}

/**
 * Resolves an output-relative path to an absolute path inside the build-output root, rejecting
 * paths that escape it via `..` segments.
 *
 * @param outputRootPath - The absolute build-output root path.
 * @param outputRelativePath - The decoded output-relative path.
 * @returns The joined path when it stays within the root, otherwise `null`.
 */
export function resolveWithinRoot(outputRootPath: string, outputRelativePath: string): null | string {
  const root = normalize(outputRootPath.replaceAll('\\', '/')).replace(/\/$/u, '');
  let joined = normalize(`${root}/${outputRelativePath.replaceAll('\\', '/')}`);
  if (joined.length > 1) {
    joined = joined.replace(/\/$/u, '');
  }

  return joined === root || joined.startsWith(`${root}/`) ? joined : null;
}

function describeHttpStatus(httpStatus: number | undefined): string {
  return httpStatus === undefined || httpStatus === NETWORK_FAILURE_STATUS ? 'a network failure' : `HTTP ${String(httpStatus)}`;
}

function isTransientStatus(status: number): boolean {
  return status === NETWORK_FAILURE_STATUS || status === HTTP_REQUEST_TIMEOUT_STATUS || status === HTTP_TOO_MANY_REQUESTS_STATUS || status >= HTTP_SERVER_ERROR_MIN_STATUS;
}

/*
 * A site linking its sibling sites probes thousands of URLs on one host, and in CI GitHub Pages answers a few of them
 * with a 503, or drops the connection, while the page serves 200 a moment later. Three attempts a second apart gave up
 * too soon for that (2026-10-16), so the wait grows until the budget is spent.
 */
async function probeWithRetry(
  url: string,
  fetchUrlStatus: (url: string) => Promise<ExternalLinkProbeResult | number>,
  retry: ExternalLinkRetryOptions
): Promise<number> {
  const initialDelayInMilliseconds = retry.initialDelayInMilliseconds ?? DEFAULT_EXTERNAL_LINK_RETRY_INITIAL_DELAY_IN_MILLISECONDS;
  const maxDelayInMilliseconds = retry.maxDelayInMilliseconds ?? DEFAULT_EXTERNAL_LINK_RETRY_MAX_DELAY_IN_MILLISECONDS;
  const totalBudgetInMilliseconds = retry.totalBudgetInMilliseconds ?? DEFAULT_EXTERNAL_LINK_RETRY_TOTAL_BUDGET_IN_MILLISECONDS;
  const random = retry.random ?? Math.random;
  const sleep = retry.sleep ?? sleepWithTimeout;

  let waitedInMilliseconds = 0;
  for (let attempt = 0;; attempt++) {
    const probeResult = await fetchUrlStatus(url);
    const { retryAfterInMilliseconds = 0, status } = typeof probeResult === 'number' ? { retryAfterInMilliseconds: undefined, status: probeResult } : probeResult;
    const remainingInMilliseconds = totalBudgetInMilliseconds - waitedInMilliseconds;
    if (!isTransientStatus(status) || remainingInMilliseconds <= 0) {
      return status;
    }

    const backoffInMilliseconds = Math.min(maxDelayInMilliseconds, initialDelayInMilliseconds * BACKOFF_FACTOR ** attempt);
    const jitteredInMilliseconds = backoffInMilliseconds * (JITTER_FLOOR + (1 - JITTER_FLOOR) * random());
    const delayInMilliseconds = Math.min(remainingInMilliseconds, Math.max(jitteredInMilliseconds, retryAfterInMilliseconds));
    await sleep(delayInMilliseconds);
    waitedInMilliseconds += delayInMilliseconds;
  }
}

function sleepWithTimeout(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    globalThis.setTimeout(resolvePromise, milliseconds);
  });
}
