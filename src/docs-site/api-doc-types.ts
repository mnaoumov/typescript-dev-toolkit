/**
 * @file
 *
 * Shared data-model types for the API documentation generator.
 */

/**
 * A fenced code block of a markdown text, with the language its fence names (empty when none).
 */
export interface CodeSegment {
  lang: string;
  text: string;
  type: 'code';
}

/**
 * A documented enum member.
 */
export interface EnumMemberInfo {
  description: string;
  name: string;
  value: string;
}

/**
 * A run of a markdown text: prose, or a fenced code block.
 */
export type MarkdownSegment = CodeSegment | ProseSegment;

/**
 * A documented property, method, constructor or function signature.
 */
export interface MemberInfo {
  description: string;
  examples: string[];
  inheritedFrom: string;
  isStatic: boolean;
  name: string;
  overloadKey: string;
  parameters: ParameterInfo[];
  remarks: string;
  returnDescription: string;
  returnType: string;
  signature: string;
  since: string;
  type: string;
}

/**
 * A generated page's content and the path it is written to.
 */
export interface PageContent {
  content: string;
  filePath: string;
}

/**
Frontmatter shared by every generated page. `description` and `signature` are optional because not
every page has them, but a page that HAS one must emit it: both feed the page's OG card.
 */
export interface PageFrontMatter {
  description?: string | undefined;
  sidebarLabel: string;
  signature?: string | undefined;
  slug: string;
  title: string;
}

/**
 * A documented parameter.
 */
export interface ParameterInfo {
  description: string;
  name: string;
  type: string;
}

/**
 * A run of markdown prose between code blocks.
 */
export interface ProseSegment {
  text: string;
  type: 'prose';
}

/**
 * The part of a ts-morph method or function the declared return type is read from.
 */
export interface ReturnTypeProvider {
  getReturnType: () => TextProvider;
  getReturnTypeNode?: () => TextProvider | undefined;
}

/**
 * A collapsible Starlight sidebar group.
 */
export interface SidebarEntry {
  collapsed: boolean;
  items: (SidebarEntry | SidebarLink)[];
  label: string;
}

/**
 * A Starlight sidebar link.
 */
export interface SidebarLink {
  label: string;
  link: string;
}

/**
Recursive tree node for building the sidebar
 */
export interface SidebarTreeNode {
  children: Map<string, SidebarTreeNode>;
  types: TypeInfo[];
}

/**
 * A ts-morph node or type whose text can be printed.
 */
export interface TextProvider {
  getText: () => string;
}

/**
 * A documented export: a class, interface, enum, type alias, function or variable.
 */
export interface TypeInfo {
  baseTypes: string[];
  /**
  For classes: the constructor (public/protected), if any
   */
  constructorInfo?: MemberInfo | undefined;
  description: string;
  /**
  For enums: the enum members
   */
  enumMembers: EnumMemberInfo[];
  examples: string[];
  /**
  For classes: types in the `implements` clause
   */
  implementsTypes: string[];
  kind: 'class' | 'enum' | 'function' | 'interface' | 'type' | 'variable';
  methods: MemberInfo[];
  name: string;
  namespace: string;
  properties: MemberInfo[];
  remarks: string;
  /**
  For type aliases: the right-hand-side type text
   */
  typeAliasText?: string;
  typeParameters: string[];
  /**
  For variables: the declaration keyword (let/const/var)
   */
  variableKeyword?: string;
  /**
  For variables: the type annotation
   */
  variableType?: string;
}

/**
 * An object entry of the `typedoc-plugin-mdn-links` Web API data.
 */
export interface WebApiEntry {
  url: string;
}
