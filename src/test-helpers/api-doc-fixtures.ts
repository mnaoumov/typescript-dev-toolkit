/**
 * @file
 *
 * Fixtures for the API documentation generator's tests.
 */

import type { ApiDocSettings } from '../docs-site/api-doc-settings.ts';
import type {
  MemberInfo,
  TypeInfo
} from '../docs-site/api-doc-types.ts';

import { configureApiDocs } from '../docs-site/api-doc-settings.ts';

/**
 * Configures the generator with test settings for the `typescript-lib` site.
 *
 * @param overrides - The settings to change.
 * @returns The settings configured.
 */
export function configureTestApiDocs(overrides: Partial<ApiDocSettings> = {}): ApiDocSettings {
  const settings: ApiDocSettings = {
    basePath: '/typescript-lib',
    externalTypeLinks: new Map(),
    outputDirectory: '/out/api',
    packageName: '@mnaoumov/typescript-lib',
    packageSites: new Map([['@mnaoumov/obsidian-lib', 'https://mnaoumov.dev/obsidian-lib/']]),
    sidebarFile: '/out/sidebar.json',
    ...overrides
  };
  configureApiDocs(settings);
  return settings;
}

/**
 * Creates a member model with empty defaults.
 *
 * @param overrides - The fields to set.
 * @returns The member.
 */
export function createMemberInfo(overrides: Partial<MemberInfo> = {}): MemberInfo {
  return {
    description: '',
    examples: [],
    inheritedFrom: '',
    isStatic: false,
    name: 'alpha',
    overloadKey: 'alpha',
    parameters: [],
    remarks: '',
    returnDescription: '',
    returnType: '',
    signature: 'alpha()',
    since: '',
    type: '',
    ...overrides
  };
}

/**
 * Creates a type model with empty defaults: a class named `alpha` in the `alpha` namespace.
 *
 * @param overrides - The fields to set.
 * @returns The type.
 */
export function createTypeInfo(overrides: Partial<TypeInfo> = {}): TypeInfo {
  return {
    baseTypes: [],
    description: '',
    enumMembers: [],
    examples: [],
    implementsTypes: [],
    kind: 'class',
    methods: [],
    name: 'alpha',
    namespace: 'alpha',
    properties: [],
    remarks: '',
    typeParameters: [],
    ...overrides
  };
}

/**
 * Keys type models by their qualified id, as the generator does.
 *
 * @param types - The types.
 * @returns The map.
 */
export function createTypes(types: TypeInfo[]): Map<string, TypeInfo> {
  return new Map(types.map((typeInfo) => [`${typeInfo.namespace}#${typeInfo.name}`, typeInfo]));
}
