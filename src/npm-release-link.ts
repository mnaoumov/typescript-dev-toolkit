/**
 * @file
 *
 * Builds the `**npm**: <link>` paragraph a GitHub release of a package published to npm from its repository carries,
 * linking that exact version's npm page.
 */

import { errorToString } from '@mnaoumov/typescript-lib/error';

/**
 * The time a registry lookup may take before the release notes are written without the link.
 */
const REGISTRY_TIMEOUT_IN_MILLISECONDS = 10_000;

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const GITHUB_REPOSITORY_REG_EXP = /github\.com[/:](?<owner>[^/\s]+)\/(?<name>[^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/iu;

/**
 * Parameters for {@link getNpmVersionLinkLine}.
 */
export interface GetNpmVersionLinkLineParams {
  /**
   * Fetches a registry document. Defaults to the global `fetch` with a timeout.
   */
  readonly fetchRegistry?: (url: string) => Promise<NpmRegistryResponse>;

  /**
   * Whether the package's `package.json` is marked `private`.
   */
  readonly isPrivate: boolean | undefined;

  /**
   * The package's name, as in its `package.json`.
   */
  readonly packageName: string | undefined;

  /**
   * The URL of the GitHub repository the release is created in (`https://github.com/<owner>/<repo>`).
   */
  readonly repoUrl: string;

  /**
   * The version being released, without a leading `v`.
   */
  readonly version: string;

  /**
   * Prints a warning. Defaults to `console.warn`.
   */
  readonly warn?: (message: string) => void;
}

/**
 * The answer of one registry request, reduced to what the lookup reads.
 */
export interface NpmRegistryResponse {
  /**
   * The parsed body, read only when {@link NpmRegistryResponse.status} is `200`.
   */
  readonly body: unknown;

  /**
   * The HTTP status.
   */
  readonly status: number;
}

/**
 * Returns the `**npm**: https://www.npmjs.com/package/<name>/v/<version>` line for a package published to npm from the
 * release's repository, or `null` for any other package.
 *
 * A package counts as published from the repository when its `package.json` is not `private` and the registry document
 * for its name names that GitHub repository in `repository`. Not being private proves nothing on its own: most
 * Obsidian plugins are not private and never reach npm, and some of their bare names belong to other people there. A
 * package not on npm yet (a first release) gets no line. A lookup that fails never fails the release: it prints a
 * warning and returns `null`, and the line can be added later.
 *
 * @param params - The {@link GetNpmVersionLinkLineParams}.
 * @returns The line, or `null` when the package is not published to npm from this repository.
 */
export async function getNpmVersionLinkLine(params: GetNpmVersionLinkLineParams): Promise<null | string> {
  const {
    fetchRegistry = fetchRegistryDocument,
    isPrivate,
    packageName,
    repoUrl,
    version,
    warn = console.warn
  } = params;

  if (isPrivate || !packageName) {
    return null;
  }

  const expectedRepository = toGitHubRepository(repoUrl);
  if (!expectedRepository) {
    return null;
  }

  const registryUrl = `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`;
  let response: NpmRegistryResponse;
  try {
    response = await fetchRegistry(registryUrl);
  } catch (error) {
    warn(`Could not read ${registryUrl}, so the release notes carry no npm link: ${errorToString(error)}`);
    return null;
  }

  if (response.status === HTTP_NOT_FOUND) {
    return null;
  }

  if (response.status !== HTTP_OK) {
    warn(`${registryUrl} answered HTTP ${String(response.status)}, so the release notes carry no npm link.`);
    return null;
  }

  const registryRepository = toGitHubRepository(getRepositoryUrl(response.body));
  return registryRepository === expectedRepository ? `**npm**: https://www.npmjs.com/package/${packageName}/v/${version.replace(/^v/u, '')}` : null;
}

async function fetchRegistryDocument(url: string): Promise<NpmRegistryResponse> {
  const response = await fetch(url, {
    // The full document: the abbreviated install metadata leaves `repository` out.
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_IN_MILLISECONDS)
  });
  return {
    body: response.ok ? await response.json() : null,
    status: response.status
  };
}

function getRepositoryUrl(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const repository = (body as Record<string, unknown>)['repository'];
  if (typeof repository === 'string') {
    return repository;
  }
  if (typeof repository === 'object' && repository !== null) {
    const url = (repository as Record<string, unknown>)['url'];
    return typeof url === 'string' ? url : '';
  }
  return '';
}

function toGitHubRepository(url: string): null | string {
  const match = GITHUB_REPOSITORY_REG_EXP.exec(url.trim());
  const owner = match?.groups?.['owner'];
  const name = match?.groups?.['name'];
  return owner && name ? `${owner}/${name}`.toLowerCase() : null;
}
