/**
 * @file
 *
 * ESLint rule: no-undefined-return-type
 *
 * Reports `undefined` as a member of a declared return-type union: `(): T | undefined`, `Promise<T | undefined>`, an
 * arrow's return annotation, a method or call signature, a getter, an overload and a function type such as
 * `readonly f: () => T | undefined`. A function that can return "no value" returns `T | null`: `undefined` is kept for
 * an optional member, where a missing key is the "no value" state, so a return value spelled with `null` says the
 * function decided there is nothing, rather than that something was left out.
 *
 * The rule leaves alone what someone else's signature dictates:
 *
 * - a union that also holds `void`, the `MaybeReturn<T>` style of a callback whose result may be ignored;
 * - a function expression whose contextual type already returns `undefined` (a callback typed by a library, or by a
 *   type of our own that this rule reports at its declaration instead);
 * - a class or interface member whose name a base class, or an implemented or extended interface, already declares,
 *   and any `override` member;
 * - an object-literal member whose contextual type declares that name, and any member with a computed key;
 * - a function type written as a type argument (`vi.fn<() => T | undefined>()`), which describes the shape a generic
 *   is instantiated with, usually that of something being mocked;
 * - anything inside `declare module '...'` or `declare global`, which describes a shape another package owns.
 *
 * A type alias is not looked through, so `MaybeReturn<T>` itself is never reported at its use. The suggestion rewrites
 * the union with `null` in place of `undefined`; the `return` statements it then no longer accepts are the
 * compiler's to point at.
 */

import type {
  ParserServicesWithTypeInformation,
  TSESTree
} from '@typescript-eslint/utils';
import type { Rule } from 'eslint';
import type {
  Expression,
  Node as TsNode,
  Type,
  TypeChecker,
  TypeReference
} from 'typescript';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import {
  isClassLike,
  isInterfaceDeclaration,
  TypeFlags
} from 'typescript';

import { toTSESTreeNode } from './ts-estree-node.ts';

/**
 * Message ID reported for `undefined` in a declared return-type union.
 */
export const MESSAGE_ID = 'noUndefinedReturnType';

/**
 * Message ID of the suggestion that replaces `undefined` with `null`.
 */
export const SUGGESTION_MESSAGE_ID = 'replaceWithNull';

const PROMISE_TYPE_NAMES = new Set(['Promise', 'PromiseLike']);

// eslint-disable-next-line no-bitwise -- Bitwise flag mask is idiomatic for TypeScript compiler API.
const UNDEFINED_OR_VOID_FLAGS = TypeFlags.Undefined | TypeFlags.Void;

type FunctionLikeNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.TSCallSignatureDeclaration
  | TSESTree.TSDeclareFunction
  | TSESTree.TSEmptyBodyFunctionExpression
  | TSESTree.TSFunctionType
  | TSESTree.TSMethodSignature;

const MEMBER_NODE_TYPES: ReadonlySet<AST_NODE_TYPES> = new Set([
  AST_NODE_TYPES.MethodDefinition,
  AST_NODE_TYPES.PropertyDefinition,
  AST_NODE_TYPES.TSAbstractMethodDefinition,
  AST_NODE_TYPES.TSAbstractPropertyDefinition,
  AST_NODE_TYPES.TSMethodSignature,
  AST_NODE_TYPES.TSPropertySignature
]);

/**
 * ESLint rule reporting `undefined` in a declared return-type union, suggesting `null`.
 */
