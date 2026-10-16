/**
 * @file
 *
 * MDX page + sidebar emission: renders module index pages, per-type overview pages, per-member pages,
 * backlinks, and the Starlight sidebar JSON.
 */

import { getMandatoryNamedGroup } from '@mnaoumov/typescript-lib/reg-exp';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  MemberInfo,
  PageContent,
  PageFrontMatter,
  SidebarEntry,
  SidebarLink,
  SidebarTreeNode,
  TypeInfo
} from './api-doc-types.ts';

import { EVENT_METHODS } from './api-doc-constants.ts';
import {
  linkBaseType,
  markdownToHtml,
  memberHref,
  renderExampleMdx,
  renderMdxProse,
  renderTypeWithLinks,
  resolveLinks,
  toTypeFileSegment,
  toTypeRouteSegment,
  typeLink
} from './api-doc-link-rendering.ts';
import { getApiDocSettings } from './api-doc-settings.ts';
import {
  ensureDirectory,
  escapeJsString,
  escapeJsxAttribute,
  escapeMarkdown,
  escapeMdxAngleBrackets,
  escapeMdxBraces,
  escapeYaml,
  getDisplayName,
  getImportStatement,
  getNamespaceDirectory,
  memberRouteSegment,
  memberSlug,
  overloadRouteSegment,
  overloadSlug,
  stripMarkdown,
  truncateSignature
} from './api-doc-text-utils.ts';
import { API_COMPONENTS_IMPORT_PREFIX } from './docs-site-assets.ts';

const JSON_INDENT = 2;

/**
 * Append backlinks to overview pages and write all files. Keyed by qualified `${namespace}#${name}`.
 *
 * @param pageContents - Every overview page's content and path, keyed by qualified id.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export async function appendBacklinksAndWrite(
  pageContents: Map<string, PageContent>,
  allTypes: Map<string, TypeInfo>
): Promise<void> {
  const backlinks = buildBacklinksFromContent(pageContents, allTypes);

  for (const [key, { content, filePath }] of pageContents) {
    const typeBacklinks = backlinks.get(key) ?? [];
    const lines = [content];
    if (typeBacklinks.length > 0) {
      const sortedBacklinks = [...typeBacklinks].sort((a, b) => a.localeCompare(b));
      lines.push('', '---', '', '**Links to this page:**', '');
      for (const blKey of sortedBacklinks) {
        const blInfo = ensureNonNullable(allTypes.get(blKey));
        const blNsDirectory = getNamespaceDirectory(blInfo.namespace);
        lines.push(`- [${blInfo.name}](${getApiDocSettings().basePath}/api/${blNsDirectory}/${toTypeRouteSegment(blInfo.namespace, blInfo.name)}/)`);
      }
    }
    await writeFile(filePath, lines.join('\n'), 'utf-8');
  }
}

/**
 * Build backlinks by scanning generated page content for internal API links. Keyed by qualified id.
 *
 * @param pageContents - Every overview page's content and path, keyed by qualified id.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 * @returns Each referenced type's qualified id mapped to the ids of the pages linking to it.
 */
export function buildBacklinksFromContent(
  pageContents: Map<string, PageContent>,
  allTypes: Map<string, TypeInfo>
): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  // Emitted URLs lowercase the type segment (see toRouteSegment), so map each lowercased route
  // identity back to its original qualified type key.
  const routeKeyToTypeKey = new Map<string, string>();
  for (const [typeKey, info] of allTypes) {
    routeKeyToTypeKey.set(`${getNamespaceDirectory(info.namespace)}#${toTypeRouteSegment(info.namespace, info.name)}`, typeKey);
  }
  const escapedBase = getApiDocSettings().basePath.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const linkPattern = new RegExp(`${escapedBase}/api/(?<path>(?:[a-zA-Z0-9_@-]+/)+)`, 'g');
  for (const [sourceKey, { content }] of pageContents) {
    const referenced = new Set<string>();

    for (const match of content.matchAll(linkPattern)) {
      // The pattern requires at least one segment.
      const segments = getMandatoryNamedGroup(match, 'path').split('/').filter(Boolean);
      const typeName = ensureNonNullable(segments.at(-1));
      const namespace = segments.slice(0, -1).join('/');
      const routeKey = `${namespace}#${typeName}`;
      const resolvedKey = routeKeyToTypeKey.get(routeKey);
      if (resolvedKey !== undefined && resolvedKey !== sourceKey) {
        referenced.add(resolvedKey);
      }
    }

    for (const reference of referenced) {
      if (!backlinks.has(reference)) {
        backlinks.set(reference, []);
      }
      backlinks.get(reference)?.push(sourceKey);
    }
  }

  return backlinks;
}

