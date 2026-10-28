/**
 * @file
 *
 * ESLint rule: prefer-noop-async
 *
 * Reports `await Promise.resolve()` and suggests replacing it with
 * `await noopAsync()` for consistency and readability.
 *
 * The fix reuses a visible value import from `@mnaoumov/typescript-lib/function`,
 * or adds a collision-free import. Scripts without one retain the diagnostic only.
 */
import type { TSESTree } from '@typescript-eslint/utils';
import type {
  Rule,
  Scope
} from 'eslint';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import {
  findVisibleImportName,
  getUnusedName,
  insertImport
} from './import-fix.ts';
import { toTSESTreeNode } from './ts-estree-node.ts';

const FUNCTION_MODULE = '@mnaoumov/typescript-lib/function';
/**
Message ID reported when `Promise.resolve()` is used for an async no-op instead of `noopAsync()`.
 */
export const MESSAGE_ID = 'preferNoopAsync';

/**
 * ESLint rule preferring `noopAsync()` over `Promise.resolve()` for an async no-op.
 */
export const preferNoopAsync: Rule.RuleModule = {
  create(context) {
    return {
      'CallExpression'(node: Rule.Node): void {
        const callNode = toTSESTreeNode(node) as TSESTree.CallExpression;

        if (!isPromiseResolveWithNoArguments(callNode) || isLocallyBoundPromise(context.sourceCode.getScope(node), callNode)) {
          return;
        }

        context.report({
          fix(fixer) {
            const sourceCode = context.sourceCode;
            const importedName = findVisibleImportName({ importedName: 'noopAsync', moduleName: FUNCTION_MODULE, node, sourceCode });
            if (importedName !== null) {
              return fixer.replaceText(node, `${importedName}()`);
            }

            // A script cannot accept an ESM import. Leave its diagnostic for a manual edit.
            if (sourceCode.ast.sourceType !== 'module') {
              return null;
            }
            const name = getUnusedName(sourceCode, 'noopAsync');
            const binding = name === 'noopAsync' ? name : `noopAsync as ${name}`;
            return [
              insertImport(fixer, sourceCode, `import { ${binding} } from '${FUNCTION_MODULE}';`),
              fixer.replaceText(node, `${name}()`)
            ];
          },
          messageId: MESSAGE_ID,
          node
        });
      }
    };
  },
  meta: {
    docs: {
      description: 'Prefer `noopAsync()` over `Promise.resolve()`'
    },
    fixable: 'code',
    messages: {
      [MESSAGE_ID]: 'Use `noopAsync()` instead of `Promise.resolve()` for async no-ops.'
    },
    schema: [],
    type: 'suggestion'
  }
};

/**
 * Checks whether the `Promise` of a `Promise.resolve()` call resolves to a binding the code declares itself,
 * such as a local variable, a parameter or an import, rather than the global.
 *
 * @param scope - The scope enclosing the call.
 * @param node - The `Promise.resolve()` call expression.
 * @returns `true` if `Promise` is bound by a declaration in the code.
 */
function isLocallyBoundPromise(scope: Scope.Scope, node: TSESTree.CallExpression): boolean {
  const callee = node.callee as TSESTree.MemberExpression;
  const reference = ensureNonNullable(scope.references.find((candidate) => toTSESTreeNode(candidate.identifier) === callee.object));
  // A global `Promise` resolves to a variable without definitions, or to nothing when no globals are configured.
  return (reference.resolved?.defs.length ?? 0) > 0;
}

/**
 * Checks whether a call expression is `Promise.resolve()` with no arguments.
 *
 * @param node - The call expression node.
 * @returns `true` if the node is `Promise.resolve()` with no arguments.
 */
function isPromiseResolveWithNoArguments(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;

  /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- AST node type string literals match the TSESTree enum values. */
  return node.arguments.length === 0
    && callee.type === 'MemberExpression'
    && callee.object.type === 'Identifier' && callee.object.name === 'Promise'
    && callee.property.type === 'Identifier' && callee.property.name === 'resolve';
  /* eslint-enable @typescript-eslint/no-unsafe-enum-comparison -- AST node type string literals match the TSESTree enum values. */
}
