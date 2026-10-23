/**
 * @file
 *
 * A commitlint rule that lints a commit HEADER with the project's own `lint:md` configuration.
 *
 * The header is the one part of a commit message that ships verbatim: a release turns every commit subject
 * since the last tag into a `- <subject>` bullet of the new `CHANGELOG.md` section, and lints that section with
 * `lint:md` before writing it. That check runs at release time, after the whole preflight gate, and weeks after
 * the subject was pushed: a release once passed its 25-minute preflight and was then refused because a custom
 * rule flagged a plugin name in a pushed `docs(readme):` subject. A pushed subject cannot be changed, so the
 * release had to be re-run with hand-written notes. The commit-msg hook is the last point at which the subject
 * can still be changed for free.
 *
 * The header is checked AS the section the release would build from it, attributed to `CHANGELOG.md`, so the
 * verdict is the one the release would give: the same configuration, the same custom rules, and bare URLs
 * autolinked the way the release autolinks them. It runs only where the project defines a `lint:md` script,
 * which is the condition the release applies too.
 */

import type {
  AsyncRule,
  Plugin,
  RuleOutcome
} from '@commitlint/types';

import { lintMarkdownContent } from './linters/markdownlint-content.ts';
import { readPackageJson } from './npm.ts';
import { RepoPaths } from './repo-paths.ts';
import { resolvePathFromRootSafe } from './root.ts';
import { autolinkBareUrls } from './version.ts';

/**
 * The name the rule is registered under.
 */
export const LINT_MD_HEADER_RULE_NAME = 'typescript-dev-toolkit/lint-md-header';

/**
 * The npm script whose presence opts a project into the check.
 */
const LINT_MD_SCRIPT_NAME = 'lint:md';

/**
 * The version the section heading names when `package.json` has none. Markdownlint reads it as any heading text.
 */
const FALLBACK_VERSION = '0.0.0';

type Commit = Parameters<AsyncRule>[0];

/**
 * Lints the commit header as the changelog section the release would build from it.
 *
 * Only the `always` condition is meaningful: `never` would require the header to fail `lint:md`, so it is
 * treated the same way rather than inverted.
 *
 * @param commit - The parsed commit.
 * @returns A {@link Promise} that resolves to the rule outcome, naming each finding.
 */
export async function lintMdHeaderRule(commit: Commit): Promise<RuleOutcome> {
  if (!commit.header) {
    return [true];
  }

  const packageJson = await readPackageJson();
  if (!Object.keys(packageJson.scripts ?? {}).includes(LINT_MD_SCRIPT_NAME)) {
    return [true];
  }

  const version = packageJson.version ?? FALLBACK_VERSION;
  const findings = await lintMarkdownContent({
    content: `# CHANGELOG\n\n## ${version}\n\n- ${autolinkBareUrls(commit.header)}\n`,
    filePath: resolvePathFromRootSafe({ path: RepoPaths.ChangelogMd })
  });

  if (findings.length === 0) {
    return [true];
  }

  return [
    false,
    `the header does not pass \`${LINT_MD_SCRIPT_NAME}\`, and it ships verbatim into the next release's changelog:\n`
    + `${findings.join('\n')}\n`
    + 'Reword it so the changelog bullet it becomes passes the project\'s markdownlint configuration.'
  ];
}

/**
 * The commitlint plugin carrying {@link lintMdHeaderRule}.
 */
export const lintMdHeaderPlugin: Plugin = {
  rules: {
    [LINT_MD_HEADER_RULE_NAME]: lintMdHeaderRule
  }
};
