/**
 * @file
 *
 * JSDoc/declaration extraction: turns ts-morph declarations into the generator's `TypeInfo`/`MemberInfo`.
 */

import type {
  ClassDeclaration,
  ConstructorDeclaration,
  EnumDeclaration,
  InterfaceDeclaration,
  JSDocableNode,
  MethodDeclaration,
  MethodSignature,
  PropertyDeclaration,
  PropertySignature,
  SourceFile,
  TypeAliasDeclaration
} from 'ts-morph';

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import { Scope } from 'ts-morph';

import type {
  EnumMemberInfo,
  MemberInfo,
  ReturnTypeProvider,
  TypeInfo
} from './api-doc-types.ts';

import {
  computeOverloadKey,
  foldTsDocParagraphs,
  replaceRegExpMatches,
  simplifyType
} from './api-doc-text-utils.ts';

/**
 * Extracts a class's model: its constructor, non-private properties and methods, and documentation.
 *
 * @param cls - The class declaration.
 * @param namespace - The type's namespace.
 * @returns The class's model.
 */
export function extractClassInfo(cls: ClassDeclaration, namespace: string): TypeInfo {
  const name = cls.getNameOrThrow();
  const constructor = cls.getConstructors().find((c) => c.getScope() !== Scope.Private);
  const extendsClause = cls.getExtends();
  return {
    baseTypes: extendsClause ? [extendsClause.getText()] : [],
    constructorInfo: constructor ? extractConstructorInfo(constructor) : undefined,
    description: getDescription(cls),
    enumMembers: [],
    examples: getExamples(cls),
    implementsTypes: cls.getImplements().map((index) => index.getText()),
    kind: 'class',
    methods: cls.getMethods().filter((m) => m.getScope() !== Scope.Private).map((m) => extractMethodInfo(m)),
    name,
    namespace,
    properties: cls.getProperties().filter((p) => p.getScope() !== Scope.Private).map((p) => extractPropertyInfo(p)),
    remarks: getRemarks(cls),
    typeParameters: cls.getTypeParameters().map((tp) => tp.getText())
  };
}

/**
 * Extracts a constructor's model.
 *
 * @param ctor - The constructor declaration.
 * @returns The constructor's model.
 */
export function extractConstructorInfo(ctor: ConstructorDeclaration): MemberInfo {
  const parameterDescriptions = getParameterDescriptions(ctor);
  const params = ctor.getParameters().map((p) => {
    const isOptional = p.isOptional();
    const optionalSuffix = isOptional ? '?' : '';
    return {
      description: parameterDescriptions.get(p.getName()) ?? (isOptional ? '*(Optional)*' : ''),
      name: `${p.getName()}${optionalSuffix}`,
      type: simplifyType(p.getType().getText())
    };
  });
  const parameterString = params.map((p) => `${p.name}: ${p.type}`).join(', ');
  return {
    description: getDescription(ctor),
    examples: getExamples(ctor),
    inheritedFrom: '',
    isStatic: false,
    name: 'constructor',
    overloadKey: 'constructor',
    parameters: params,
    remarks: getRemarks(ctor),
    returnDescription: '',
    returnType: '',
    signature: `(${parameterString})`,
    since: getSince(ctor),
    type: ''
  };
}

/**
 * Extracts an enum's model.
 *
 * @param enumDeclaration - The enum declaration.
 * @param namespace - The type's namespace.
 * @returns The enum's model.
 */
export function extractEnumInfo(enumDeclaration: EnumDeclaration, namespace: string): TypeInfo {
  const members: EnumMemberInfo[] = enumDeclaration.getMembers().map((m) => {
    const initializer = m.getInitializer()?.getText() ?? '';
    return {
      description: getDescription(m),
      name: m.getName(),
      value: initializer
    };
  });
  return {
    baseTypes: [],
    description: getDescription(enumDeclaration),
    enumMembers: members,
    examples: getExamples(enumDeclaration),
    implementsTypes: [],
    kind: 'enum',
    methods: [],
    name: enumDeclaration.getName(),
    namespace,
    properties: [],
    remarks: getRemarks(enumDeclaration),
    typeParameters: []
  };
}

/**
 * Extract the module-level `@file` description text, if any.
 *
 * @param src - The source file.
 * @returns The overview, or an empty string when the file has no `@file` block.
 */
export function extractFileOverview(src: SourceFile): string {
  const text = src.getFullText();
  const blockMatch = /\/\*\*(?<body>[\s\S]*?)\*\//.exec(text);
  if (!blockMatch) {
    return '';
  }
  const body = getMandatoryNamedGroup(blockMatch, 'body');
  if (!/@file\b/.test(body)) {
    return '';
  }
  const stripped = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, ''))
    .join('\n');
  const afterFileTag = stripped.replace(/[\s\S]*?@file[ \t]*\r?\n?/, '');
  return foldTsDocParagraphs(afterFileTag.trim());
}

