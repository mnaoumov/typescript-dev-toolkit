/**
 * @file
 *
 * Links the markdown link check leaves unchecked for one run, named by the {@link LINK_CHECK_SKIP_ENV_VARIABLE}
 * environment variable.
 *
 * Two cases need it: a host the current network cannot reach although it is up (a provider blocking it), and a
 * release whose documentation links to something only that same release pushes. Both are temporary, so the
 * variable belongs on the one command that needs it, never in `.env`: a skip left in place lets a link go stale
 * with nothing to say so. It is read like every other variable here, `.env` included, and every skipped link,
 * like every entry that skipped nothing, prints a warning, so a skip is never silent.
 *
 * Entries are comma-separated. An entry holding `://` is a URL prefix and matches every link starting with it; any
 * other entry is a host and matches the links to exactly that host (`mail.tm` does not match `docs.mail.tm`).
 */

import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import process from 'node:process';

import { loadEnvFileIfExists } from './env-toggle.ts';

/**
 * The environment variable naming the links to skip.
 */
export const LINK_CHECK_SKIP_ENV_VARIABLE = 'LINK_CHECK_SKIP';

/**
 * One entry of {@link LINK_CHECK_SKIP_ENV_VARIABLE}.
 */
export interface LinkCheckSkipEntry {
  /**
   * `host` matches links to exactly that host; `prefix` matches links starting with {@link value}.
   */
  readonly kind: 'host' | 'prefix';

  /**
   * The entry as written, a host lowercased.
   */
  readonly value: string;
}

/**
 * The text of one markdown file the link check reads.
 */
export interface LinkCheckSourceFile {
  /**
   * The file's content.
   */
  readonly content: string;

  /**
   * The file's path, as the warnings name it.
   */
  readonly path: string;
}

const HOST_REG_EXP = /^[a-z\d-]+(?:\.[a-z\d-]+)*$/i;
const URL_REG_EXP = /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/gi;
const URL_TRAILING_PUNCTUATION_REG_EXP = /[.,;:!?*_~]+$/;

/**
 * Tells whether an entry matches a URL.
 *
 * @param url - The URL.
 * @param entry - The entry.
 * @returns `true` when a `prefix` entry starts the URL, or a `host` entry is exactly the URL's host.
 */
export function doesLinkCheckSkipEntryMatch(url: string, entry: LinkCheckSkipEntry): boolean {
  return entry.kind === 'prefix' ? url.startsWith(entry.value) : URL.parse(url)?.hostname === entry.value;
}

/**
 * Finds the absolute `http`/`https` URLs written in a text.
 *
 * It is a textual scan, so it also finds a URL inside a code span, which `linkinator` does not check.
 *
 * @param text - The text to scan.
 * @returns The URLs, in order of appearance, trailing punctuation dropped.
 */
export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(URL_REG_EXP), (match) => match[0].replace(URL_TRAILING_PUNCTUATION_REG_EXP, ''));
}

/**
 * Builds the warnings for a run with skip entries: one per distinct link each file loses to an entry, and one per
 * entry that matched no link at all.
 *
 * @param entries - The entries, as {@link parseLinkCheckSkipEntries} returned them.
 * @param files - The markdown files the link check is handed.
 * @returns The warning lines, without a trailing newline.
 */
export function getLinkCheckSkipWarnings(entries: readonly LinkCheckSkipEntry[], files: readonly LinkCheckSourceFile[]): string[] {
  const warnings: string[] = [];
  const usedEntries = new Set<LinkCheckSkipEntry>();

  for (const file of files) {
    for (const url of new Set(extractUrls(file.content))) {
      const entry = entries.find((candidate) => doesLinkCheckSkipEntryMatch(url, candidate));
      if (!entry) {
        continue;
      }

      usedEntries.add(entry);
      warnings.push(`WARNING: ${LINK_CHECK_SKIP_ENV_VARIABLE} skips ${url} in ${file.path} (entry ${entry.value}).`);
    }
  }

  for (const entry of entries) {
    if (!usedEntries.has(entry)) {
      warnings.push(`WARNING: ${LINK_CHECK_SKIP_ENV_VARIABLE} entry ${entry.value} matched no link; remove it.`);
    }
  }

  if (entries.length > 0) {
    warnings.push(
      `WARNING: ${LINK_CHECK_SKIP_ENV_VARIABLE} is set. Set it for one command only, never in .env: a lasting skip lets links go stale unnoticed.`
    );
  }

  return warnings;
}