/**
 * Builds the namespace tree the sidebar is generated from.
 *
 * @param types - The documented types, keyed by qualified id.
 * @returns The root of the tree.
 */
export function buildSidebarTree(types: Map<string, TypeInfo>): SidebarTreeNode {
  const root: SidebarTreeNode = { children: new Map(), types: [] };
  for (const [, info] of types) {
    const parts = info.namespace.split('/');
    let node = root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), types: [] };
        node.children.set(part, child);
      }
      node = child;
    }
    node.types.push(info);
  }
  return root;
}

/**
 * The raw code signature shown on a type-overview page's OG card, for the kinds that render a single
 * signature line (function / type alias / variable). Classes, interfaces and enums render member
 * tables instead, so they get no signature block.
 *
 * @param name - The type's name.
 * @param info - The documented type.
 * @returns The signature, or `undefined` for a kind that renders member tables instead.
 */
export function computeOverviewSignature(name: string, info: TypeInfo): string | undefined {
  if (info.kind === 'function') {
    const $function = info.methods[0];
    return $function ? `function ${$function.signature}: ${$function.returnType}` : undefined;
  }
  if (info.kind === 'type') {
    return `type ${getDisplayName(info.name, info)} = ${info.typeAliasText ?? 'unknown'}`;
  }
  return info.kind === 'variable' ? `${info.variableKeyword ?? 'let'} ${name}: ${info.variableType ?? 'unknown'}` : undefined;
}

