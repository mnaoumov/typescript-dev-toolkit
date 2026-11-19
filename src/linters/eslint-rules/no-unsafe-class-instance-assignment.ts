/**
 * @file
 *
 * typescript-eslint's `no-unsafe-class-instance-assignment`, run with a type checker that sees through a mixin base.
 *
 * The upstream rule decides whether a value is an instance of a class by walking the value's base types. For a class
 * whose base is a mixin call (`class A extends mixin(Base)`), `getBaseTypes` returns ONE intersection type, which the
 * walk never enters, so every `this` and every subclass instance of such a class is reported as "not created by its
 * constructor" (typescript-eslint/typescript-eslint#13214). This wrapper hands the upstream rule a checker whose
 * `getBaseTypes` returns the constituents of such an intersection instead, and changes nothing else.
 */

import type { ParserServicesWithTypeInformation } from '@typescript-eslint/utils';
import type {
  ESLint,
  Rule
} from 'eslint';
import type {
  BaseType,
  InterfaceType,
  Program,
  TypeChecker
} from 'typescript';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { plugin } from 'typescript-eslint';

// The package types its plugin without rules, as a shape every ESLint major accepts.
const upstreamRule = ensureNonNullable((plugin as ESLint.Plugin).rules?.['no-unsafe-class-instance-assignment']) as Rule.RuleModule;

const flattenedCheckers = new WeakMap<TypeChecker, TypeChecker>();

/**
 * Disallows assigning non-instance values to class instance typed locations, walking mixin base classes.
 */
export const noUnsafeClassInstanceAssignment: Rule.RuleModule = {
  create(context) {
    const services = context.sourceCode.parserServices as Partial<ParserServicesWithTypeInformation> | undefined;
    if (!services?.program) {
      // Let the upstream rule report the missing type information in its own words.
      return upstreamRule.create(context);
    }

    const program = wrapProgram(services.program);
    const sourceCode: Rule.RuleContext['sourceCode'] = Object.create(context.sourceCode, {
      parserServices: { value: Object.create(services, { program: { value: program } }) as ParserServicesWithTypeInformation }
    });
    const flattenedContext: Rule.RuleContext = Object.create(context, {
      sourceCode: { value: sourceCode }
    });
    return upstreamRule.create(flattenedContext);
  },
  meta: {
    ...upstreamRule.meta,
    docs: {
      description: 'Disallow assigning non-instance values to class instance typed locations, including classes with a mixin base'
    }
  }
};

// A checker whose `getBaseTypes` replaces an intersection base type (a mixin base) by its constituents.
function getMixinAwareChecker(checker: TypeChecker): TypeChecker {
  const cached = flattenedCheckers.get(checker);
  if (cached) {
    return cached;
  }
  const flattened: TypeChecker = Object.create(checker, {
    getBaseTypes: {
      value(type: InterfaceType): BaseType[] {
        return checker.getBaseTypes(type).flatMap((baseType) => baseType.isIntersection() ? baseType.types as BaseType[] : [baseType]);
      }
    }
  });
  flattenedCheckers.set(checker, flattened);
  return flattened;
}

function wrapProgram(program: Program): Program {
  const wrapped: Program = Object.create(program, {
    getTypeChecker: {
      value(): TypeChecker {
        return getMixinAwareChecker(program.getTypeChecker());
      }
    }
  });
  return wrapped;
}
