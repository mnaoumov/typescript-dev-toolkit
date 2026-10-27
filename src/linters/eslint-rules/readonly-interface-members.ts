/**
 * @file
 *
 * ESLint rule: readonly-interface-members
 *
 * Requires readonly property signatures in interfaces and object type aliases,
 * including nested object types. Mutable state requires an explicit exception.
 */
import type { Rule } from 'eslint';

/**
Message ID reported when a property signature is not declared `readonly`.
 */
export const MESSAGE_ID = 'readonlyInterfaceMembers';

/**
 * ESLint rule requiring every property of an interface or object type alias to be `readonly`.
 */
export const readonlyInterfaceMembers: Rule.RuleModule = {
  create(context) {
    return {
      'TSInterfaceDeclaration TSPropertySignature[readonly=false]'(node: Rule.Node): void {
        reportNonReadonly(context, node);
      },
      'TSTypeAliasDeclaration TSPropertySignature[readonly=false]'(node: Rule.Node): void {
        reportNonReadonly(context, node);
      }
    };
  },
  meta: {
    docs: {
      description: 'Require readonly properties in all interfaces and object type aliases'
    },
    fixable: 'code',
    messages: {
      [MESSAGE_ID]: 'Property must be `readonly`. Disable this rule with a reason for mutable state.'
    },
    schema: [],
    type: 'suggestion'
  }
};

function reportNonReadonly($context: Rule.RuleContext, node: Rule.Node): void {
  $context.report({
    fix(fixer) {
      return fixer.insertTextBefore(node, 'readonly ');
    },
    messageId: MESSAGE_ID,
    node
  });
}
