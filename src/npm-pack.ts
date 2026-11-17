/**
 * @file
 *
 * Reads the output of `npm pack --json`, which the release and the pack smoke both run.
 */

/**
 * One pack result of `npm pack --json`, reduced to what is read from it.
 */
export interface NpmPackResult {
  /**
   * The tarball's file name, relative to the pack destination.
   */
  readonly filename: string;
}

/**
 * Extracts the single pack result from the output of `npm pack --json`.
 *
 * Two things make this more than a `JSON.parse()`. The payload is PRECEDED on stdout by whatever the
 * `prepare` script printed (the `npm notice` lines go to stderr, not here), so its start has to be found —
 * and it is found by parsing from each candidate start rather than by matching a literal, because the
 * prefix may itself contain a brace. And the payload's SHAPE depends on the npm major: npm 11 and earlier
 * emit an array of pack results, npm 12 emits an object keyed by package name. Both are accepted; scanning
 * for the array's literal opening is what broke every release on npm 12.
 *
 * @param output - The stdout of `npm pack --json`.
 * @returns The {@link NpmPackResult} describing the packed tarball.
 * @throws If the output holds no parsable JSON payload, or the payload holds no pack result.
 */
export function parseNpmPackOutput(output: string): NpmPackResult {
  for (const match of output.matchAll(/[[{]/g)) {
    let payload: unknown;

    try {
      payload = JSON.parse(output.slice(match.index));
    } catch {
      continue;
    }

    const results = Array.isArray(payload) ? payload as NpmPackResult[] : Object.values(payload as Record<string, NpmPackResult>);
    const result = results[0];

    if (!result) {
      throw new Error('Found no pack result in the `npm pack --json` output');
    }

    return result;
  }

  throw new Error('Failed to find the JSON payload in the `npm pack --json` output');
}