/**
 * Writes one page per own property and per own method overload key of a class or interface.
 *
 * @param name - The type's name.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export async function generateMemberPages(name: string, info: TypeInfo, allTypes: Map<string, TypeInfo>): Promise<void> {
  const nsDirectory = getNamespaceDirectory(info.namespace);
  const typeFileDirectory = toTypeFileSegment(info.namespace, name);
  const typeRouteDirectory = toTypeRouteSegment(info.namespace, name);
  const componentImports = getComponentImports(['MemberDetail']);

  // Property pages (skip inherited — they live on the parent type)
  const properties = info.properties.filter((p) => !p.inheritedFrom);
  for (const property of properties) {
    const filePath = join(getApiDocSettings().outputDirectory, nsDirectory, typeFileDirectory, `${memberSlug(property.name)}.mdx`);
    await ensureDirectory(filePath);

    const propertyTitle = `${name}.${property.name}`;
    const lines: string[] = renderFrontMatter({
      description: property.description,
      sidebarLabel: propertyTitle,
      signature: `${property.signature}: ${property.type}`,
      slug: `api/${nsDirectory}/${typeRouteDirectory}/${memberRouteSegment(property.name)}`,
      title: propertyTitle
    });
    lines.push(
      ...componentImports,
      '',
      // Breadcrumb
      `[${name}](${getApiDocSettings().basePath}/api/${nsDirectory}/${typeRouteDirectory}/) › ${property.name}`,
      ''
    );

    const staticAttribute = property.isStatic ? ' isStatic={true}' : '';
    const typeAttribute = ` type="${escapeJsxAttribute(markdownToHtml(renderTypeWithLinks(property.type, allTypes, name, info.namespace)))}"`;
    const descAttribute = property.description ? ` description="${escapeJsxAttribute(markdownToHtml(resolveLinks(property.description, allTypes, info.namespace)))}"` : '';
    const remarksAttribute = property.remarks ? ` remarks="${escapeJsxAttribute(markdownToHtml(resolveLinks(property.remarks, allTypes, info.namespace)))}"` : '';
    const sinceAttribute = property.since ? ` since="${escapeJsxAttribute(property.since)}"` : '';
    const examplesAttribute = property.examples.length > 0 ? ` examples={${JSON.stringify(property.examples)}}` : '';

    lines.push(`<MemberDetail${staticAttribute}${typeAttribute}${descAttribute}${remarksAttribute}${sinceAttribute}${examplesAttribute} />`, '');

    await writeFile(filePath, lines.join('\n'), 'utf-8');
  }

  // Method pages — each overload key gets its own page (skip inherited)
  const methods = info.methods.filter((m) => !m.inheritedFrom);
  const overloadGroups = new Map<string, MemberInfo[]>();
  for (const method of methods) {
    const key = method.overloadKey;
    if (!overloadGroups.has(key)) {
      overloadGroups.set(key, []);
    }
    overloadGroups.get(key)?.push(method);
  }

  for (const [overloadKey, overloads] of overloadGroups) {
    const fileSlug = overloadSlug(overloadKey);
    const filePath = join(getApiDocSettings().outputDirectory, nsDirectory, typeFileDirectory, `${fileSlug}.mdx`);
    await ensureDirectory(filePath);

    const displayName = `${name}.${overloadKey} method`;
    // A group is created by its first overload.
    const firstOverload = ensureNonNullable(overloads[0]);

    const lines: string[] = renderFrontMatter({
      description: firstOverload.description,
      sidebarLabel: `${name}.${overloadKey}`,
      signature: `${firstOverload.signature}: ${firstOverload.returnType}`,
      slug: `api/${nsDirectory}/${typeRouteDirectory}/${overloadRouteSegment(overloadKey)}`,
      title: displayName
    });
    lines.push(
      ...componentImports,
      '',
      // Breadcrumb
      `[${name}](${getApiDocSettings().basePath}/api/${nsDirectory}/${typeRouteDirectory}/) › ${overloadKey}`,
      ''
    );

    for (const overload of overloads) {
      renderMethodOverloadMdx(lines, overload, name, info.namespace, allTypes);
      if (overloads.length > 1) {
        lines.push('---', '');
      }
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8');
  }
}

/**
 * Writes each module's index page and the root API index.
 *
 * @param types - The documented types, keyed by qualified id.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 * @param moduleOverviews - Each namespace's `@file` overview.
 */
