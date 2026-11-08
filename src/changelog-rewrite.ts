/**
 * @file
 *
 * Rewrites the already-published sections of a `CHANGELOG.md` into the `grouped` layout a release now writes, so a
 * project's history reads the same way as its next release.
 *
 * Only a section that is still the flat list of commit subjects a release used to write is rewritten. Its bullets are
 * matched back to the first-parent commits of the section's tag range, which brings back what the bullet alone lost:
 * the issue title an issue-closing `re #<n>` merge carries in its body, and the `BREAKING CHANGE:` footer. A bullet no
 * commit matches (the history was rewritten, or the bullet was edited by hand) is grouped from its own text. A section
 * that is anything other than a bullet list was written or edited by a person, so it is kept as it is. So is a bullet
 * list none of whose bullets matched a commit or is a Conventional Commits subject: it is hand-written prose, which the
 * grouped layout would only wrap in a count line and an `### Other changes` heading.
 */

import type { ChangelogCommitEntry } from './changelog-grouping.ts';

import {
  isConventionalChangelogEntry,
  renderGroupedChangelogSection
} from './changelog-grouping.ts';
import { toChangelogCommitEntry } from './version.ts';

/**
 * The outcome of {@link rewriteChangelog}.
 */
export interface ChangelogRewriteResult {
  /**
   * The new `CHANGELOG.md` content, with LF line endings.
   */
  readonly content: string;

  /**
   * The sections kept as they were, with the reason, newest first.
   */
  readonly kept: readonly KeptChangelogSection[];

  /**
   * The sections rewritten, newest first.
   */
  readonly rewritten: readonly RewrittenChangelogSection[];
}

/**
 * What {@link rewriteChangelog} needs from the repository.
 */
export interface ChangelogRewriteSource {
  /**
   * Reads the full messages of the first-parent commits in a range, in `git log` order.
   *
   * @param fromTag - The tag the range starts after, or `undefined` for the whole history up to {@link toTag}.
   * @param toTag - The tag the range ends at.
   * @returns The full commit messages.
   */
  readonly getCommitMessages: (fromTag: string | undefined, toTag: string) => Promise<readonly string[]>;

  /**
   * The repository's tags.
   */
  readonly tags: readonly string[];
}

/**
 * A section {@link rewriteChangelog} kept as it was.
 */
export interface KeptChangelogSection {
  /**
   * Why it was kept.
   */
  readonly reason: string;

  /**
   * The version its heading names.
   */
  readonly version: string;
}

/**
 * A section {@link rewriteChangelog} rewrote.
 */
export interface RewrittenChangelogSection {
  /**
   * How many of its bullets were matched to a commit of its tag range.
   */
  readonly matchedCount: number;

  /**
   * The grouped section body, without its heading.
   */
  readonly newBody: string;

  /**
   * The section body as it was, without its heading.
   */
  readonly oldBody: string;

  /**
   * The tag the version was released under, when the repository has one.
   */
  readonly tag: string | undefined;

  /**
   * The version its heading names.
   */
  readonly version: string;
}

interface ChangelogSection {
  readonly bodyLines: readonly string[];
  readonly heading: string;
  readonly rawLines: readonly string[];
  readonly version: string;
}

interface MatchedBullets {
  readonly entries: readonly ChangelogCommitEntry[];
  readonly matchedCount: number;
}

const BULLET_PREFIX = '- ';
const FULL_CHANGELOG_PREFIX = '**Full Changelog**:';
const SECTION_HEADING_PREFIX = '## ';

/**
 * Rewrites every released section of a `CHANGELOG.md` that is still a flat list of commit subjects into the `grouped`
 * layout, keeping each heading as it is.
 *
 * @param changelog - The current `CHANGELOG.md` content.
 * @param source - The repository's tags and commits.
 * @returns The new content and what happened to each section.
 */
export async function rewriteChangelog(changelog: string, source: ChangelogRewriteSource): Promise<ChangelogRewriteResult> {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n');
  const firstHeadingIndex = lines.findIndex((line) => line.startsWith(SECTION_HEADING_PREFIX));
  const headerLines = firstHeadingIndex === -1 ? lines : lines.slice(0, firstHeadingIndex);
  const sections = firstHeadingIndex === -1 ? [] : splitSections(lines.slice(firstHeadingIndex));
  const tags = new Set(source.tags);

  const kept: KeptChangelogSection[] = [];
  const rewritten: RewrittenChangelogSection[] = [];
  const outputBlocks = [trimTrailingBlankLines(headerLines).join('\n')];

  for (const [index, section] of sections.entries()) {
    const keptReason = getKeptReason(section);
    if (keptReason) {
      kept.push({ reason: keptReason, version: section.version });
      outputBlocks.push(trimTrailingBlankLines(section.rawLines).join('\n'));
      continue;
    }

    const tag = toTag(section.version, tags);
    const previousSection = sections[index + 1];
    const previousTag = previousSection ? toTag(previousSection.version, tags) : undefined;
    const isRangeKnown = tag !== undefined && (previousSection === undefined || previousTag !== undefined);
    const commitMessages = isRangeKnown ? await source.getCommitMessages(previousTag, tag) : [];
    const { entries, matchedCount } = matchBullets(section.bodyLines, commitMessages);
    if (matchedCount === 0 && entries.every((entry) => !isConventionalChangelogEntry(entry.entry))) {
      kept.push({ reason: 'no bullet matched a commit or is a Conventional Commits subject, so a person wrote it', version: section.version });
      outputBlocks.push(trimTrailingBlankLines(section.rawLines).join('\n'));
      continue;
    }

    const oldBody = section.bodyLines.join('\n');
    const newBody = renderGroupedChangelogSection(entries);
    rewritten.push({ matchedCount, newBody, oldBody, tag, version: section.version });
    outputBlocks.push(`${section.heading}\n\n${newBody}`);
  }

  return {
    content: `${outputBlocks.filter((block) => block !== '').join('\n\n')}\n`,
    kept,
    rewritten
  };
}

