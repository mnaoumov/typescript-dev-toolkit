/**
 * @file
 *
 * Tells human-readable release notes from notes that only look like some: an empty body, a compare link alone, or a
 * raw list of commit subjects.
 *
 * A release publishes its notes twice, as the new `CHANGELOG.md` section and as the GitHub release body, and both are
 * read by people deciding whether to update. A body that is empty, carries only `**Full Changelog**: .../compare/...`,
 * or lists `fix(scope): subject` lines as the commits wrote them tells that reader nothing, whatever grouping option
 * produced it. A repository whose lockfile pinned a toolkit older than the grouped notes shipped exactly that after the
 * grouped default existed, so the release refuses it before tagging rather than leaving an audit to find it afterwards.
 */

/**
 * How a release body or a changelog section reads. Only `readable` may be published.
 */
export type ReleaseNotesVerdict = 'compare-link-only' | 'empty' | 'raw-commit-list' | 'readable';

const CONVENTIONAL_TYPES = 'feat|fix|perf|refactor|chore|docs|test|tests|build|ci|style|revert';

const RAW_BULLET_REG_EXPS: readonly RegExp[] = [
  /*
   * `- feat(scope): subject`, `- abc1234 fix: subject`. Never a bold prefix: the grouped notes write the scope as
   * `- **deps:** subject`, and `deps`, `test` and `build` are common scopes there.
   */
  new RegExp(String.raw`^[-*+]\s+(?:\[?[0-9a-f]{7,40}\]?(?:\([^)]*\))?\s+)?(?:${CONVENTIONAL_TYPES})(?:\([^)]*\))?!?:\s`, 'iu'),
  // Conventional-changelog output: `* **scope:** subject ([abc1234](.../commit/abc1234))`
  /\(\[?[0-9a-f]{7,40}\]?(?:\([^)]*\/commit\/[^)]*\))?\)\s*$/iu,
  // GitHub's generated "What's Changed": `* subject by @user in https://github.com/o/r/pull/1`
  /\sby @\S+ in https:\/\/github\.com\/\S+\/pull\/\d+\s*$/iu
];

const BOILERPLATE_LINE_REG_EXP = /^(?:\*\*(?:Full Changelog|npm)\*\*\s*:\s*\S+|<?https?:\/\/\S+>?)$/iu;
const BULLET_LINE_REG_EXP = /^[-*+]\s+/u;
const HEADING_LINE_REG_EXP = /^#{1,6}\s/u;
const RAW_MAJORITY_DIVISOR = 2;

const VERDICT_DESCRIPTIONS: Readonly<Record<Exclude<ReleaseNotesVerdict, 'readable'>, string>> = {
  'compare-link-only': 'only a compare link',
  'empty': 'empty',
  'raw-commit-list': 'a raw list of commit subjects'
};

/**
 * Throws when release notes are not human-readable.
 *
 * @param text - The changelog section or the release body.
 * @param what - What the text is, for the message, such as `The 1.2.3 section of CHANGELOG.md`.
 * @param remedy - What the reader can do about it, appended to the message.
 */
export function assertReleaseNotesAreReadable(text: string, what: string, remedy: string): void {
  const verdict = classifyReleaseNotes(text);
  if (verdict === 'readable') {
    return;
  }

  throw new Error(`${what} is ${VERDICT_DESCRIPTIONS[verdict]}, so it tells a reader nothing about what changed. ${remedy}`);
}

/**
 * Classifies a release body or a changelog section.
 *
 * Headings, the `**Full Changelog**:` and `**npm**:` lines and bare URLs carry no reader-facing text, so a body of
 * only those is `empty`, or `compare-link-only` when one of them is a compare link. A body whose bullets are at least
 * half commit subjects (a Conventional Commits prefix, a trailing commit hash, GitHub's generated
 * `by @user in .../pull/n`) is a `raw-commit-list`, however it is grouped. A bold `**scope:**` prefix is not a commit
 * subject: it is how the grouped notes write a scope.
 *
 * @param text - The body.
 * @returns The verdict.
 */
export function classifyReleaseNotes(text: string): ReleaseNotesVerdict {
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '');
  const content = lines.filter((line) => !HEADING_LINE_REG_EXP.test(line) && !BOILERPLATE_LINE_REG_EXP.test(line));
  if (content.length === 0) {
    return lines.some((line) => line.includes('/compare/')) ? 'compare-link-only' : 'empty';
  }

  const bullets = content.filter((line) => BULLET_LINE_REG_EXP.test(line));
  const rawBullets = bullets.filter((line) => RAW_BULLET_REG_EXPS.some((regExp) => regExp.test(line)));
  return bullets.length > 0 && rawBullets.length * RAW_MAJORITY_DIVISOR >= bullets.length ? 'raw-commit-list' : 'readable';
}
