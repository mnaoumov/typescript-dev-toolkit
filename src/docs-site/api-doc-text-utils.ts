/**
 * @file
 *
 * Text/markdown/escaping utilities and identifier helpers for the API documentation generator.
 */

import {
  getMandatoryNamedGroup,
  getOptionalNamedGroup
} from '@mnaoumov/typescript-lib/reg-exp';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  MarkdownSegment,
  MemberInfo,
  TypeInfo
} from './api-doc-types.ts';

import { EVENT_METHODS } from './api-doc-constants.ts';
import { registerPackageDeclaration } from './api-doc-package-sites.ts';
import { toRouteSegment } from './api-doc-route-segments.ts';
import { getApiDocSettings } from './api-doc-settings.ts';

interface OpenFence {
  readonly closeRe: RegExp;
  readonly lang: string;
}

/**
 * Compute an overload key for methods with distinguishing first param (e.g. on('changed',...))
 *
 * @param method - The method.
 * @returns The overload key.
 */
export function computeOverloadKey(method: MemberInfo): string {
  if (EVENT_METHODS.has(method.name) && method.parameters.length > 0) {
    const firstParameter = method.parameters[0];
    if (firstParameter?.type.startsWith('"') || firstParameter?.type.startsWith('\'')) {
      const normalizedType = firstParameter.type.replaceAll('"', '\'');
      return `${method.name}(${normalizedType})`;
    }
  }
  return method.name;
}

/**
 * Creates the folder a file is about to be written to.
 *
 * @param filePath - The path of the file about to be written.
 */
export async function ensureDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

/**
 * Escape text for use inside a JS string within a JSX expression: {...{key: "..."}}
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeJsString(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`).replaceAll('\n', ' ');
}

/**
 * Escape text for use inside a JSX attribute: attr="..." (MDX uses HTML-style parsing)
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeJsxAttribute(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\n', ' ');
}

/**
 * Escape text for a markdown table cell.
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeMarkdown(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ').replaceAll('{', String.raw`\{`).replaceAll('}', String.raw`\}`);
}

/**
 * Escape angle brackets so MDX does not read them as JSX.
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeMdxAngleBrackets(text: string): string {
  return text.replaceAll('<', String.raw`\<`).replaceAll('>', String.raw`\>`);
}

/**
 * Escape curly braces in MDX markdown content to prevent JSX expression parsing
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeMdxBraces(text: string): string {
  return text.replaceAll('{', String.raw`\{`).replaceAll('}', String.raw`\}`);
}

/**
 * Escape text for a double-quoted YAML value.
 *
 * @param text - The text to escape.
 * @returns The escaped text.
 */
export function escapeYaml(text: string): string {
  return text.replaceAll('"', String.raw`\"`);
}

