/**
 * @file
 *
 * Requires readonly array types on interface and object type alias properties.
 */
import type { TSESTree } from '@typescript-eslint/utils';
import type { Rule } from 'eslint';

import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { toTSESTreeNode } from './ts-estree-node.ts';

/**
 * Opt-in array immutability policy, independent of readonly property references.
 */
export const readonlyMemberArrays: Rule.RuleModule = {
  create(context) {
    function check(node: TSESTree.TypeNode, property: Rule.Node): void {
      if (node.type === AST_NODE_TYPES.TSUnionType || node.type === AST_NODE_TYPES.TSIntersectionType) {
        for (const member of node.types) {
          check(member, property);
        }
        return;
      }
      if (node.type === AST_NODE_TYPES.TSArrayType) {
        context.report({
          messageId: 'readonly',
          node,
          suggest: [{ fix: (fixer): Rule.Fix => fixer.insertTextBefore(node, 'readonly '), messageId: 'review' }]
        });
        return;
      }
      if (
        node.type !== AST_NODE_TYPES.TSTypeReference
        || node.typeName.type !== AST_NODE_TYPES.Identifier
        || node.typeName.name !== 'Array'
        || node.typeArguments?.params.length !== 1
      ) {
        return;
      }
      let scope: null | ReturnType<typeof context.sourceCode.getScope> = context.sourceCode.getScope(property);
      let canSuggest = true;
      while (scope) {
        if (scope.set.get('Array')?.defs.length) {
          return;
        }
        if (scope.set.get('ReadonlyArray')?.defs.length) {
          canSuggest = false;
        }
        scope = scope.upper;
      }
      context.report({
        messageId: 'readonly',
        node,
        suggest: canSuggest
          ? [{
            fix: (fixer): Rule.Fix => fixer.replaceTextRange(node.typeName.range, 'ReadonlyArray'),
            messageId: 'review'
          }]
          : []
      });
    }

    function visitProperty(node: Rule.Node): void {
      const property = toTSESTreeNode(node) as TSESTree.TSPropertySignature;
      if (property.typeAnnotation) {
        check(property.typeAnnotation.typeAnnotation, node);
      }
    }

    return {
      'TSInterfaceDeclaration TSPropertySignature': visitProperty,
      'TSTypeAliasDeclaration TSPropertySignature': visitProperty
    };
  },
  meta: {
    docs: { description: 'Require readonly member arrays as an explicit collection immutability policy' },
    hasSuggestions: true,
    messages: {
      readonly: 'Use a readonly member array, or disable this rule with a reason for mutation.',
      review: 'Make this array readonly after reviewing mutations and assignability.'
    },
    schema: [],
    type: 'suggestion'
  }
};
