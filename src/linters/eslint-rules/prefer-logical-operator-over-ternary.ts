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
 * literal. The rewrite is exact at runtime: with a negated test (`a ? false : b` → `!a && b`, `a ? b : true` →
 * `!a || b`) for any test, and otherwise (`a ? true : b` → `a || b`, `a ? b : false` → `a && b`) because unicorn
 * reports that shape only for a test it has proven boolean.
 */

import type { Rule } from 'eslint';
import type {
  ConditionalExpression,
  Expression,
  Node
} from 'estree';

import eslintPluginUnicorn from 'eslint-plugin-unicorn';

/**
 * The id of the unicorn rule this rule delegates to, inside the `unicorn` namespace.
 */
export const UNICORN_RULE_NAME = 'prefer-logical-operator-over-ternary';

/**
 * The message id unicorn reports a ternary under when a logical operator could replace it.
 */
export const MESSAGE_ID = 'prefer-logical-operator-over-ternary/error';

type LogicalOperator = '&&' | '||';

type UnicornReportDescriptor = Rule.ReportDescriptorOptions & UnicornReportDescriptorFields;

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
  const testText = shouldNegateTest ? `!${toOperandText(test, '!', sourceCode)}` : toOperandText(test, operator, sourceCode);
  const otherText = toOperandText(other, operator, sourceCode);

  return {
    ...descriptor,
    fix(fixer): Rule.Fix {
      return fixer.replaceText(conditionalExpression, `${testText} ${operator} ${otherText}`);
    }
  };
}