export async function generateNamespaceIndexPages(
  types: Map<string, TypeInfo>,
  allTypes: Map<string, TypeInfo>,
  moduleOverviews: Map<string, string>
): Promise<void> {
  const namespaces = new Map<string, TypeInfo[]>();
  for (const [, info] of types) {
    if (!namespaces.has(info.namespace)) {
      namespaces.set(info.namespace, []);
    }
    namespaces.get(info.namespace)?.push(info);
  }

  for (const [namespace, nsTypes] of namespaces) {
    const nsDirectory = getNamespaceDirectory(namespace);
    const filePath = join(getApiDocSettings().outputDirectory, nsDirectory, 'index.mdx');
    await ensureDirectory(filePath);

    // The module's `@file` text doubles as its description.
    // Without it the module card was title-only while every member card under it carried one.
    const overview = moduleOverviews.get(namespace);
    const lines: string[] = renderFrontMatter({
      description: overview,
      sidebarLabel: namespace,
      slug: `api/${nsDirectory}`,
      title: namespace
    });

    // Module @file overview text
    if (overview) {
      lines.push(renderMdxProse(overview, allTypes, namespace), '');
    }

    renderNamespaceTable(lines, 'Classes', 'Class', nsTypes.filter((t) => t.kind === 'class'), allTypes, namespace);
    renderNamespaceTable(lines, 'Interfaces', 'Interface', nsTypes.filter((t) => t.kind === 'interface'), allTypes, namespace);
    renderNamespaceTable(lines, 'Functions', 'Function', nsTypes.filter((t) => t.kind === 'function'), allTypes, namespace);
    renderNamespaceTable(lines, 'Types', 'Type', nsTypes.filter((t) => t.kind === 'type'), allTypes, namespace);
    renderNamespaceTable(lines, 'Enums', 'Enum', nsTypes.filter((t) => t.kind === 'enum'), allTypes, namespace);
    renderNamespaceTable(lines, 'Variables', 'Variable', nsTypes.filter((t) => t.kind === 'variable'), allTypes, namespace);

    await writeFile(filePath, lines.join('\n'), 'utf-8');
  }

  // Root API index page listing every module.
  const sortedNamespaces = [...namespaces.keys()].sort((a, b) => a.localeCompare(b));
  const apiIndexIntro = getApiIndexIntro(sortedNamespaces);
  const rootLines: string[] = renderFrontMatter({
    description: apiIndexIntro,
    sidebarLabel: 'Overview',
    slug: 'api',
    title: 'API reference'
  });
  rootLines.push(apiIndexIntro, '', '## Modules', '');
  for (const namespace of sortedNamespaces) {
    rootLines.push(`- [${namespace}](${getApiDocSettings().basePath}/api/${getNamespaceDirectory(namespace)}/)`);
  }
  rootLines.push('');
  const rootFilePath = join(getApiDocSettings().outputDirectory, 'index.mdx');
  await ensureDirectory(rootFilePath);
  await writeFile(rootFilePath, rootLines.join('\n'), 'utf-8');
}

/**
 * Renders a type's overview page.
 *
 * @param name - The type's name.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 * @returns The page's content, before backlinks, and the path it is written to.
 */
export async function generateOverviewPage(name: string, info: TypeInfo, allTypes: Map<string, TypeInfo>): Promise<PageContent> {
  const nsDirectory = getNamespaceDirectory(info.namespace);
  const typeFileSlug = toTypeFileSegment(info.namespace, name);
  const typeRouteSlug = toTypeRouteSegment(info.namespace, name);
  const filePath = join(getApiDocSettings().outputDirectory, nsDirectory, typeFileSlug, 'index.mdx');
  await ensureDirectory(filePath);

  // Frontmatter
  const displayName = getDisplayName(name, info);
  const lines: string[] = renderFrontMatter({
    description: info.description,
    sidebarLabel: displayName,
    signature: computeOverviewSignature(name, info),
    slug: `api/${nsDirectory}/${typeRouteSlug}`,
    title: displayName
  });

  // Component imports — compute relative path from generated page to components
  lines.push(...getComponentImports(['ConstructorBlock', 'ImportStatement', 'MethodTable', 'PropertyTable', 'TypeSignature']), '');

  // Description
  if (info.description) {
    lines.push(renderMdxProse(info.description, allTypes, info.namespace), '');
  }

  // Remarks
  if (info.remarks) {
    const remarksBlock = renderMdxProse(info.remarks, allTypes, info.namespace);
    lines.push(remarksBlock.split('\n').map((line) => (line.length > 0 ? `> ${line}` : '>')).join('\n'), '');
  }

  // Import statement
  lines.push(`<ImportStatement text="${escapeJsxAttribute(getImportStatement(info))}" />`, '');

  // Examples
  for (const example of info.examples) {
    lines.push('**Example:**', '', renderExampleMdx(example, allTypes, info.namespace), '');
  }

  // Functions render like method detail pages — signature, params, returns
  if (info.kind === 'function') {
    renderFunctionPage(lines, info, allTypes);
    return { content: lines.join('\n'), filePath };
  }

  // Variables render with declaration keyword and type
  if (info.kind === 'variable') {
    renderVariablePage(lines, name, info, allTypes);
    return { content: lines.join('\n'), filePath };
  }

  // Enums render their members list
  if (info.kind === 'enum') {
    renderEnumPage(lines, info, allTypes);
    return { content: lines.join('\n'), filePath };
  }

  // Type aliases render their right-hand-side signature
  if (info.kind === 'type') {
    renderTypeAliasPage(lines, info, allTypes);
    return { content: lines.join('\n'), filePath };
  }

  // Classes / interfaces: signature + extends/implements + constructor + member tables
  const typeParamsAttribute = info.typeParameters.length > 0 ? ` typeParams={${JSON.stringify(info.typeParameters)}}` : '';
  const extendsAttribute = info.baseTypes.length > 0 ? ` extends={${JSON.stringify(info.baseTypes)}}` : '';
  const implementsAttribute = info.implementsTypes.length > 0 ? ` implements={${JSON.stringify(info.implementsTypes)}}` : '';
  lines.push(`<TypeSignature kind="${info.kind}" name="${name}"${typeParamsAttribute}${extendsAttribute}${implementsAttribute} />`, '');

  if (info.baseTypes.length > 0) {
    const linkedTypes = info.baseTypes.map((t) => linkBaseType(t, allTypes, info.namespace));
    lines.push(`**Extends:** ${linkedTypes.join(', ')}`, '');
  }

  if (info.implementsTypes.length > 0) {
    const linkedTypes = info.implementsTypes.map((t) => linkBaseType(t, allTypes, info.namespace));
    lines.push(`**Implements:** ${linkedTypes.join(', ')}`, '');
  }

  renderConstructorMdx(lines, name, info, allTypes);
  renderPropertyTableMdx(lines, info, allTypes);
  renderMethodTableMdx(lines, info, allTypes);

  return { content: lines.join('\n'), filePath };
}