/**
 * Adds the entries to a `linkinator` config, keeping whatever the project's own config already skips.
 *
 * The skip list goes to `linkinator` as a config file because `--config` replaces the project's
 * `linkinator.config.json` rather than adding to it, so the project's settings have to be carried over.
 *
 * @param projectConfig - The parsed project `linkinator.config.json`, or `undefined` when there is none.
 * @param entries - The entries.
 * @returns The config to write.
 * @throws If the project config is not a JSON object.
 */
export function mergeLinkinatorSkipConfig(projectConfig: unknown, entries: readonly LinkCheckSkipEntry[]): Record<string, unknown> {
  const config = projectConfig ?? {};
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('The project linkinator.config.json is not a JSON object.');
  }

  const record = config as Record<string, unknown>;
  const projectSkip = record['skip'];
  const existingSkip = projectSkip === undefined ? [] : [projectSkip].flat();
  return { ...record, skip: [...existingSkip, ...entries.map((entry) => toLinkinatorSkipPattern(entry))] };
}

/**
 * Parses the value of {@link LINK_CHECK_SKIP_ENV_VARIABLE}.
 *
 * @param value - The comma-separated value; blank entries are ignored.
 * @returns The entries.
 * @throws If an entry is neither a URL prefix nor a host name.
 */
export function parseLinkCheckSkipEntries(value: string): LinkCheckSkipEntry[] {
  const entries: LinkCheckSkipEntry[] = [];

  for (const rawEntry of value.split(',')) {
    const entry = rawEntry.trim();
    if (entry === '') {
      continue;
    }

    if (entry.includes('://')) {
      entries.push({ kind: 'prefix', value: entry });
      continue;
    }

    if (!HOST_REG_EXP.test(entry)) {
      throw new Error(`${LINK_CHECK_SKIP_ENV_VARIABLE} entry ${entry} is neither a host name nor a URL prefix (one holding ://).`);
    }

    entries.push({ kind: 'host', value: entry.toLowerCase() });
  }

  return entries;
}

/**
 * Reads the entries of {@link LINK_CHECK_SKIP_ENV_VARIABLE}, loading the optional `.env` first.
 *
 * @returns The entries; none when the variable is unset or blank.
 */
export function readLinkCheckSkipEntries(): LinkCheckSkipEntry[] {
  loadEnvFileIfExists();
  return parseLinkCheckSkipEntries(process.env[LINK_CHECK_SKIP_ENV_VARIABLE] ?? '');
}

/**
 * Converts an entry into a regular expression for the `skip` list of a `linkinator` config file.
 *
 * Never pass it as a `--skip` argument: on Windows the command line passes through the `npx` and `.bin` shims,
 * which re-expand it unquoted, so the `|` in it pipes into a command named by what follows.
 *
 * @param entry - The entry.
 * @returns The regular expression source: an anchored prefix, or the scheme, optional credentials, the host and an
 * optional port followed by the end of the authority.
 */
export function toLinkinatorSkipPattern(entry: LinkCheckSkipEntry): string {
  if (entry.kind === 'prefix') {
    return `^${escapeRegExp(entry.value)}`;
  }

  // `linkinator` matches the URL it has normalized, whose scheme and host are lowercase already.
  return String.raw`^https?://(?:[^/?#@]*@)?${escapeRegExp(entry.value)}(?::\d+)?(?:[/?#]|$)`;
}
