/**
 * @file
 *
 * Shared data-model types for the API documentation generator.
 */

/**
 * A fenced code block of a markdown text, with the language its fence names (empty when none).
 */
export interface CodeSegment {
  readonly lang: string;
  readonly text: string;
  readonly type: 'code';
}

/**
 * A documented enum member.
 */
export interface EnumMemberInfo {
  readonly description: string;
  readonly name: string;
  readonly value: string;
}

/**
 * A run of a markdown text: prose, or a fenced code block.
 */
export type MarkdownSegment = CodeSegment | ProseSegment;

/**
 * A documented property, method, constructor or function signature.
 */
export interface MemberInfo {
  readonly description: string;
  readonly examples: string[];
  readonly inheritedFrom: string;
  readonly isStatic: boolean;
  readonly name: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Overload grouping assigns this key after collecting signatures.
  overloadKey: string;
  readonly parameters: ParameterInfo[];
  readonly remarks: string;
  readonly returnDescription: string;
  readonly returnType: string;
  readonly signature: string;
  readonly since: string;
  readonly type: string;
}

/**
 * A generated page's content and the path it is written to.
 */
export interface PageContent {
  readonly content: string;
  readonly filePath: string;
}

/**
Frontmatter shared by every generated page. `description` and `signature` are optional because not
every page has them, but a page that HAS one must emit it: both feed the page's OG card.
 */
export interface PageFrontMatter {
  readonly description?: string | undefined;
  readonly sidebarLabel: string;
  readonly signature?: string | undefined;
  readonly slug: string;
  readonly title: string;
}

/**
 * A documented parameter.
 */
export interface ParameterInfo {
  readonly description: string;
  readonly name: string;
  readonly type: string;
}

/**
 * A run of markdown prose between code blocks.
 */
export interface ProseSegment {
  readonly text: string;
  readonly type: 'prose';
}

/**
 * The part of a ts-morph method or function the declared return type is read from.
 */
export interface ReturnTypeProvider {
  readonly getReturnType: () => TextProvider;
  readonly getReturnTypeNode?: () => TextProvider | undefined;
}

/**
 * A collapsible Starlight sidebar group.
 */
export interface SidebarEntry {
  readonly collapsed: boolean;
  readonly items: (SidebarEntry | SidebarLink)[];
  readonly label: string;
}

/**
 * A Starlight sidebar link.
 */
export interface SidebarLink {
  readonly label: string;
  readonly link: string;
}

/**
Recursive tree node for building the sidebar
 */
export interface SidebarTreeNode {
  readonly children: Map<string, SidebarTreeNode>;
  readonly types: TypeInfo[];
}

/**
 * A ts-morph node or type whose text can be printed.
 */
export interface TextProvider {
  readonly getText: () => string;
}

/**
 * A documented export: a class, interface, enum, type alias, function or variable.
 */
export interface TypeInfo {
  readonly baseTypes: string[];
  /**
  For classes: the constructor (public/protected), if any
   */
  readonly constructorInfo?: MemberInfo | undefined;
  readonly description: string;
  /**
  For enums: the enum members
   */
  readonly enumMembers: EnumMemberInfo[];
  readonly examples: string[];
  /**
  For classes: types in the `implements` clause
   */
  readonly implementsTypes: string[];
  readonly kind: 'class' | 'enum' | 'function' | 'interface' | 'type' | 'variable';
  readonly methods: MemberInfo[];
  readonly name: string;
  readonly namespace: string;
  readonly properties: MemberInfo[];
  readonly remarks: string;
  /**
  For type aliases: the right-hand-side type text
   */
  readonly typeAliasText?: string;
  readonly typeParameters: string[];
  /**
  For variables: the declaration keyword (let/const/var)
   */
  readonly variableKeyword?: string;
  /**
  For variables: the type annotation
   */
  readonly variableType?: string;
}

/**
 * An object entry of the `typedoc-plugin-mdn-links` Web API data.
 */
export interface WebApiEntry {
  readonly url: string;
}