/**
 * Writes the Starlight sidebar of the API reference.
 *
 * @param types - The documented types, keyed by qualified id.
 */
export async function generateSidebarJson(types: Map<string, TypeInfo>): Promise<void> {
  const root = buildSidebarTree(types);

  const groups: SidebarEntry[] = [];
  const topLevels = [...root.children].sort(([a], [b]) => a.localeCompare(b));
  for (const [topLevel, child] of topLevels) {
    groups.push(sidebarTreeToEntries(child, topLevel));
  }

  const wrappedSidebar: SidebarEntry[] = [{
    collapsed: false,
    items: groups,
    label: 'API reference'
  }];

  await writeFile(getApiDocSettings().sidebarFile, JSON.stringify(wrappedSidebar, null, JSON_INDENT), 'utf-8');
  console.warn(`Generated sidebar with ${String(groups.length)} top-level module groups`);
}

/**
 * Renders a class's constructor block.
 *
 * @param lines - The page lines to append to.
 * @param name - The type's name.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderConstructorMdx(lines: string[], name: string, info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const constructor = info.constructorInfo;
  if (!constructor) {
    return;
  }
  const ctorSig = `new ${name}${constructor.signature}`;
  const ctorDesc = constructor.description
    ? ` description="${escapeJsxAttribute(markdownToHtml(resolveLinks(constructor.description, allTypes, info.namespace)))}"`
    : '';
  lines.push(`<ConstructorBlock signature="${escapeJsxAttribute(ctorSig)}"${ctorDesc} />`, '');
}

/**
 * Renders an enum's members.
 *
 * @param lines - The page lines to append to.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderEnumPage(lines: string[], info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  lines.push(`<TypeSignature kind="enum" name="${info.name}" />`, '');

  if (info.enumMembers.length === 0) {
    return;
  }

  lines.push('**Members:**', '', '| Member | Value | Description |', '| :-- | :-- | :-- |');
  for (const member of info.enumMembers) {
    const value = member.value ? `\`${escapeMarkdown(member.value)}\`` : '';
    lines.push(`| \`${member.name}\` | ${value} | ${escapeMarkdown(resolveLinks(member.description, allTypes, info.namespace))} |`);
  }
  lines.push('');
}

/**
 * Render the Starlight frontmatter block (through the closing `---` and its blank line) shared by every
 * generated page kind: module index, type overview, property, and method.
 *
 * Every page kind goes through here so no field can be emitted on some kinds and silently dropped on
 * others. `description` in particular is not just SEO metadata — it is the line the OG card renders under
 * the title, so a page kind that skipped it produced a title-only card next to fully populated ones.
 *
 * @param frontMatter - The page's frontmatter fields.
 * @returns The frontmatter lines, through the closing `---` and its blank line.
 */
