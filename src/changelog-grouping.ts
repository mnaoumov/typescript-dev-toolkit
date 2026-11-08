/**
 * @file
 *
 * Groups the commit-derived entries of a new changelog section into plain-language sections, so the release notes a
 * release writes with nobody reviewing them can be scanned rather than read commit by commit.
 *
 * The input is still the first-parent commit history, so this is a deterministic transformation of what the author
 * already wrote: it sorts entries by their Conventional-Commits type, leaves out the commit types that do not change
 * what a user gets, merges entries that say the same thing or close the same issue, and swaps a `re #<n>` subject for
 * the issue title its body carries. Prose a human (or an agent) writes still goes in through `--changelog-file`.
 */

/**
 * How the generated changelog section of a release is laid out.
 *
 * - `grouped` — a one-line summary, then the entries under `### Breaking changes`, `### New`, `### Fixed`,
 *   `### Improved`, `### For developers`, `### Documentation` and `### Other changes`, with maintenance commits counted
 *   rather than listed.
 * - `commits` — one bullet per first-parent commit, in history order, as every release wrote before `grouped` existed.
 */
export type ChangelogStyle = 'commits' | 'grouped';

/**
 * Every {@link ChangelogStyle}, in the order the `--changelog-style` error lists them.
 */
export const CHANGELOG_STYLES: readonly ChangelogStyle[] = ['grouped', 'commits'];

/**
 * One first-parent commit, as {@link renderGroupedChangelogSection} takes it.
 */
export interface ChangelogCommitEntry {
  /**
   * The body paragraphs left once the entry itself, the issue reference lines and the breaking-change footers are
   * removed, in order, each unwrapped onto one line. The first of them is the issue title an issue-closing `re #<n>`
   * merge carries, which an older merge may have hard-wrapped.
   */
  readonly detailLines: readonly string[];

  /**
   * The changelog line the commit produces before grouping: its subject, or the body line lifted onto a default merge
   * subject.
   */
  readonly entry: string;

  /**
   * Whether the commit carries a `BREAKING CHANGE:` footer. The `!` marker is read off {@link entry} itself.
   */
  readonly hasBreakingFooter: boolean;

  /**
   * The issue references the body names that {@link entry} does not already show, rendered as the line shows them.
   */
  readonly references: readonly string[];
}

/**
 * The commit types that change nothing a user of the release gets, so the grouped section counts them instead of
 * listing them. A commit of one of these types that is marked breaking is still listed, under breaking changes.
 */
export const MAINTENANCE_COMMIT_TYPES: ReadonlySet<string> = new Set(['build', 'chore', 'ci', 'refactor', 'style', 'test']);

interface ClassifiedEntry {
  readonly issue: string | undefined;
  readonly references: readonly string[];
  readonly section: SectionDefinition;
  readonly text: string;
}

interface SectionDefinition {
  readonly heading: string;
  readonly plural: string;
  readonly singular: string;
}

interface SectionEntry {
  readonly issue: string | undefined;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Merged entries collect references in place.
  references: string[];
  readonly text: string;
}

const BREAKING_SECTION: SectionDefinition = { heading: 'Breaking changes', plural: 'breaking changes', singular: 'breaking change' };
const NEW_SECTION: SectionDefinition = { heading: 'New', plural: 'new features', singular: 'new feature' };
const FIXED_SECTION: SectionDefinition = { heading: 'Fixed', plural: 'fixes', singular: 'fix' };
const IMPROVED_SECTION: SectionDefinition = { heading: 'Improved', plural: 'improvements', singular: 'improvement' };
const DEVELOPER_SECTION: SectionDefinition = { heading: 'For developers', plural: 'developer changes', singular: 'developer change' };
const DOCUMENTATION_SECTION: SectionDefinition = { heading: 'Documentation', plural: 'documentation changes', singular: 'documentation change' };
const OTHER_SECTION: SectionDefinition = { heading: 'Other changes', plural: 'other changes', singular: 'other change' };

/**
 * The sections, in the order they are rendered and summarized. An issue two sections would list stays in the earlier.
 */
const SECTIONS: readonly SectionDefinition[] = [
  BREAKING_SECTION,
  NEW_SECTION,
  FIXED_SECTION,
  IMPROVED_SECTION,
  DEVELOPER_SECTION,
  DOCUMENTATION_SECTION,
  OTHER_SECTION
];

/**
 * The commit scopes that mark a change to the API other developers call rather than to what a user of the release sees.
 */
const DEVELOPER_SCOPES: ReadonlySet<string> = new Set(['api', 'api-contract']);

const DEPENDENCIES_SCOPE = 'deps';

