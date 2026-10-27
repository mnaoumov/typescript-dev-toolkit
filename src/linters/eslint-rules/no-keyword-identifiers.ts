/**
 * @file
 *
 * Reject bare keyword and colliding global names in declared bindings.
 */
import type { Rule } from 'eslint';

import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';

const RESTRICTED_NAMES = new Set([
  'arguments',
  'bigint',
  'boolean',
  'event',
  'function',
  'module',
  'number',
  'object',
  'string',
  'symbol',
  'undefined'
]);

/**
 * Disallows bare keyword names, with conservative, scope-aware rename suggestions for local bindings.
 */
export const noKeywordIdentifiers: Rule.RuleModule = {
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      'Program:exit'(): void {
        const scopes = sourceCode.scopeManager.scopes;
        const reported = new Set<unknown>();
        for (const scope of scopes) {
          for (const variable of scope.variables) {
            if (!RESTRICTED_NAMES.has(variable.name)) {
              continue;
            }
            const replacement = `$${variable.name}`;
            const nodes = [...new Set([...variable.identifiers, ...variable.references.map((reference) => reference.identifier)])];
            const canRename = variable.defs.every((definition) => definition.type !== 'ClassName')
              && scopes.every((candidate) =>
                candidate.variables.every((binding) => binding.name !== replacement)
                && candidate.through.every((reference) => reference.identifier.name !== replacement)
              )
              && nodes.every((node) =>
                sourceCode.getAncestors(node).every((ancestor) =>
                  ![
                    'ExportDefaultDeclaration',
                    'ExportNamedDeclaration',
                    'ExportSpecifier',
                    'ImportSpecifier',
                    'Property',
                    'TSParameterProperty'
                  ].includes(ancestor.type)
                )
              );
            for (const identifier of variable.identifiers) {
              if (reported.has(identifier)) {
                continue;
              }
              reported.add(identifier);
              context.report({
                data: { name: variable.name, replacement },
                messageId: 'restricted',
                node: identifier,
                suggest: canRename
                  ? [{
                    data: { replacement },
                    fix: (fixer): Rule.Fix[] =>
                      nodes.map((node) => {
                        const token = sourceCode.getFirstToken(node);
                        assertNonNullable(token, 'A binding identifier always has a token');
                        return fixer.replaceText(token, replacement);
                      }),
                    messageId: 'rename'
                  }]
                  : []
              });
            }
          }
        }
      }
    };
  },
  meta: {
    docs: { description: 'Require a $ prefix on bare keyword and colliding global binding names' },
    hasSuggestions: true,
    messages: {
      rename: 'Rename this binding and its references to "{{ replacement }}".',
      restricted: 'Rename "{{ name }}" to "{{ replacement }}". Preserve any public contract when renaming.'
    },
    schema: [],
    type: 'suggestion'
  }
};