/**
 * Extracts an interface's model.
 *
 * @param iface - The interface declaration.
 * @param namespace - The type's namespace.
 * @returns The interface's model.
 */
export function extractInterfaceInfo(iface: InterfaceDeclaration, namespace: string): TypeInfo {
  return {
    baseTypes: iface.getExtends().map((error) => error.getText()),
    description: getDescription(iface),
    enumMembers: [],
    examples: getExamples(iface),
    implementsTypes: [],
    kind: 'interface',
    methods: iface.getMethods().map((m) => extractMethodSignatureInfo(m)),
    name: iface.getName(),
    namespace,
    properties: iface.getProperties().map((p) => extractPropertySignatureInfo(p)),
    remarks: getRemarks(iface),
    typeParameters: iface.getTypeParameters().map((tp) => tp.getText())
  };
}

/**
 * Extracts a class method's model.
 *
 * @param method - The method.
 * @returns The method's model.
 */
export function extractMethodInfo(method: MethodDeclaration): MemberInfo {
  const name = method.getName();
  const parameterDescriptions = getParameterDescriptions(method);
  const params = method.getParameters().map((p) => {
    const isOptional = p.isOptional();
    const optionalSuffix = isOptional ? '?' : '';
    return {
      description: parameterDescriptions.get(p.getName()) ?? (isOptional ? '*(Optional)*' : ''),
      name: `${p.getName()}${optionalSuffix}`,
      type: simplifyType(p.getType().getText())
    };
  });
  const parameterString = params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const info: MemberInfo = {
    description: getDescription(method),
    examples: getExamples(method),
    inheritedFrom: '',
    isStatic: method.isStatic(),
    name,
    overloadKey: '',
    parameters: params,
    remarks: getRemarks(method),
    returnDescription: getReturnDescription(method),
    returnType: getDeclaredReturnType(method),
    signature: `${name}(${parameterString})`,
    since: getSince(method),
    type: ''
  };
  info.overloadKey = computeOverloadKey(info);
  return info;
}

/**
 * Extracts an interface method's model.
 *
 * @param method - The method.
 * @returns The method's model.
 */
export function extractMethodSignatureInfo(method: MethodSignature): MemberInfo {
  const name = method.getName();
  const parameterDescriptions = getParameterDescriptions(method);
  const params = method.getParameters().map((p) => {
    const isOptional = p.isOptional();
    const optionalSuffix = isOptional ? '?' : '';
    return {
      description: parameterDescriptions.get(p.getName()) ?? (isOptional ? '*(Optional)*' : ''),
      name: `${p.getName()}${optionalSuffix}`,
      type: simplifyType(p.getType().getText())
    };
  });
  const parameterString = params.map((p) => `${p.name}: ${p.type}`).join(', ');
  const info: MemberInfo = {
    description: getDescription(method),
    examples: getExamples(method),
    inheritedFrom: '',
    isStatic: false,
    name,
    overloadKey: '',
    parameters: params,
    remarks: getRemarks(method),
    returnDescription: getReturnDescription(method),
    returnType: getDeclaredReturnType(method),
    signature: `${name}(${parameterString})`,
    since: getSince(method),
    type: ''
  };
  info.overloadKey = computeOverloadKey(info);
  return info;
}

/**
 * Extracts a class property's model.
 *
 * @param property - The property.
 * @returns The property's model.
 */
export function extractPropertyInfo(property: PropertyDeclaration): MemberInfo {
  const name = property.getName();
  const isOptional = property.hasQuestionToken();
  const optionalSuffix = isOptional ? '?' : '';
  return {
    description: getDescription(property),
    examples: getExamples(property),
    inheritedFrom: '',
    isStatic: property.isStatic(),
    name: `${name}${optionalSuffix}`,
    overloadKey: '',
    parameters: [],
    remarks: getRemarks(property),
    returnDescription: '',
    returnType: '',
    signature: `${name}${optionalSuffix}`,
    since: getSince(property),
    type: getPropertyType(property)
  };
}

/**
 * Extracts an interface property's model.
 *
 * @param property - The property.
 * @returns The property's model.
 */
export function extractPropertySignatureInfo(property: PropertySignature): MemberInfo {
  const name = property.getName();
  const isOptional = property.hasQuestionToken();
  const optionalSuffix = isOptional ? '?' : '';
  return {
    description: getDescription(property),
    examples: getExamples(property),
    inheritedFrom: '',
    isStatic: false,
    name: `${name}${optionalSuffix}`,
    overloadKey: '',
    parameters: [],
    remarks: getRemarks(property),
    returnDescription: '',
    returnType: '',
    signature: `${name}${optionalSuffix}`,
    since: getSince(property),
    type: getPropertyType(property)
  };
}

/**
 * Extracts a type alias's model.
 *
 * @param alias - The type alias declaration.
 * @param namespace - The type's namespace.
 * @returns The type alias's model.
 */