export function renderFrontMatter(frontMatter: PageFrontMatter): string[] {
  return [
    '---',
    `title: "${escapeYaml(frontMatter.title)}"`,
    `slug: "${frontMatter.slug}"`,
    ...(frontMatter.description ? [`description: "${escapeYaml(stripMarkdown(frontMatter.description))}"`] : []),
    ...(frontMatter.signature ? [`signature: "${escapeYaml(truncateSignature(frontMatter.signature))}"`] : []),
    'editUrl: false',
    'sidebar:',
    `  label: "${escapeYaml(frontMatter.sidebarLabel)}"`,
    '---',
    ''
  ];
}

/**
 * Renders a function's signature, parameters, return value and examples.
 *
 * @param lines - The page lines to append to.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderFunctionPage(lines: string[], info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const $function = info.methods[0];
  if (!$function) {
    return;
  }

  lines.push('**Signature:**', '', '```ts', `function ${$function.signature}: ${$function.returnType}`, '```', '');

  if ($function.parameters.length > 0) {
    lines.push('**Parameters:**', '', '| Parameter | Type | Description |', '| :-- | :-- | :-- |');
    for (const parameter of $function.parameters) {
      lines.push(
        `| \`${parameter.name}\` | ${escapeMarkdown(escapeMdxAngleBrackets(renderTypeWithLinks(parameter.type, allTypes, info.name, info.namespace)))} | ${escapeMarkdown(resolveLinks(parameter.description, allTypes, info.namespace))} |`
      );
    }
    lines.push('');
  }

  const returnDesc = $function.returnDescription ? ` — ${escapeMdxAngleBrackets(resolveLinks($function.returnDescription, allTypes, info.namespace))}` : '';
  lines.push(`**Returns:** ${escapeMdxAngleBrackets(renderTypeWithLinks($function.returnType, allTypes, info.name, info.namespace))}${returnDesc}`, '');

  for (const example of $function.examples) {
    lines.push('**Example:**', '', renderExampleMdx(example, allTypes, info.namespace), '');
  }
}

/**
 * Renders one method overload.
 *
 * @param lines - The page lines to append to.
 * @param overload - The overload.
 * @param typeName - The name of the type the method belongs to.
 * @param namespace - The namespace of the type the method belongs to.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderMethodOverloadMdx(lines: string[], overload: MemberInfo, typeName: string, namespace: string, allTypes: Map<string, TypeInfo>): void {
  const sig = `${overload.signature}: ${overload.returnType}`;
  const staticAttribute = overload.isStatic ? ' isStatic={true}' : '';
  const descAttribute = overload.description ? ` description="${escapeJsxAttribute(markdownToHtml(resolveLinks(overload.description, allTypes, namespace)))}"` : '';
  const remarksAttribute = overload.remarks ? ` remarks="${escapeJsxAttribute(markdownToHtml(resolveLinks(overload.remarks, allTypes, namespace)))}"` : '';
  const sinceAttribute = overload.since ? ` since="${escapeJsxAttribute(overload.since)}"` : '';
  const returnTypeAttribute = ` returnType="${escapeJsxAttribute(markdownToHtml(renderTypeWithLinks(overload.returnType, allTypes, typeName, namespace)))}"`;
  const returnDescAttribute = overload.returnDescription
    ? ` returnDescription="${escapeJsxAttribute(markdownToHtml(resolveLinks(overload.returnDescription, allTypes, namespace)))}"`
    : '';
  const examplesAttribute = overload.examples.length > 0 ? ` examples={${JSON.stringify(overload.examples)}}` : '';

  const params = overload.parameters.map((p) => ({
    description: markdownToHtml(p.description || (p.name.endsWith('?') ? '*(Optional)*' : '')),
    name: p.name,
    type: markdownToHtml(renderTypeWithLinks(p.type, allTypes, typeName, namespace))
  }));
  const paramsAttribute = params.length > 0 ? ` parameters={${JSON.stringify(params)}}` : '';

  lines.push(
    `<MemberDetail${staticAttribute} signature="${escapeJsxAttribute(sig)}"${descAttribute}${remarksAttribute}${sinceAttribute}${returnTypeAttribute}${returnDescAttribute}${paramsAttribute}${examplesAttribute} />`,
    ''
  );
}

/**
 * Renders a type's method table.
 *
 * @param lines - The page lines to append to.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderMethodTableMdx(lines: string[], info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const methods = [...info.methods].sort((a, b) => {
    if (a.isStatic !== b.isStatic) {
      return a.isStatic ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  if (methods.length === 0) {
    return;
  }
  lines.push('<MethodTable rows={[');
  for (const method of methods) {
    const desc = escapeJsString(markdownToHtml(resolveLinks(method.description, allTypes, info.namespace)));
    const staticPrefix = method.isStatic ? 'static ' : '';
    const shortParams = method.parameters.map((p, index) => {
      return index === 0 && EVENT_METHODS.has(method.name) && (p.type.startsWith('"') || p.type.startsWith('\'')) ? p.type.replaceAll('"', '\'') : p.name;
    }).join(', ');
    const shortSig = `${staticPrefix}${method.name}(${shortParams})`;
    const sig = escapeJsString(shortSig);
    const slug = overloadRouteSegment(method.overloadKey);
    const returnType = markdownToHtml(renderTypeWithLinks(method.returnType, allTypes, info.name, info.namespace));
    const inheritedAttribute = method.inheritedFrom
      ? `, inheritedFrom: "${escapeJsString(markdownToHtml(typeLink(method.inheritedFrom, allTypes, info.namespace)))}"`
      : '';
    const href = memberHref(slug, method.inheritedFrom, allTypes, info.namespace);
    lines.push(
      `  { signature: "${sig}", href: "${escapeJsString(href)}", returns: "${escapeJsString(returnType)}", description: "${desc}"${inheritedAttribute} },`
    );
  }
  lines.push(']} />', '');
}

/**
 * Renders a type's property table.
 *
 * @param lines - The page lines to append to.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderPropertyTableMdx(lines: string[], info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const properties = info.properties;
  if (properties.length === 0) {
    return;
  }
  lines.push('<PropertyTable rows={[');
  for (const property of properties) {
    const desc = escapeJsString(markdownToHtml(resolveLinks(property.description, allTypes, info.namespace)));
    const type = markdownToHtml(renderTypeWithLinks(property.type, allTypes, info.name, info.namespace));
    const inheritedAttribute = property.inheritedFrom
      ? `, inheritedFrom: "${escapeJsString(markdownToHtml(typeLink(property.inheritedFrom, allTypes, info.namespace)))}"`
      : '';
    const href = memberHref(memberRouteSegment(property.name), property.inheritedFrom, allTypes, info.namespace);
    lines.push(
      `  { name: "${escapeJsString(property.name)}", href: "${escapeJsString(href)}", type: "${escapeJsString(type)}", description: "${desc}"${inheritedAttribute} },`
    );
  }
  lines.push(']} />', '');
}

/**
 * Renders a type alias's signature.
 *
 * @param lines - The page lines to append to.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderTypeAliasPage(lines: string[], info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const typeParamsAttribute = info.typeParameters.length > 0 ? ` typeParams={${JSON.stringify(info.typeParameters)}}` : '';
  lines.push(`<TypeSignature kind="type" name="${info.name}"${typeParamsAttribute} />`, '');

  const rhs = info.typeAliasText ?? 'unknown';
  lines.push(
    '**Signature:**',
    '',
    '```ts',
    `type ${getDisplayName(info.name, info)} = ${rhs}`,
    '```',
    '',
    `**Type:** ${escapeMdxBraces(escapeMdxAngleBrackets(renderTypeWithLinks(rhs, allTypes, info.name, info.namespace)))}`,
    ''
  );
}

/**
 * Renders a variable's declaration and type.
 *
 * @param lines - The page lines to append to.
 * @param name - The type's name.
 * @param info - The documented type.
 * @param allTypes - Every documented type, keyed by `${namespace}#${name}`.
 */
