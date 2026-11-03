/**
 * @file
 *
 * Unicorn's spread rule, with slice rewrites restricted to proven array receivers.
 * A typed array's slice preserves its type; spreading it produces an ordinary array.
 */

import type { ParserServicesWithTypeInformation } from '@typescript-eslint/utils';
import type { Rule } from 'eslint';
import type {
  MemberExpression,
  Node
} from 'estree';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

import { toTSESTreeNode } from './ts-estree-node.ts';

const unicornRule = ensureNonNullable(ensureNonNullable(eslintPluginUnicorn.rules)['prefer-spread']) as Rule.RuleModule;

interface SpreadReportDescriptor {
  readonly messageId?: string;
  readonly node: Node;
}

/**
 * Prefers spread syntax while preserving slice calls whose receiver is not proven to be an array.
 */
export const preferSpread: Rule.RuleModule = {
  create(context) {
    const reportingContext: Rule.RuleContext = Object.create(context, {
      report: {
        value(descriptor: Rule.ReportDescriptor): void {
          const { messageId, node } = descriptor as SpreadReportDescriptor;
          if (messageId === 'array-slice' && !isArrayReceiver(node, context.sourceCode)) {
            return;
          }
          context.report(descriptor);
        }
      }
    });
    return unicornRule.create(reportingContext);
  },
  meta: {
    ...unicornRule.meta,
    docs: {
      description: 'Prefer spread syntax without changing the type returned by slice'
    }
  }
};

function isArrayReceiver(node: Node, sourceCode: Rule.RuleContext['sourceCode']): boolean {
  // Unicorn reports array-slice on the method property of a member expression.
  const member = ensureNonNullable(sourceCode.getAncestors(node).at(-1)) as MemberExpression;
  const services = sourceCode.parserServices as Partial<ParserServicesWithTypeInformation>;
  if (!services.program) {
    return false;
  }
  const checker = services.program.getTypeChecker();
  const receiverType = checker.getTypeAtLocation(ensureNonNullable(services.esTreeNodeToTSNodeMap).get(toTSESTreeNode(member.object)));
  const type = checker.getBaseConstraintOfType(receiverType) ?? receiverType;
  const constituents = type.isUnion() ? type.types : [type];
  return constituents.every((constituent) => checker.isArrayType(constituent) || checker.isTupleType(constituent));
}
