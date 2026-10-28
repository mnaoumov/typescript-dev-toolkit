/**
 * @file
 *
 * Helpers for a rule fix that calls an imported function: reuse a visible import of it, or add one under a name
 * nothing in the file uses yet.
 */
import type { TSESTree } from '@typescript-eslint/utils';
import type {
  Rule,
  Scope,
  SourceCode
} from 'eslint';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { toTSESTreeNode } from './ts-estree-node.ts';

/**
 * Parameters of {@link findVisibleImportName}.
 */
export interface FindVisibleImportNameParams {
  /**
   * The name the module exports the binding under; `default` for its default export.
   */
  readonly importedName: string;

  /**
   * The module specifier the import must name.
   */
  readonly moduleName: string;

  /**
   * The node the fix replaces; the import must be visible from its scope.
   */
  readonly node: Rule.Node;

  /**
   * The source code of the linted file.
   */
  readonly sourceCode: SourceCode;
}

/**
 * Finds the local name of a value import of a binding that is visible from a node and not shadowed there.
 *
 * @param params - The {@link FindVisibleImportNameParams}.
 * @returns The local name, or `null` when no such import is visible.
 */
export function findVisibleImportName(params: FindVisibleImportNameParams): null | string {
  const { importedName, moduleName, node, sourceCode } = params;
  const seen = new Set<string>();
  for (let scope: null | Scope.Scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    for (const variable of scope.variables) {
      if (seen.has(variable.name)) {
        continue;
      }
      seen.add(variable.name);
      for (const definition of variable.defs) {
        if (definition.type !== 'ImportBinding') {
          continue;
        }
        const specifier = toTSESTreeNode(definition.node);
        const declaration = toTSESTreeNode(definition.parent) as TSESTree.ImportDeclaration;
        if (declaration.importKind === 'type' || declaration.source.value !== moduleName) {
          continue;
        }
        if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier ? importedName === 'default' : isNamedValueSpecifier(specifier, importedName)) {
          return variable.name;
        }
      }
    }
  }
  return null;
}

/**
 * Picks a name no token of the file uses, so a new import never captures an existing declaration or free read.
 *
 * @param sourceCode - The source code of the linted file.
 * @param preferredName - The name to use when it is free; otherwise it is suffixed with a number.
 * @returns The free name.
 */
export function getUnusedName(sourceCode: SourceCode, preferredName: string): string {
  const names = new Set(sourceCode.getTokens(sourceCode.ast).map((token) => token.value));
  let name = preferredName;
  let suffix = 0;
  while (names.has(name)) {
    name = `${preferredName}${String(++suffix)}`;
  }
  return name;
}

/**
 * Inserts an import declaration before the first statement of the program, after any directive prologue.
 *
 * The program must hold a statement that is not a directive; the node a rule reports guarantees one.
 *
 * @param fixer - The rule fixer.
 * @param sourceCode - The source code of the linted file.
 * @param importDeclaration - The import declaration, without a trailing newline.
 * @returns The fix inserting it.
 */
export function insertImport(fixer: Rule.RuleFixer, sourceCode: SourceCode, importDeclaration: string): Rule.Fix {
  const firstStatement = ensureNonNullable(sourceCode.ast.body.find((statement) => !('directive' in statement && typeof statement.directive === 'string')));
  return fixer.insertTextBefore(ensureNonNullable(sourceCode.getFirstToken(firstStatement)), `${importDeclaration}\n`);
}

function isNamedValueSpecifier(specifier: TSESTree.Node, importedName: string): boolean {
  return specifier.type === AST_NODE_TYPES.ImportSpecifier
    && specifier.importKind !== 'type'
    && specifier.imported.type === AST_NODE_TYPES.Identifier && specifier.imported.name === importedName;
}
