import {
  describe,
  expect,
  it
} from 'vitest';

import {
  genericInHouseEslintRules,
  IN_HOUSE_ESLINT_PLUGIN_NAME,
  inHouseEslintPlugin
} from './in-house-plugin.ts';

describe('in-house plugin', () => {
  it('should keep the namespace existing disable comments name', () => {
    expect(IN_HOUSE_ESLINT_PLUGIN_NAME).toBe('typescript-dev-toolkit');
  });

  it('should register every generic rule', () => {
    expect(Object.keys(genericInHouseEslintRules).sort()).toEqual([
      'no-async-callback-to-unsafe-return',
      'no-keyword-identifiers',
      'no-unresolved-jsdoc-link',
      'no-unused-params-members',
      'no-used-underscore-variables',
      'params-options-name-match',
      'prefer-dedent',
      'prefer-logical-operator-over-ternary',
      'prefer-noop-async',
      'readonly-interface-members',
      'readonly-member-arrays',
      'require-method-template',
      'require-super-call'
    ]);
    expect(inHouseEslintPlugin.rules).toBe(genericInHouseEslintRules);
  });
});