export function renderVariablePage(lines: string[], name: string, info: TypeInfo, allTypes: Map<string, TypeInfo>): void {
  const keyword = info.variableKeyword ?? 'let';
  const variableType = info.variableType ?? 'unknown';
  lines.push(
    '**Signature:**',
    '',
    '```ts',
    `${keyword} ${name}: ${variableType}`,
    '```',
    '',
    `**Type:** ${escapeMdxBraces(escapeMdxAngleBrackets(renderTypeWithLinks(variableType, allTypes, name, info.namespace)))}`,
    ''
  );
}

/**
 * Converts a namespace tree node into a sidebar group.
 *
 * @param node - The node.
 * @param label - The group's label.
 * @returns The sidebar group.
 */
export function sidebarTreeToEntries(node: SidebarTreeNode, label: string): SidebarEntry {
  const items: (SidebarEntry | SidebarLink)[] = [];

  // Child directory groups first (before this module's own pages)
  const sortedChildren = [...node.children].sort(([a], [b]) => a.localeCompare(b));
  for (const [childName, child] of sortedChildren) {
    items.push(sidebarTreeToEntries(child, childName));
  }

  // This module's own overview page + type/function pages (individual members are not listed).
  // Sidebar `link` fields must NOT embed BASE_PATH: Starlight prepends the config `base` to every
  // sidebar link itself, so including it here would double the base (e.g. `/base/base/api/...` → 404).
  // This differs from in-content links, which are raw anchors that Starlight does not base-prepend.
  if (node.types.length > 0) {
    const { namespace } = ensureNonNullable(node.types[0]);
    items.push({ label: 'Overview', link: `/api/${namespace}/` });
    const sortedTypes = [...node.types].sort((a, b) => a.name.localeCompare(b.name));
    for (const t of sortedTypes) {
      items.push({ label: t.name, link: `/api/${t.namespace}/${toTypeRouteSegment(t.namespace, t.name)}/` });
    }
  }

  return { collapsed: true, items, label };
}