export const noUndefinedReturnType: Rule.RuleModule = {
  create(context) {
    const services = context.sourceCode.parserServices as ParserServicesWithTypeInformation;
    const checker = services.program.getTypeChecker();
    const sourceCode = context.sourceCode;

    /**
     * Checks one function-like node.
     *
     * @param estreeNode - The node ESLint passed to the rule.
     */
    function check(estreeNode: Rule.Node): void {
      const node = toTSESTreeNode(estreeNode) as FunctionLikeNode;
      const union = getReportedUnion(node.returnType?.typeAnnotation);
      if (!union || isInAmbientModule(node) || isDictated(node, services, checker)) {
        return;
      }

      const [start, end] = union.range;
      const hasComments = sourceCode.getAllComments().some((comment) => {
        const [commentStart, commentEnd] = ensureNonNullable(comment.range);
        return commentStart >= start && commentEnd <= end;
      });
      const memberTexts = union.types.map((member) => member.type === AST_NODE_TYPES.TSUndefinedKeyword ? 'null' : sourceCode.text.slice(member.range[0], member.range[1]));
      const replacement = [...new Set(memberTexts)].join(' | ');

      context.report({
        loc: union.loc,
        messageId: MESSAGE_ID,
        suggest: hasComments
          ? []
          : [{
            fix: (fixer): Rule.Fix => fixer.replaceTextRange(union.range, replacement),
            messageId: SUGGESTION_MESSAGE_ID
          }]
      });
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSCallSignatureDeclaration: check,
      TSDeclareFunction: check,
      TSEmptyBodyFunctionExpression: check,
      TSFunctionType: check,
      TSMethodSignature: check
    };
  },
  meta: {
    docs: {
      description: 'Require `null` rather than `undefined` for the "no value" member of a declared return-type union'
    },
    hasSuggestions: true,
    messages: {
      [MESSAGE_ID]: 'A function that can return "no value" returns `null`, not `undefined`: keep `undefined` for optional members.',
      [SUGGESTION_MESSAGE_ID]: 'Replace `undefined` with `null`.'
    },
    schema: [],
    type: 'suggestion'
  }
};

/**
 * Reads the name of a member key.
 *
 * @param key - The member key.
 * @param isComputed - Whether the key is computed.
 * @returns The name, or `null` when the key is computed.
 */
function getKeyName(key: TSESTree.Node, isComputed: boolean): null | string {
  if (isComputed) {
    return null;
  }
  // A key that is not computed is an identifier, a private identifier or a string or number literal.
  switch (key.type) {
    case AST_NODE_TYPES.Identifier: {
      return key.name;
    }
    case AST_NODE_TYPES.PrivateIdentifier: {
      return `#${key.name}`;
    }
    default: {
      return String((key as TSESTree.Literal).value);
    }
  }
}

/**
 * Finds the union a return type annotation reports, looking through one `Promise` / `PromiseLike`.
 *
 * @param typeNode - The declared return type.
 * @returns The union holding `undefined` and no `void`, or `null` when there is none.
 */
function getReportedUnion(typeNode: TSESTree.TypeNode | undefined): null | TSESTree.TSUnionType {
  let candidate = typeNode;
  if (
    candidate?.type === AST_NODE_TYPES.TSTypeReference && candidate.typeName.type === AST_NODE_TYPES.Identifier
    && PROMISE_TYPE_NAMES.has(candidate.typeName.name)
  ) {
    candidate = candidate.typeArguments?.params[0];
  }

  if (candidate?.type !== AST_NODE_TYPES.TSUnionType) {
    return null;
  }

  const hasUndefined = candidate.types.some((member) => member.type === AST_NODE_TYPES.TSUndefinedKeyword);
  const hasVoid = candidate.types.some((member) => member.type === AST_NODE_TYPES.TSVoidKeyword);
  return hasUndefined && !hasVoid ? candidate : null;
}

/**
 * Checks whether a class or interface declaration inherits a member of the given name from a base it names.
 *
 * @param checker - The type checker.
 * @param declaration - The TypeScript class or interface declaration.
 * @param name - The member name.
 * @returns `true` when a base class, implemented interface or extended interface declares the name.
 */
function hasInheritedMember(checker: TypeChecker, declaration: TsNode, name: string): boolean {
  const heritageClauses = isClassLike(declaration) || isInterfaceDeclaration(declaration) ? declaration.heritageClauses ?? [] : [];
  return heritageClauses.some((clause) => clause.types.some((heritageType) => checker.getTypeAtLocation(heritageType).getProperty(name) !== undefined));
}

/**
 * Checks whether some call signature of a type may return, or resolve to, `undefined` or `void`.
 *
 * @param checker - The type checker.
 * @param type - The contextual type of a function expression.
 * @returns `true` when some call signature of the type may return `undefined` or `void`.
 */
