/**
 * @file
 *
 * Decides whether a failed `linkinator` run failed only on badge links whose host did not answer.
 */

import { stripVTControlCharacters } from 'node:util';

import type { ExecResult } from '../exec.ts';

/**
 * The hosts whose links are badge images rendered by a third-party service.
 *
 * A badge URL is generated from a template, so a host that does not answer at all (status `0`: a timeout, a reset,
 * a DNS failure) says nothing about whether the link is right. A badge with a wrong path still gets a real answer
 * (a `404`), which stays an error.
 */
export const BADGE_HOSTS: ReadonlySet<string> = new Set(['img.shields.io']);

/**
 * A broken link `linkinator` reported.
 */
export interface LinkinatorBrokenLink {
  /**
   * The status `linkinator` printed: a number, or `#` for a missing fragment.
   */
  readonly status: string;

  /**
   * The URL.
   */
  readonly url: string;
}

/**
 * `linkinator` exits with this code when it finished and found a broken link.
 */
const LINKINATOR_BROKEN_LINKS_EXIT_CODE = 1;

/**
 * The status `linkinator` reports for a request that got no answer.
 */
const NO_ANSWER_STATUS = '0';

/**
 * A broken link line: `[404] https://example.com/` while streaming, or the same indented in the summary.
 */
const BROKEN_LINK_LINE_REG_EXP = /^\s*\[(?<status>[^\]\s]+)\]\s+(?<url>\S+)/;

/**
 * Lists the broken links a `linkinator` run printed.
 *
 * `linkinator` prints a broken link on standard error and a passing one (a warned status included) on standard output,
 * so every bracketed line of standard error is a broken link. Each appears twice, once while streaming and once in the
 * summary, so the list is deduplicated.
 *
 * @param stderr - The standard error of the run.
 * @returns The broken links, in the order first printed.
 */
export function getLinkinatorBrokenLinks(stderr: string): LinkinatorBrokenLink[] {
  const linksByKey = new Map<string, LinkinatorBrokenLink>();
  for (const line of stripVTControlCharacters(stderr).split(/\r?\n/)) {
    const groups = BROKEN_LINK_LINE_REG_EXP.exec(line)?.groups;
    const status = groups?.['status'];
    const url = groups?.['url'];
    if (status === undefined || url === undefined) {
      continue;
    }
    linksByKey.set(`${status} ${url}`, { status, url });
  }
  return [...linksByKey.values()];
}

/**
 * Returns the badge links that are the ONLY cause of a failed `linkinator` run.
 *
 * Such a run failed only because a badge host did not answer, so the caller warns instead of failing. Any other broken
 * link, a run that did not finish (another exit code or a signal), or a failure that printed no broken link, returns
 * `null`, and the run stays a failure.
 *
 * @param result - The result of the run.
 * @returns The unanswered badge links, or `null` when the run's failure is not only those.
 */
export function getUnansweredBadgeLinksOnlyFailure(result: ExecResult): LinkinatorBrokenLink[] | null {
  if (result.exitCode !== LINKINATOR_BROKEN_LINKS_EXIT_CODE || result.exitSignal !== null) {
    return null;
  }
  const brokenLinks = getLinkinatorBrokenLinks(result.stderr);
  if (brokenLinks.length === 0) {
    return null;
  }
  return brokenLinks.every((link) => isUnansweredBadgeLink(link)) ? brokenLinks : null;
}

function isUnansweredBadgeLink(link: LinkinatorBrokenLink): boolean {
  return link.status === NO_ANSWER_STATUS && URL.canParse(link.url) && BADGE_HOSTS.has(new URL(link.url).hostname);
}