const SIGNATURE_MAX_LENGTH = 160;
const IMPORT_QUALIFIER_REG_EXP = /import\((?<Quote>["'])[^"']+\k<Quote>\)\./g;
const IMPORT_TYPE_REG_EXP = /import\((?<Quote>["'])(?<Path>[^"']+)\k<Quote>\)\.(?<Name>[A-Za-z_$][\w$]*)/g;

/**
 * Escape MDX-unsafe characters (`<`, `{`, `}`) in prose text, while leaving inline code spans
 * (`` `code` ``) and markdown links (`[text](url)`) untouched. MDX parses bare `<`/`{` in prose as
 * JSX/expressions, so they must be backslash-escaped to render as literal text.
 *
 * @param text - The prose to escape.
 * @returns The escaped prose.
 */
export function escapeMdxProse(text: string): string {
  const protectedPattern = /`[^`]*`|\[[^\]]*\]\([^)]*\)/g;
  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(protectedPattern)) {
    const index = match.index;
    result += escapeMdxProseChars(text.slice(lastIndex, index));
    result += match[0];
    lastIndex = index + match[0].length;
  }
  result += escapeMdxProseChars(text.slice(lastIndex));
  return result;
}

/**
 * Collapse single newlines within paragraphs to spaces, preserve double newlines as paragraph breaks.
 * Fenced code blocks (backtick or tilde fences) are preserved verbatim — their internal newlines are NOT folded,
 * so embedded code survives to be re-emitted as a real code fence downstream.
 *
 * @param text - The text.
 * @returns The folded text.
 */
export function foldTsDocParagraphs(text: string): string {
  const segments = segmentMarkdown(text);
  return segments
    .map((seg) => {
      return seg.type === 'code'
        ? `\`\`\`${seg.lang}\n${seg.text}\n\`\`\``
        : seg.text
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.replaceAll('\n', ' '))
          .join('\n\n');
    })
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The type's name with its type parameters, without their constraints.
 *
 * @param name - The type's name.
 * @param info - The documented type.
 * @returns The name with its bare type parameters.
 */
export function getDisplayName(name: string, info: TypeInfo): string {
  if (info.typeParameters.length === 0) {
    return name;
  }
  const bareParams = info.typeParameters.map((tp) => tp.replace(/\s+extends\s+.*$/, ''));
  return `${name}<${bareParams.join(', ')}>`;
}

/**
 * Emit the import statement for a documented export.
 *
 * The subpath equals the type's namespace (its source path relative to `src`), so `src/string.ts` of
 * `@mnaoumov/typescript-lib` is `@mnaoumov/typescript-lib/string`.
 *
 * Interfaces / type aliases / enums are imported with `import type`; classes / functions /
 * variables with a value `import`.
 *
 * @param info - The documented type.
 * @returns The import statement.
 */
export function getImportStatement(info: TypeInfo): string {
  const isTypeOnly = ['enum', 'interface', 'type'].includes(info.kind);
  const importKeyword = isTypeOnly ? 'import type' : 'import';
  return `${importKeyword} { ${info.name} } from '${getApiDocSettings().packageName}/${info.namespace}';`;
}

/**
 * The folder a namespace's pages are written to.
 *
 * @param namespace - The type's namespace.
 * @returns The folder.
 */
export function getNamespaceDirectory(namespace: string): string {
  return namespace;
}

/**
 * Sanitize a member name for use in a case-PRESERVED URL/route segment (e.g. `showNotice`).
 *
 * @param name - The member's name.
 * @returns The case-preserved segment.
 */
export function memberRouteSegment(name: string): string {
  return slugifyMemberName(name);
}

/**
 * Sanitize a member name for use as an on-disk FILENAME (lowercased, collision-safe).
 *
 * @param name - The member's name.
 * @returns The lowercased file name segment.
 */
export function memberSlug(name: string): string {
  return toRouteSegment(slugifyMemberName(name));
}

/**
 * Slugify an overload key for a case-PRESERVED URL/route segment: on("changed") -> on-changed.
 *
 * @param overloadKey - The overload key, e.g. `on('changed')`.
 * @returns The case-preserved segment.
 */
export function overloadRouteSegment(overloadKey: string): string {
  return slugifyOverloadKey(overloadKey);
}

/**
 * Slugify an overload key for an on-disk FILENAME: on("changed") -> on-changed (lowercased).
 *
 * @param overloadKey - The overload key, e.g. `on('changed')`.
 * @returns The lowercased file name segment.
 */
export function overloadSlug(overloadKey: string): string {
  return toRouteSegment(slugifyOverloadKey(overloadKey));
}

/**
 * Replace every match of a global regular expression with what a replacer builds from the match. The typed
 * counterpart of `String.prototype.replaceAll` with a callback, whose arguments are typed only positionally.
 *
 * @param text - The text.
 * @param regExp - The regular expression; it must carry the `g` flag.
 * @param replacer - Builds the replacement of one match.
 * @returns The text with every match replaced.
 */
export function replaceRegExpMatches(text: string, regExp: RegExp, replacer: (match: RegExpMatchArray) => string): string {
  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(regExp)) {
    result += text.slice(lastIndex, match.index) + replacer(match);
    lastIndex = match.index + match[0].length;
  }
  return result + text.slice(lastIndex);
}

/**
 * Split markdown text into an ordered list of prose and fenced-code segments.
 * A fenced-code segment is delimited by a line of 3+ backticks or tildes; its content is captured
 * raw (never escaped) so it can be re-emitted as a literal MDX code fence.
 *
 * @param text - The text.
 * @returns The segments, in order.
 */
export function segmentMarkdown(text: string): MarkdownSegment[] {
  const lines = text.split('\n');
  const segments: MarkdownSegment[] = [];
  let proseBuffer: string[] = [];
  let codeLines: string[] = [];
  let openFence: null | OpenFence = null;
  for (const line of lines) {
    if (openFence) {
      if (openFence.closeRe.test(line)) {
        segments.push({ lang: openFence.lang, text: codeLines.join('\n'), type: 'code' });
        openFence = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const openMatch = /^\s*(?<fence>(?<fenceChar>[`~])\k<fenceChar>{2,})(?<lang>.*)$/.exec(line);
    if (openMatch) {
      const fenceChars = getMandatoryNamedGroup(openMatch, 'fence');
      const fenceChar = getMandatoryNamedGroup(openMatch, 'fenceChar');
      flushProse();
      codeLines = [];
      openFence = {
        closeRe: new RegExp(`^\\s*\\${fenceChar}{${String(fenceChars.length)},}\\s*$`),
        lang: getMandatoryNamedGroup(openMatch, 'lang').trim()
      };
      continue;
    }
    proseBuffer.push(line);
  }
  // An unclosed fence runs to the end of the text.
  if (openFence) {
    segments.push({ lang: openFence.lang, text: codeLines.join('\n'), type: 'code' });
  }
  flushProse();
  return segments;

  function flushProse(): void {
    if (proseBuffer.length === 0) {
      return;
    }

    segments.push({ text: proseBuffer.join('\n'), type: 'prose' });
    proseBuffer = [];
  }
}

/**
 * Strip the `import("…")` qualifiers ts-morph prints before a type that is not in scope, recording each one's
 * declaration file first, since it is the one place a printed type names where it was declared.
 *
 * @param typeText - The printed type.
 * @returns The type without its import qualifiers.
 */
export function simplifyType(typeText: string): string {
  for (const match of typeText.matchAll(IMPORT_TYPE_REG_EXP)) {
    registerPackageDeclaration(getMandatoryNamedGroup(match, 'Name'), getMandatoryNamedGroup(match, 'Path'));
  }

  return typeText.replaceAll(IMPORT_QUALIFIER_REG_EXP, '');
}

/**
 * Normalize a code signature for the `signature:` frontmatter / OG card: collapse whitespace to
 * single spaces and truncate to a card-friendly length with an ellipsis.
 *
 * @param signature - The signature.
 * @returns The normalized signature.
 */
export function truncateSignature(signature: string): string {
  const collapsed = signature.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length <= SIGNATURE_MAX_LENGTH ? collapsed : `${collapsed.slice(0, SIGNATURE_MAX_LENGTH - 1).trimEnd()}…`;
}

function slugifyMemberName(name: string): string {
  const cleaned = name
    .replaceAll(/^["']|["']$/g, '')
    .replaceAll(/[^a-zA-Z0-9]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');
  // A member literally named `index` would write `index.mdx`, colliding with the type-overview
  // `index.mdx` in the same directory (one silently overwrites the other, 404-ing the loser).
  return cleaned === 'index' ? 'index-member' : (cleaned || 'unnamed');
}

function slugifyOverloadKey(overloadKey: string): string {
  const slug = overloadKey
    .replaceAll(/["'()]/g, ' ')
    .replaceAll(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-');
  // A method named `index` would write `index.mdx` over the type-overview page, exactly as a property would.
  return slug === 'index' ? 'index-member' : slug;
}

const OG_DESCRIPTION_MAX_LENGTH = 160;

/**
 * Strip markdown formatting to plain text for use in meta descriptions
 *
 * @param text - The text.
 * @returns The plain text, at most 160 characters.
 */
export function stripMarkdown(text: string): string {
  const plain = replaceRegExpMatches(text, /\{@link\s+(?:[^|}]+?)(?:\s*\|\s*(?<display>[^}]+?))?\}/g, (match) => getOptionalNamedGroup(match, 'display') ?? '')
    .replaceAll(/\[(?<text>[^\]]+)\]\([^)]+\)/g, '$<text>')
    .replaceAll(/[`*_~]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (plain.length <= OG_DESCRIPTION_MAX_LENGTH) {
    return plain;
  }

  // Cut back to a word boundary: a raw slice ends descriptions mid-word (`… the string module is ob`).
  // That fragment is what readers see on the OG card and in search results.
  const clipped = plain.slice(0, OG_DESCRIPTION_MAX_LENGTH - 1);
  const lastSpaceIndex = clipped.lastIndexOf(' ');
  const truncated = lastSpaceIndex > 0 ? clipped.slice(0, lastSpaceIndex) : clipped;
  return `${truncated.replace(/[,;:.\s]+$/, '')}…`;
}

function escapeMdxProseChars(chunk: string): string {
  return chunk.replaceAll(/[<{}]/g, (char) => `\\${char}`);
}