export function extractTypeAliasInfo(alias: TypeAliasDeclaration, namespace: string): TypeInfo {
  return {
    baseTypes: [],
    description: getDescription(alias),
    enumMembers: [],
    examples: getExamples(alias),
    implementsTypes: [],
    kind: 'type',
    methods: [],
    name: alias.getName(),
    namespace,
    properties: [],
    remarks: getRemarks(alias),
    typeAliasText: simplifyType(alias.getTypeNodeOrThrow().getText()),
    typeParameters: alias.getTypeParameters().map((tp) => tp.getText())
  };
}

/**
 * Get the return type as declared in source (preserves union order), falling back to resolved type
 *
 * @param method - The method or function.
 * @returns The return type.
 */
export function getDeclaredReturnType(method: ReturnTypeProvider): string {
  const annotation = method.getReturnTypeNode?.()?.getText();
  return simplifyType(annotation ?? method.getReturnType().getText());
}

/**
 * Extracts the JSDoc description of a node.
 *
 * @param node - The node.
 * @returns The description, or an empty string.
 */
export function getDescription(node: JSDocableNode): string {
  const lastDoc = node.getJsDocs().at(-1);
  return lastDoc ? foldTsDocParagraphs(lastDoc.getDescription().trim()) : '';
}

/**
 * Extract
 *
 * @param node - The node.
 * @returns The examples' texts.
 * @example blocks from JSDoc
 */
export function getExamples(node: JSDocableNode): string[] {
  const examples: string[] = [];
  for (const doc of node.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'example') {
        continue;
      }

      const text = tag.getCommentText()?.trim() ?? '';
      if (text) {
        examples.push(text);
      }
    }
  }
  return examples;
}

/**
 * Extract
 *
 * @param node - The node.
 * @returns Each parameter's name mapped to its description.
 */
export function getParameterDescriptions(node: JSDocableNode): Map<string, string> {
  const result = new Map<string, string>();
  const docs = node.getJsDocs();
  for (const doc of docs) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'param') {
        continue;
      }

      const comment = foldTsDocParagraphs(tag.getCommentText()?.trim().replaceAll(/\s*\*\s*$/g, '').replace(/^-\s*/, '').trim() ?? '');
      const tagText = tag.getText();
      const nameMatch = /@param\s+(?:\{[^}]*\}\s+)?(?<paramName>\w+)/.exec(tagText);
      if (nameMatch) {
        result.set(getMandatoryNamedGroup(nameMatch, 'paramName'), comment);
      }
    }
  }
  return result;
}

/**
 * Strip `| undefined` only when it was implicitly added by ts-morph for optional properties
 *
 * @param property - The property.
 * @returns The type text.
 */
export function getPropertyType(property: PropertyDeclaration | PropertySignature): string {
  const typeNode = property.getTypeNode();
  return typeNode ? resolveTypeofAliases(simplifyType(typeNode.getText()), property.getSourceFile()) : simplifyType(property.getType().getText());
}

/**
 * Extract
 *
 * @param node - The node.
 * @returns The remarks, or an empty string.
 * @remarks text from JSDoc
 */
export function getRemarks(node: JSDocableNode): string {
  for (const doc of node.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === 'remarks' || tag.getTagName() === 'remark') {
        return foldTsDocParagraphs(tag.getCommentText()?.trim().replaceAll(/\s*\*\s*$/g, '').trim() ?? '');
      }
    }
  }
  return '';
}

/**
 * Extract
 *
 * @param node - The node.
 * @returns description from JSDoc
 */
export function getReturnDescription(node: JSDocableNode): string {
  for (const doc of node.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === 'returns') {
        return foldTsDocParagraphs(tag.getCommentText()?.trim().replace(/^-\s*/, '').replaceAll(/\s*\*\s*$/g, '').trim() ?? '');
      }
    }
  }
  return '';
}

/**
 * Extract the version a JSDoc `since` tag names.
 *
 * @param node - The node.
 * @returns The version, or an empty string.
 */
export function getSince(node: JSDocableNode): string {
  for (const doc of node.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === 'since') {
        return tag.getCommentText()?.trim().replaceAll(/\s*\*\s*$/g, '').trim() ?? '';
      }
    }
  }
  return '';
}

/**
 * Resolve `typeof aliasName` patterns where aliasName is an import alias.
 * E.g., `typeof momentInstance` → `typeof moment` when `import { moment as momentInstance }`.
 *
 * @param typeText - The type text.
 * @param sourceFile - The source file holding the imports.
 * @returns The type text with the original names.
 */
export function resolveTypeofAliases(typeText: string, sourceFile: SourceFile): string {
  return replaceRegExpMatches(typeText, /\btypeof (?<alias>[a-zA-Z][a-zA-Z0-9]*)\b/g, (match) => {
    const alias = getMandatoryNamedGroup(match, 'alias');
    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      for (const namedImport of importDeclaration.getNamedImports()) {
        if (namedImport.getAliasNode()?.getText() === alias) {
          return `typeof ${namedImport.getName()}`;
        }
      }
    }
    return match[0];
  });
}