const SECTIONS_BY_TYPE = new Map<string, SectionDefinition>([
  ['docs', DOCUMENTATION_SECTION],
  ['feat', NEW_SECTION],
  ['fix', FIXED_SECTION],
  ['perf', IMPROVED_SECTION]
]);

const CONVENTIONAL_ENTRY_REG_EXP = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?:\s+(?<description>\S.*)$/i;

/**
 * An issue-closing merge subject, whose readable half is the issue title on the body's first line.
 */
const ISSUE_ONLY_DESCRIPTION_REG_EXP = /^re (?<issue>#\d+)$/i;

/**
 * The prefix the bug and feature-request issue forms put on a title. The section heading already says which it is.
 */
const ISSUE_FORM_PREFIX_REG_EXP = /^\[(?:BUG|FR)\]\s*(?=\S)/i;

/**
 * The words of a `deps` commit that only clears a security advisory, which a user of the release does not notice. A
 * `deps` commit saying anything else (such as restoring startup) describes something a user does notice.
 */
const ADVISORY_ONLY_DESCRIPTION_REG_EXP = /\b(?:advisory|advisories|audit|vulnerable|vulnerability|vulnerabilities)\b|\bGHSA-|\bCVE-\d/i;

/**
 * A code span: a backtick run, the shortest text up to a backtick run of the same length.
 */
const CODE_SPAN_REG_EXP = /(?<!`)(?<fence>`+)(?!`)[\s\S]*?(?<!`)\k<fence>(?!`)/g;

/**
 * A square bracket and the backslashes right before it.
 */
const BRACKET_REG_EXP = /\\*[[\]]/g;

/**
 * Escapes the square brackets of an issue title outside its code spans, so a title such as `[BUG] Links break` is
 * published as text rather than read as a reference link with no definition (markdownlint's MD052).
 *
 * An issue title is written by whoever opened the issue, and no commit hook ever checks it, so it is the one part of a
 * generated entry that can carry Markdown the author never meant. A bracket already escaped is left as it is.
 *
 * @param text - The issue title.
 * @returns The title with every unescaped `[` and `]` outside a code span preceded by a backslash.
 */
export function escapeLinkBrackets(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CODE_SPAN_REG_EXP)) {
    parts.push(escapeBracketsInPlainText(text.slice(lastIndex, match.index)), match[0]);
    lastIndex = match.index + match[0].length;
  }

  parts.push(escapeBracketsInPlainText(text.slice(lastIndex)));
  return parts.join('');
}

/**
 * Checks whether a changelog entry is a Conventional Commits subject (`<type>[(<scope>)][!]: <description>`), which the
 * `grouped` layout files by its type. Any other entry goes to `### Other changes`.
 *
 * @param entry - The entry text, without its bullet.
 * @returns Whether the entry is a Conventional Commits subject.
 */
export function isConventionalChangelogEntry(entry: string): boolean {
  return CONVENTIONAL_ENTRY_REG_EXP.test(entry);
}

/**
 * Renders the body of a new changelog section in the {@link ChangelogStyle} `grouped` layout.
 *
 * @param entries - The first-parent commits since the previous release, in `git log` order.
 * @returns The section body, without its `## <version>` heading and without a trailing newline.
 */
export function renderGroupedChangelogSection(entries: readonly ChangelogCommitEntry[]): string {
  const sectionEntries = new Map<SectionDefinition, SectionEntry[]>();
  let maintenanceCount = 0;

  for (const entry of entries) {
    const classified = classifyEntry(entry);
    if (!classified) {
      maintenanceCount++;
      continue;
    }

    const list = sectionEntries.get(classified.section) ?? [];
    sectionEntries.set(classified.section, list);
    const existing = list.find((sectionEntry) => sectionEntry.text === classified.text);
    if (!existing) {
      list.push({ issue: classified.issue, references: [...classified.references], text: classified.text });
      continue;
    }

    existing.references = [...new Set([...existing.references, ...classified.references])];
  }

  mergeRepeatedIssues(sectionEntries);

  const blocks = [toSummaryLine(sectionEntries, maintenanceCount)];
  for (const section of SECTIONS) {
    const list = sectionEntries.get(section);
    if (!list) {
      continue;
    }

    blocks.push(`### ${section.heading}`, list.map((sectionEntry) => `- ${toEntryLine(sectionEntry)}`).join('\n'));
  }

  return blocks.join('\n\n');
}

function classifyEntry(entry: ChangelogCommitEntry): ClassifiedEntry | null {
  const groups = CONVENTIONAL_ENTRY_REG_EXP.exec(entry.entry)?.groups;
  if (!groups) {
    return { issue: undefined, references: entry.references, section: entry.hasBreakingFooter ? BREAKING_SECTION : OTHER_SECTION, text: entry.entry };
  }

  // The regular expression's `type` and `description` groups are not optional, so a match always fills them.
  const type = String(groups['type']).toLowerCase();
  const description = String(groups['description']);
  const scope = groups['scope'];
  const isBreaking = groups['breaking'] !== undefined || entry.hasBreakingFooter;
  const section = isBreaking ? BREAKING_SECTION : toNonBreakingSection(type, (scope ?? '').toLowerCase(), description);
  if (!section) {
    return null;
  }

  const issue = ISSUE_ONLY_DESCRIPTION_REG_EXP.exec(description)?.groups?.['issue'];
  const issueTitle = entry.detailLines[0];
  const isIssueTitleUsed = issue !== undefined && issueTitle !== undefined;
  const text = isIssueTitleUsed ? escapeLinkBrackets(issueTitle.replace(ISSUE_FORM_PREFIX_REG_EXP, '')) : description;
  const references = isIssueTitleUsed ? [issue, ...entry.references] : entry.references;
  return {
    issue: isIssueTitleUsed ? issue : undefined,
    references,
    section,
    text: scope ? `**${scope}:** ${text}` : text
  };
}

function countPhrase(count: number, section: SectionDefinition): string {
  return `${String(count)} ${count === 1 ? section.singular : section.plural}`;
}

function escapeBracketsInPlainText(text: string): string {
  return text.replaceAll(BRACKET_REG_EXP, (match: string) => {
    const backslashes = match.slice(0, -1);
    // An odd run of backslashes escapes the bracket; an even one is escaped backslashes only.
    const isEscaped = backslashes.replaceAll('\\\\', '') === '\\';
    return isEscaped ? match : `${backslashes}\\${match.slice(-1)}`;
  });
}

function joinPhrases(phrases: readonly string[]): string {
  const last = phrases.slice(-1).join('');
  return phrases.length === 1 ? last : `${phrases.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Lists an issue once: several commits can close one issue under different types or scopes, and each would otherwise
 * repeat its title. The entry in the earliest section stays and takes the references of the others.
 *
 * @param sectionEntries - The entries by section, updated in place. A section left with no entries is removed.
 */
function mergeRepeatedIssues(sectionEntries: Map<SectionDefinition, SectionEntry[]>): void {
  const firstEntries = new Map<string, SectionEntry>();
  for (const section of SECTIONS) {
    const list = sectionEntries.get(section) ?? [];
    const kept = list.filter((sectionEntry) => {
      if (sectionEntry.issue === undefined) {
        return true;
      }

      const firstEntry = firstEntries.get(sectionEntry.issue);
      if (!firstEntry) {
        firstEntries.set(sectionEntry.issue, sectionEntry);
        return true;
      }

      firstEntry.references = [...new Set([...firstEntry.references, ...sectionEntry.references])];
      return false;
    });

    if (kept.length === 0) {
      sectionEntries.delete(section);
    } else {
      sectionEntries.set(section, kept);
    }
  }
}

function toEntryLine(sectionEntry: SectionEntry): string {
  return sectionEntry.references.length === 0 ? sectionEntry.text : `${sectionEntry.text} (${sectionEntry.references.join(', ')})`;
}

function toNonBreakingSection(type: string, scope: string, description: string): null | SectionDefinition {
  if (scope === DEPENDENCIES_SCOPE && ADVISORY_ONLY_DESCRIPTION_REG_EXP.test(description)) {
    return null;
  }

  const section = toTypeSection(type);
  return section && DEVELOPER_SCOPES.has(scope) ? DEVELOPER_SECTION : section;
}

function toSummaryLine(sectionEntries: ReadonlyMap<SectionDefinition, readonly SectionEntry[]>, maintenanceCount: number): string {
  const phrases = SECTIONS
    .map((section) => ({ count: sectionEntries.get(section)?.length ?? 0, section }))
    .filter(({ count }) => count > 0)
    .map(({ count, section }) => countPhrase(count, section));
  const isOne = maintenanceCount === 1;
  const maintenance = maintenanceCount === 0
    ? ''
    : ` ${String(maintenanceCount)} maintenance ${isOne ? 'commit' : 'commits'} (tests, build, CI, refactoring, dependencies) ${isOne ? 'is' : 'are'} not listed.`;

  if (phrases.length > 0) {
    return `This release has ${joinPhrases(phrases)}.${maintenance}`;
  }

  return maintenanceCount === 0 ? 'This release has no changes.' : `This release has maintenance changes only.${maintenance}`;
}

function toTypeSection(type: string): null | SectionDefinition {
  const section = SECTIONS_BY_TYPE.get(type);
  if (section) {
    return section;
  }

  return MAINTENANCE_COMMIT_TYPES.has(type) ? null : OTHER_SECTION;
}
