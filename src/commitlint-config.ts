/**
 * @file
 *
 * Shared commitlint configuration for Conventional Commits.
 */

/* v8 ignore start -- Declarative commitlint configuration; correctness is verified by running commitlint, not unit tests. */

import type {
  RuleConfigSeverity,
  UserConfig
} from '@commitlint/types';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { createRequire } from 'node:module';

import {
  forbiddenPatternsPlugin,
  NO_FORBIDDEN_PATTERNS_RULE_NAME
} from './commitlint-forbidden-patterns.ts';
import {
  LINT_MD_HEADER_RULE_NAME,
  lintMdHeaderPlugin
} from './commitlint-lint-md-header.ts';
import {
  SPELLCHECK_HEADER_RULE_NAME,
  spellcheckHeaderPlugin
} from './commitlint-spellcheck-header.ts';

/*
 * `RuleConfigSeverity.Error`. The enum lives in a package this library only has as a devDependency, so its value cannot be imported at runtime.
 */
const ERROR_SEVERITY_LEVEL = 2;
const ERROR_SEVERITY = castTo<RuleConfigSeverity>(ERROR_SEVERITY_LEVEL);

/**
 * The absolute path of `@commitlint/config-conventional`'s entry, resolved from this module. Commitlint resolves a
 * bare `extends` name from the consumer's working directory, which finds this package's own dependency only when the
 * package manager happened to hoist it; an absolute path finds it wherever it was installed.
 */
const CONFIG_CONVENTIONAL_PATH = createRequire(import.meta.url).resolve('@commitlint/config-conventional');

/**
 * Commitlint configuration extending `@commitlint/config-conventional`, plus a rule refusing a message whose
 * header, body or footer matches the unpublished forbidden-patterns list (a no-op when none is configured), and
 * two rules checking the header the way the release checks the changelog bullet it becomes: a spellcheck (a no-op
 * in a project with no `spellcheck` script) and a markdownlint (a no-op in a project with no `lint:md` script).
 */
export const commitlintConfig: UserConfig = {
  extends: [CONFIG_CONVENTIONAL_PATH],
  // ONE plugin object, never two: `@commitlint/load` stores every inline plugin under the same `local` key, so a
  // second object silently replaces the first and its rule then fails as "Found rules without implementation".
  plugins: [
    {
      rules: {
        ...forbiddenPatternsPlugin.rules,
        ...lintMdHeaderPlugin.rules,
        ...spellcheckHeaderPlugin.rules
      }
    }
  ],
  rules: {
    [LINT_MD_HEADER_RULE_NAME]: [ERROR_SEVERITY, 'always'],
    [NO_FORBIDDEN_PATTERNS_RULE_NAME]: [ERROR_SEVERITY, 'always'],
    [SPELLCHECK_HEADER_RULE_NAME]: [ERROR_SEVERITY, 'always']
  }
};

/**
 * The previous name of {@link commitlintConfig}.
 *
 * @deprecated Use {@link commitlintConfig}. This alias is removed in the next major.
 */
export const obsidianDevUtilsConfig: UserConfig = commitlintConfig;

/* v8 ignore stop */