function hasUndefinedReturningSignature(checker: TypeChecker, type: Type): boolean {
  return type.getCallSignatures().some((signature) => {
    const returnType = checker.getReturnTypeOfSignature(signature);
    const symbolName = returnType.getSymbol()?.name ?? '';
    // `Promise<T>` and `PromiseLike<T>` are type references, so their first type argument is what they resolve to.
    const promisedTypes = PROMISE_TYPE_NAMES.has(symbolName) ? checker.getTypeArguments(returnType as TypeReference).slice(0, 1) : [];
    return [returnType, ...promisedTypes].some((candidate) => {
      const members = candidate.isUnion() ? candidate.types : [candidate];
      // eslint-disable-next-line no-bitwise -- Bitwise flag check is idiomatic for TypeScript compiler API.
      return members.some((member) => (member.flags & UNDEFINED_OR_VOID_FLAGS) !== 0);
    });
  });
}

/**
 * Checks whether a node's return type is dictated by a signature it implements.
 *
 * @param node - The function-like node.
 * @param services - The parser services.
 * @param checker - The type checker.
 * @returns `true` when the signature belongs to someone else, or is reported where it is declared.
 */
function isDictated(node: FunctionLikeNode, services: ParserServicesWithTypeInformation, checker: TypeChecker): boolean {
  const parent = node.parent;

  if (node.type === AST_NODE_TYPES.TSFunctionType) {
    // `readonly f: () => T | undefined` - the member is the property signature holding the function type.
    return parent.type === AST_NODE_TYPES.TSTypeParameterInstantiation
      || (parent.type === AST_NODE_TYPES.TSTypeAnnotation && isInheritedMember(parent.parent, services, checker));
  }

  if (MEMBER_NODE_TYPES.has(parent.type)) {
    return isInheritedMember(parent, services, checker);
  }

  if (node.type !== AST_NODE_TYPES.ArrowFunctionExpression && node.type !== AST_NODE_TYPES.FunctionExpression) {
    return isInheritedMember(node, services, checker);
  }

  if (parent.type === AST_NODE_TYPES.Property && parent.parent.type === AST_NODE_TYPES.ObjectExpression) {
    const name = getKeyName(parent.key, parent.computed);
    const objectType = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(parent.parent));
    return name === null || objectType?.getProperty(name) !== undefined;
  }

  // Not a class, interface or object-literal member here, so the mapped node is an arrow function or a function expression.
  const contextualType = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(node) as Expression);
  return contextualType !== undefined && hasUndefinedReturningSignature(checker, contextualType);
}

/**
 * Checks whether a node sits inside `declare module '...'` or `declare global`.
 *
 * @param node - The node.
 * @returns `true` when an enclosing module declaration describes another package's shape.
 */
function isInAmbientModule(node: TSESTree.Node): boolean {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === AST_NODE_TYPES.TSModuleDeclaration && (ancestor.id.type === AST_NODE_TYPES.Literal || ancestor.kind === 'global')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a class or interface member overrides, implements or redeclares an inherited one.
 *
 * @param node - The member node, or any other node, which is never inherited.
 * @param services - The parser services.
 * @param checker - The type checker.
 * @returns `true` when the member's signature comes from a base, or its key is computed.
 */
function isInheritedMember(node: TSESTree.Node, services: ParserServicesWithTypeInformation, checker: TypeChecker): boolean {
  if (!MEMBER_NODE_TYPES.has(node.type)) {
    return false;
  }

  type MemberNode =
    | TSESTree.MethodDefinition
    | TSESTree.PropertyDefinition
    | TSESTree.TSAbstractMethodDefinition
    | TSESTree.TSAbstractPropertyDefinition
    | TSESTree.TSMethodSignature
    | TSESTree.TSPropertySignature;

  const member = node as MemberNode;
  if ('override' in member && member.override) {
    return true;
  }
  const name = getKeyName(member.key, member.computed);
  return name === null || hasInheritedMember(checker, services.esTreeNodeToTSNodeMap.get(member.parent.parent), name);
}
