/**
 * @file
 *
 * ESLint rule: prefer-dedent
 *
 * Reports an array of string literals joined with a newline (`['a', 'b'].join('\n')`) and fixes it to a `dedent`
 * template. An array holding anything but string and template literals is left alone: it builds a string at runtime.
 *
 * The fix rewrites the joined text so that `dedent` (1.x, used as a tag) returns exactly the same string. It runs the
 * same steps `dedent` does in reverse: a leading or trailing run of line breaks and every carriage return become
 * `\n` / `\r` escapes, which `dedent` decodes only after it trims, and backticks and `${` are escaped. Text it cannot
 * represent that way keeps the diagnostic without a fix: a backslash, which `dedent` passes on raw; leading or trailing
 * whitespace that `dedent` would trim; a template literal with expressions, whose values are unknown; and comments
 * inside the call. The fix reuses a visible default import of `dedent`, or adds one under a free name.
 */
import type { TSESTree } from '@typescript-eslint/utils';
import type { Rule } from 'eslint';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import {
  findVisibleImportName,
  getUnusedName,
  insertImport
} from './import-fix.ts';
import { toTSESTreeNode } from './ts-estree-node.ts';

const DEDENT_MODULE = 'dedent';
const INDENT = '  ';
const LINE_BREAK_SEPARATORS = new Set(['\n', '\r\n']);
const MINIMUM_ELEMENTS_WITH_A_LINE_BREAK = 2;

/**
 * Message ID reported when an array of string literals is joined with a newline instead of written as a `dedent` template.
 */
export const MESSAGE_ID = 'preferDedent';

type StringElement = TSESTree.StringLiteral | TSESTree.TemplateLiteral;

/**
 * ESLint rule preferring a `dedent` template over an array of string literals joined with a newline.
 */
export const preferDedent: Rule.RuleModule = {
  create(context) {
    return {
      'CallExpression'(node: Rule.Node): void {
        const callNode = toTSESTreeNode(node) as TSESTree.CallExpression;
        const joined = getJoinedStringElements(callNode);
        if (!joined) {
          return;
        }

        context.report({
          fix(fixer) {
            const sourceCode = context.sourceCode;
            if (sourceCode.getCommentsInside(node).length > 0) {
              return null;
            }
            const text = getJoinedText(joined.elements, joined.separator);
            const lines = text === null ? null : toDedentLines(text);
            if (lines === null) {
              return null;
            }

            const fixes: Rule.Fix[] = [];
            let name = findVisibleImportName({ importedName: 'default', moduleName: DEDENT_MODULE, node, sourceCode });
            if (name === null) {
              // A script cannot accept an ESM import. Leave its diagnostic for a manual edit.
              if (sourceCode.ast.sourceType !== 'module') {
                return null;
              }
              name = getUnusedName(sourceCode, 'dedent');
              fixes.push(insertImport(fixer, sourceCode, `import ${name} from '${DEDENT_MODULE}';`));
            }

            const linePrefix = sourceCode.text.slice(sourceCode.getIndexFromLoc({ column: 0, line: callNode.loc.start.line }), callNode.range[0]);
            const lineIndent = linePrefix.slice(0, linePrefix.length - linePrefix.trimStart().length);
            const body = lines.map((line) => line === '' ? '' : `${lineIndent}${INDENT}${line}`).join('\n');
            fixes.push(fixer.replaceText(node, `${name}\`\n${body}\n${lineIndent}\``));
            return fixes;
          },
          messageId: MESSAGE_ID,
          node
        });
      }
    };
  },
  meta: {
    docs: {
      description: 'Prefer a `dedent` template over an array of string literals joined with a newline'
    },
    fixable: 'code',
    messages: {
      [MESSAGE_ID]: 'Write this multiline string as a `dedent` template instead of joining an array of string literals with a newline.'
    },
    schema: [],
    type: 'suggestion'
  }
};

interface JoinedStringElements {
  readonly elements: readonly StringElement[];
  readonly separator: string;
}

function escapeLineBreaks(text: string): string {
  return text.replaceAll('\r', String.raw`\r`).replaceAll('\n', String.raw`\n`);
}

function escapeTemplateText(text: string): string {
  return text.replaceAll('`', '\\`').replaceAll('${', '\\${').replaceAll('\r', String.raw`\r`);
}

function getJoinedStringElements(node: TSESTree.CallExpression): JoinedStringElements | null {
  const callee = node.callee;
  if (
    node.optional || node.arguments.length !== 1
    || callee.type !== AST_NODE_TYPES.MemberExpression || callee.optional || callee.computed
    || callee.property.type !== AST_NODE_TYPES.Identifier || callee.property.name !== 'join'
    || callee.object.type !== AST_NODE_TYPES.ArrayExpression
  ) {
    return null;
  }

  const separator = getStaticString(ensureNonNullable(node.arguments[0]));
  if (separator === null || !LINE_BREAK_SEPARATORS.has(separator)) {
    return null;
  }

  const elements: StringElement[] = [];
  for (const element of callee.object.elements) {
    if (!isStringElement(element)) {
      return null;
    }
    elements.push(element);
  }
  // A single element joins to itself; there is no line break to rewrite.
  return elements.length < MINIMUM_ELEMENTS_WITH_A_LINE_BREAK ? null : { elements, separator };
}

function getJoinedText(elements: readonly StringElement[], separator: string): null | string {
  const values: string[] = [];
  for (const element of elements) {
    const value = getStaticString(element);
    if (value === null) {
      return null;
    }
    values.push(value);
  }
  return values.join(separator);
}

function getStaticString(node: TSESTree.Node): null | string {
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' ? node.value : null;
  }
  // An untagged template with an invalid escape is a syntax error, so its cooked text always exists.
  return node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0 ? ensureNonNullable(node.quasis[0]).value.cooked : null;
}

function isStringElement(element: null | TSESTree.Node): element is StringElement {
  return element?.type === AST_NODE_TYPES.TemplateLiteral
    || (element?.type === AST_NODE_TYPES.Literal && typeof element.value === 'string');
}

/**
 * Encodes text as the lines of a `dedent` template body, before indentation.
 *
 * `dedent` trims the whole result and only then decodes `\n` and `\r` escapes, so an edge run of line breaks survives
 * when written as escapes, and any other edge whitespace does not survive at all. It strips the smallest indentation
 * of the lines, and the first line here always starts with a non-blank character, so every line keeps its own.
 *
 * @param text - The text the template must produce.
 * @returns The body lines, or `null` when `dedent` cannot produce the text from a plain template.
 */
function toDedentLines(text: string): null | string[] {
  if (text.includes('\\')) {
    return null;
  }
  const rest = text.replace(/^[\r\n]+/, '');
  const leading = text.slice(0, text.length - rest.length);
  const core = rest.replace(/[\r\n]+$/, '');
  const trailing = rest.slice(core.length);
  if (core === '' || (leading === '' && /^\s/.test(core)) || (trailing === '' && /\s$/.test(core))) {
    return null;
  }

  // The escapes hold no line break, so splitting after escaping splits only the line breaks of the core.
  return `${escapeLineBreaks(leading)}${escapeTemplateText(core)}${escapeLineBreaks(trailing)}`.split('\n');
}
