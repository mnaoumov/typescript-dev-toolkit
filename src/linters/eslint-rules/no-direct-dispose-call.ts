/**
 * @file
 *
 * ESLint rule: no-direct-dispose-call
 *
 * Reports a direct `x[Symbol.dispose]()` / `x[Symbol.asyncDispose]()` call. A stored handle is disposed through its
 * `dispose()` / `asyncDispose()` alias (`DisposableEx` / `AsyncDisposableEx` from `@mnaoumov/typescript-lib`), and a
 * plain `Disposable` is converted with `toDisposableEx()` / `toAsyncDisposableEx()` first.
 *
 * The call is left alone inside the member that implements disposal itself: a class or object-literal member keyed
 * `[Symbol.dispose]`, `[Symbol.asyncDispose]`, `dispose` or `asyncDispose`, which is where the aliases are defined.
 *
 * A call that is the whole body of a callback handed to a `register(...)` method
 * (`component.register(() => x[Symbol.dispose]())`) gets its own message, and the `registerHelperName` option names
 * the helper that registers a disposable directly, for a package that has one.
 */

import type { TSESTree } from '@typescript-eslint/utils';
import type { Rule } from 'eslint';

import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { toTSESTreeNode } from './ts-estree-node.ts';

/**
 * Message ID reported for a direct `[Symbol.dispose]()` call.
 */
export const DISPOSE_MESSAGE_ID = 'dispose';

/**
 * Message ID reported for a direct `[Symbol.asyncDispose]()` call.
 */
export const ASYNC_DISPOSE_MESSAGE_ID = 'asyncDispose';

/**
 * Message ID reported for `register(() => x[Symbol.dispose]())`, when the `registerHelperName` option is set.
 */
export const REGISTER_MESSAGE_ID = 'register';

type DisposeSymbolName = 'asyncDispose' | 'dispose';

interface RuleOptions {
  readonly registerHelperName?: string;
}

const IMPLEMENTING_MEMBER_NAMES = new Set(['asyncDispose', 'dispose']);

/**
 * ESLint rule reporting a direct `[Symbol.dispose]()` / `[Symbol.asyncDispose]()` call outside a disposable
 * implementation.
 */
export const noDirectDisposeCall: Rule.RuleModule = {
  create(context) {
    const options = (context.options[0] ?? {}) as RuleOptions;
    const registerHelperName = options.registerHelperName ?? null;

    return {
      'CallExpression'(node: Rule.Node): void {
        const callNode = toTSESTreeNode(node) as TSESTree.CallExpression;
        const symbolName = getDisposeSymbolName(callNode.callee);
        if (symbolName === null || !isGlobalSymbol(context.sourceCode.getScope(node)) || isInsideImplementingMember(callNode)) {
          return;
        }

        if (registerHelperName !== null && isRegisterCallbackBody(callNode)) {
          context.report({
            data: { helper: registerHelperName, symbol: symbolName },
            messageId: REGISTER_MESSAGE_ID,
            node
          });
          return;
        }

        context.report({
          messageId: symbolName === 'dispose' ? DISPOSE_MESSAGE_ID : ASYNC_DISPOSE_MESSAGE_ID,
          node
        });
      }
    };
  },
  meta: {
    docs: {
      description: 'Disallow calling `[Symbol.dispose]()` / `[Symbol.asyncDispose]()` directly outside a disposable implementation'
    },
    messages: {
      [ASYNC_DISPOSE_MESSAGE_ID]: 'Call `await x.asyncDispose()` instead of `x[Symbol.asyncDispose]()` (wrap a plain `AsyncDisposable` with `toAsyncDisposableEx()`).',
      [DISPOSE_MESSAGE_ID]: 'Call `x.dispose()` instead of `x[Symbol.dispose]()` (wrap a plain `Disposable` with `toDisposableEx()`).',
      [REGISTER_MESSAGE_ID]: 'Register the disposable itself with `{{helper}}(component, x)` instead of a callback calling `x[Symbol.{{symbol}}]()`.'
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          registerHelperName: {
            type: 'string'
          }
        },
        type: 'object'
      }
    ],
    type: 'suggestion'
  }
};

function getDisposeSymbolName(callee: TSESTree.Expression): DisposeSymbolName | null {
  return callee.type === AST_NODE_TYPES.MemberExpression && callee.computed ? getSymbolKeyName(callee.property) : null;
}

function getImplementedMemberName(node: TSESTree.Node): null | string {
  if (
    node.type !== AST_NODE_TYPES.MethodDefinition && node.type !== AST_NODE_TYPES.PropertyDefinition
    && node.type !== AST_NODE_TYPES.Property
  ) {
    return null;
  }
  if (node.computed) {
    return getSymbolKeyName(node.key);
  }
  return node.key.type === AST_NODE_TYPES.Identifier ? node.key.name : null;
}

function getSymbolKeyName(node: TSESTree.Node): DisposeSymbolName | null {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression || node.computed || node.object.type !== AST_NODE_TYPES.Identifier
    || node.object.name !== 'Symbol' || node.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  const name = node.property.name;
  return name === 'dispose' || name === 'asyncDispose' ? name : null;
}

function isGlobalSymbol(scope: ReturnType<Rule.RuleContext['sourceCode']['getScope']>): boolean {
  for (let current: null | typeof scope = scope; current !== null; current = current.upper) {
    const variable = current.set.get('Symbol');
    if (variable !== undefined && variable.defs.length > 0) {
      return false;
    }
  }
  return true;
}

function isInsideImplementingMember(node: TSESTree.Node): boolean {
  // ESLint sets the `Program` node's `parent` to `null`, though the typings say `undefined`.
  for (let current = node.parent; current; current = current.parent) {
    const name = getImplementedMemberName(current);
    if (name !== null && IMPLEMENTING_MEMBER_NAMES.has(name)) {
      return true;
    }
  }
  return false;
}

function isRegisterCallbackBody(callNode: TSESTree.CallExpression): boolean {
  const expression: TSESTree.Node = callNode.parent.type === AST_NODE_TYPES.ChainExpression ? callNode.parent : callNode;
  const callback = expression.parent;
  if (callback.type !== AST_NODE_TYPES.ArrowFunctionExpression || callback.body !== expression) {
    return false;
  }
  const registerCall = callback.parent;
  if (registerCall.type !== AST_NODE_TYPES.CallExpression || registerCall.arguments.length !== 1 || registerCall.arguments[0] !== callback) {
    return false;
  }
  const callee = registerCall.callee;
  return callee.type === AST_NODE_TYPES.MemberExpression && !callee.computed && callee.property.type === AST_NODE_TYPES.Identifier
    && callee.property.name === 'register';
}
