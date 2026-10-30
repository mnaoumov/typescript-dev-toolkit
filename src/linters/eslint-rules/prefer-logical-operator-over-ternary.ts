/**
 * @file
 *
 * ESLint rule: prefer-logical-operator-over-ternary
 *
 * `unicorn/prefer-logical-operator-over-ternary`, with the fix it withholds in a TypeScript file.
 *
 * Unicorn reports a ternary with one boolean branch (`a ? false : b`) and fixes it to a logical expression
 * (`!a && b`), but only outside TypeScript. `unicorn/prefer-ternary` fixes `if (a) { return false; } return b;` into
 * exactly that ternary, so in a TypeScript file `lint:fix` produced an error it then could not fix, and every site
 * had to be rewritten by hand. This rule reports what unicorn reports and adds the fix where one branch is a boolean
 * literal. Unicorn reports the shape only when the other branch is boolean, and since unicorn 79 for a test of any
 * type. The rewrite is exact at runtime: a negated test (`a ? false : b` → `!a && b`, `a ? b : true` → `!a || b`) is
 * a boolean already, and otherwise (`a ? true : b` → `a || b`, `a ? b : false` → `a && b`) a test the type checker
 * cannot prove boolean is coerced with `!!`, because `a && b` would return a falsy `a` itself (`null`, `0`, `''`)
 * where the ternary returned `false`. Unicorn coerces with `Boolean(a)`; `!!a` is used here because TypeScript
 * narrows on it, so `!!a && a.b` still type-checks.
 */

import type { ParserServicesWithTypeInformation } from '@typescript-eslint/utils';
import type { Rule } from 'eslint';
import type {
  ConditionalExpression,
  Expression,
  Node
} from 'estree';

import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import { TypeFlags } from 'typescript';

import { toTSESTreeNode } from './ts-estree-node.ts';

/**
 * The id of the unicorn rule this rule delegates to, inside the `unicorn` namespace.
 */
export const UNICORN_RULE_NAME = 'prefer-logical-operator-over-ternary';

/**
 * The message id unicorn reports a ternary under when a logical operator could replace it.
 */
export const MESSAGE_ID = 'prefer-logical-operator-over-ternary/error';

type LogicalOperator = '&&' | '||';

interface UnicornReportDescriptorFields {
  readonly messageId?: string;
  readonly node: Node;
}

const unicornRule = getUnicornRule();

/**
 * ESLint rule reporting what `unicorn/prefer-logical-operator-over-ternary` reports, fixing a ternary with a boolean
 * literal branch in a TypeScript file too.
 */
export const preferLogicalOperatorOverTernary: Rule.RuleModule = {
  create(context) {
    const reportingContext: Rule.RuleContext = Object.create(context, {
      report: {
        value(descriptor: Rule.ReportDescriptor): void {
          context.report(withLiteralBranchFix(descriptor, context.sourceCode));
        }
      }
    });

    return unicornRule.create(reportingContext);
  },
  meta: {
    ...unicornRule.meta,
    docs: {
      description: 'Prefer a logical operator over a ternary, fixing a boolean literal branch in TypeScript too'
    }
  }
};

function getBooleanLiteralValue(node: Node): boolean | undefined {
  return node.type === 'Literal' && typeof node.value === 'boolean' ? node.value : undefined;
}

function getUnicornRule(): Rule.RuleModule {
  const rule = eslintPluginUnicorn.rules?.[UNICORN_RULE_NAME];

  /* v8 ignore start -- Guards an upgrade of eslint-plugin-unicorn that drops or renames the rule. */
  if (!rule || typeof rule === 'function') {
    throw new Error(`eslint-plugin-unicorn no longer defines the ${UNICORN_RULE_NAME} rule.`);
  }
  /* v8 ignore stop */

  return rule;
}

function isProvenBoolean(node: Expression, sourceCode: Rule.RuleContext['sourceCode']): boolean {
  const services = sourceCode.parserServices as Partial<ParserServicesWithTypeInformation>;
  if (!services.program || !services.esTreeNodeToTSNodeMap) {
    return false;
  }

  const type = services.program.getTypeChecker().getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(toTSESTreeNode(node)));
  const constituents = type.isUnion() ? type.types : [type];
  // eslint-disable-next-line no-bitwise -- `TypeFlags` is a bit set.
  return constituents.every((constituent) => (constituent.flags & TypeFlags.BooleanLike) !== 0);
}

function needsParentheses(node: Expression, operator: '!' | LogicalOperator): boolean {
  switch (node.type) {
    case 'ArrayExpression':
    case 'AwaitExpression':
    case 'CallExpression':
    case 'ChainExpression':
    case 'Identifier':
    case 'Literal':
    case 'MemberExpression':
    case 'NewExpression':
    case 'ObjectExpression':
    case 'TaggedTemplateExpression':
    case 'TemplateLiteral':
    case 'ThisExpression':
    case 'UnaryExpression': {
      return false;
    }
    case 'BinaryExpression': {
      return operator === '!';
    }
    case 'LogicalExpression': {
      return operator === '!' || node.operator === '??' || (operator === '&&' && node.operator === '||');
    }
    default: {
      return true;
    }
  }
}

function toOperandText(node: Expression, operator: '!' | LogicalOperator, sourceCode: Rule.RuleContext['sourceCode']): string {
  const text = sourceCode.getText(node);
  return needsParentheses(node, operator) ? `(${text})` : text;
}

function withLiteralBranchFix(descriptor: Rule.ReportDescriptor, sourceCode: Rule.RuleContext['sourceCode']): Rule.ReportDescriptor {
  type UnicornReportDescriptor = Rule.ReportDescriptorOptions & UnicornReportDescriptorFields;
  const { fix, messageId, node, suggest } = descriptor as UnicornReportDescriptor;

  // Unicorn fixes the shape itself outside TypeScript, and offers suggestions for the shapes it cannot fix.
  if (messageId !== MESSAGE_ID || fix || suggest) {
    return descriptor;
  }

  // Unicorn reports this message on the ternary itself.
  const conditionalExpression = node as ConditionalExpression;
  const { alternate, consequent, test } = conditionalExpression;
  const consequentValue = getBooleanLiteralValue(consequent);
  const alternateValue = getBooleanLiteralValue(alternate);
  const literalValue = consequentValue ?? alternateValue;

  if (
    literalValue === undefined
    || (consequentValue !== undefined && alternateValue !== undefined)
    || sourceCode.getCommentsInside(conditionalExpression).length > 0
  ) {
    return descriptor;
  }

  const isConsequentLiteral = consequentValue !== undefined;
  const other = isConsequentLiteral ? alternate : consequent;
  const shouldNegateTest = isConsequentLiteral !== literalValue;
  const operator: LogicalOperator = literalValue ? '||' : '&&';
  let testText: string;
  if (shouldNegateTest) {
    testText = `!${toOperandText(test, '!', sourceCode)}`;
  } else if (isProvenBoolean(test, sourceCode)) {
    testText = toOperandText(test, operator, sourceCode);
  } else {
    testText = `!!${toOperandText(test, '!', sourceCode)}`;
  }
  const otherText = toOperandText(other, operator, sourceCode);

  return {
    ...descriptor,
    fix(fixer): Rule.Fix {
      return fixer.replaceText(conditionalExpression, `${testText} ${operator} ${otherText}`);
    }
  };
}
