/**
 * @file
 *
 * The slug rules for a type's page: the lowercased segment its file is written under, and the case-preserved one its
 * URL uses. Every site is generated with these rules, so a link into another package's site is built with them too.
 */

/**
 * Lowercase a path segment for use in an ON-DISK file/dir name. The routes themselves are case-preserved via an
 * explicit `slug:` frontmatter (see {@link toRouteSegmentPreserveCase}), but the files stay lowercase (and numerically
 * disambiguated) so two type names differing only by case cannot collide on Windows' case-insensitive filesystem.
 *
 * @param segment - The segment.
 * @returns The lowercased segment.
 */
export function toRouteSegment(segment: string): string {
  return segment.toLowerCase();
}

/**
 * Slugify a path segment (type name) for a URL/route while PRESERVING case: collapse runs of non-alphanumeric
 * characters to `-` and trim. Used for the case-preserved `slug:` frontmatter and the internal links that point at it,
 * so URLs read as pretty PascalCase (e.g. `/api/.../TypeName/`).
 *
 * @param segment - The segment.
 * @returns The slug, or `unnamed` when nothing alphanumeric is left.
 */
export function toRouteSegmentPreserveCase(segment: string): string {
  const cleaned = segment.replaceAll(/[^a-zA-Z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  return cleaned || 'unnamed';
}