/**
 * Rewrites the release notes of a GitHub release whose changelog section {@link rewriteChangelog} rewrote.
 *
 * A release body a release wrote is its changelog section, a blank line, and a `**Full Changelog**` compare link. The
 * body is rewritten only when its part above that link is still the section as it was, so a release edited by hand
 * after publishing is not overwritten unless asked. The compare link is kept as it is.
 *
 * @param releaseBody - The release's current notes.
 * @param section - The rewritten section.
 * @param shouldOverwriteEdited - Whether notes that are no longer the section as it was are rewritten anyway. That is
 *   right where the changelog was corrected after the release, for example to remove text that must not be public.
 * @returns The new notes, or `null` when the release was edited and has to be left alone.
 */
export function rewriteReleaseNotes(releaseBody: string, section: RewrittenChangelogSection, shouldOverwriteEdited = false): null | string {
  const lines = releaseBody.replaceAll('\r\n', '\n').trim().split('\n');
  const linkIndex = findLastIndex(lines, (line) => line.startsWith(FULL_CHANGELOG_PREFIX));
  const noteLines = linkIndex === -1 ? lines : lines.slice(0, linkIndex);
  if (!shouldOverwriteEdited && toComparable(noteLines.join('\n')) !== toComparable(section.oldBody)) {
    return null;
  }

  return linkIndex === -1 ? section.newBody : `${section.newBody}\n\n${lines.slice(linkIndex).join('\n')}`;
}

// Array.prototype.findLastIndex is ES2023, above this package's lib.
function findLastIndex(lines: readonly string[], isMatch: (line: string) => boolean): number {
  return lines.map((line) => isMatch(line)).lastIndexOf(true);
}

function findMatchingEntryIndex(entries: readonly ChangelogCommitEntry[], bullet: string): number {
  // The line a commit renders to today, then its bare entry: a bullet an older toolkit wrote may lack the references.
  const comparable = toComparable(bullet);
  const renderedIndex = entries.findIndex((entry) => toComparable(toRenderedLine(entry)) === comparable);
  return renderedIndex === -1 ? entries.findIndex((entry) => toComparable(entry.entry) === comparable) : renderedIndex;
}

function getKeptReason(section: ChangelogSection): string | undefined {
  if (section.bodyLines.length === 0) {
    return 'the section is empty';
  }

  if (section.bodyLines.some((line) => !line.startsWith(BULLET_PREFIX))) {
    return 'the section is not a plain bullet list, so a person wrote or edited it';
  }

  return undefined;
}

function matchBullets(bodyLines: readonly string[], commitMessages: readonly string[]): MatchedBullets {
  const unused = commitMessages.map((commitMessage) => toChangelogCommitEntry(commitMessage));
  const entries: ChangelogCommitEntry[] = [];
  let matchedCount = 0;

  for (const line of bodyLines) {
    const bullet = line.slice(BULLET_PREFIX.length).trim();
    const index = findMatchingEntryIndex(unused, bullet);
    if (index === -1) {
      entries.push({ detailLines: [], entry: bullet, hasBreakingFooter: false, references: [] });
      continue;
    }

    matchedCount++;
    entries.push(...unused.splice(index, 1));
  }

  return { entries, matchedCount };
}

/**
 * Splits the lines from the first section heading on into sections.
 *
 * @param lines - The lines, the first of which is a section heading.
 * @returns The sections, in file order.
 */
function splitSections(lines: readonly string[]): ChangelogSection[] {
  const headingIndices = lines.map((line, index) => line.startsWith(SECTION_HEADING_PREFIX) ? index : -1).filter((index) => index !== -1);
  return headingIndices.map((headingIndex, position) => toSection(lines.slice(headingIndex, headingIndices[position + 1] ?? lines.length)));
}

/**
 * Reduces a line to what survives `lint:md:fix`: a published section was fixed after it was generated, which wraps
 * names in backticks and escapes brackets, and a GitHub release kept the text from before the fix.
 *
 * @param text - The text.
 * @returns The text without backticks, backslashes and repeated whitespace.
 */
function toComparable(text: string): string {
  return text.replaceAll(/[`\\]/g, '').replaceAll(/\s+/g, ' ').trim();
}

function toRenderedLine(entry: ChangelogCommitEntry): string {
  return entry.references.length === 0 ? entry.entry : `${entry.entry} (${entry.references.join(', ')})`;
}

function toSection(rawLines: readonly string[]): ChangelogSection {
  const heading = rawLines.slice(0, 1).join('');
  const bodyLines = rawLines.slice(1).filter((line) => line.trim() !== '');
  const version = heading.slice(SECTION_HEADING_PREFIX.length).trim().split(/\s+/, 1).join('');
  return { bodyLines, heading, rawLines, version };
}

function toTag(version: string, tags: ReadonlySet<string>): string | undefined {
  return [version, `v${version}`].find((candidate) => tags.has(candidate));
}

function trimTrailingBlankLines(lines: readonly string[]): readonly string[] {
  const lastIndex = findLastIndex(lines, (line) => line.trim() !== '');
  return lines.slice(0, lastIndex + 1);
}
