/**
 * @file
 *
 * The generic in-house ESLint rules, and the plugin that registers them.
 *
 * The generic rules are registered under {@link IN_HOUSE_ESLINT_PLUGIN_NAME}, the name of the package that defines
 * them. A package adding rules of its own registers them under its own name, as a plugin of its own beside
 * {@link inHouseEslintPlugin}.
 */

import type { ESLint } from 'eslint';

import { noAsyncCallbackToUnsafeReturn } from './no-async-callback-to-unsafe-return.ts';
import { noUnresolvedJsdocLink } from './no-unresolved-jsdoc-link.ts';
import { noUnusedParamsMembers } from './no-unused-params-members.ts';
import { noUsedUnderscoreVariables } from './no-used-underscore-variables.ts';
import { paramsOptionsNameMatch } from './params-options-name-match.ts';
import { preferLogicalOperatorOverTernary } from './prefer-logical-operator-over-ternary.ts';
import { preferNoopAsync } from './prefer-noop-async.ts';
import { readonlyInterfaceMembers } from './readonly-interface-members.ts';
import { requireMethodTemplate } from './require-method-template.ts';
import { requireSuperCall } from './require-super-call.ts';

/**
 * The namespace the generic in-house rules are registered under: the name of the package that defines them.
 */
export const IN_HOUSE_ESLINT_PLUGIN_NAME = 'typescript-dev-toolkit';

/**
 * The generic in-house rules, keyed by their name inside {@link IN_HOUSE_ESLINT_PLUGIN_NAME}.
 */
export const genericInHouseEslintRules: NonNullable<ESLint.Plugin['rules']> = {
  'no-async-callback-to-unsafe-return': noAsyncCallbackToUnsafeReturn,
  'no-unresolved-jsdoc-link': noUnresolvedJsdocLink,
  'no-unused-params-members': noUnusedParamsMembers,
  'no-used-underscore-variables': noUsedUnderscoreVariables,
  'params-options-name-match': paramsOptionsNameMatch,
  'prefer-logical-operator-over-ternary': preferLogicalOperatorOverTernary,
  'prefer-noop-async': preferNoopAsync,
  'readonly-interface-members': readonlyInterfaceMembers,
  'require-method-template': requireMethodTemplate,
  'require-super-call': requireSuperCall
};

/**
 * The ESLint plugin registering the generic in-house rules alone, for a project that adds none of its own.
 */
export const inHouseEslintPlugin: ESLint.Plugin = {
  rules: genericInHouseEslintRules
};