// Serves both as the root API page's prose and (stripped) as its `description` frontmatter.
// Sharing one function keeps the page and its OG card from drifting apart.
function getApiIndexIntro(namespaces: readonly string[]): string {
  const { packageName } = getApiDocSettings();
  const [exampleNamespace = 'module'] = namespaces;
  return `The complete API reference for \`${packageName}\`, generated from its TSDoc. `
    + `Each module below maps to an import subpath (e.g. the \`${exampleNamespace}\` module is \`${packageName}/${exampleNamespace}\`).`;
}

function getComponentImports(componentNames: readonly string[]): string[] {
  return componentNames.map((componentName) => `import ${componentName} from "${API_COMPONENTS_IMPORT_PREFIX}/${componentName}.astro";`);
}

function renderNamespaceTable(
  lines: string[],
  heading: string,
  columnLabel: string,
  entries: TypeInfo[],
  allTypes: Map<string, TypeInfo>,
  namespace: string
): void {
  if (entries.length === 0) {
    return;
  }
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  lines.push(`## ${heading}`, '', `| ${columnLabel} | Description |`, '| :-- | :-- |');
  for (const entry of sorted) {
    lines.push(`| [${entry.name}](./${toTypeRouteSegment(entry.namespace, entry.name)}/) | ${escapeMarkdown(resolveLinks(entry.description, allTypes, namespace))} |`);
  }
  lines.push('');
}
