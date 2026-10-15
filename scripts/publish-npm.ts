/**
 * @file
 *
 * The NPM publish entry point `.github/workflows/publish-npm.yml` runs: publishes the package under the `beta`
 * dist-tag for a pre-release and `latest` otherwise.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { publish } from '../src/npm-publish.ts';
import { readPackageJson } from '../src/npm.ts';
import { isPreRelease } from '../src/version.ts';

await wrapCliTask(async () => {
  const { version } = await readPackageJson();
  if (!version) {
    throw new Error('package.json declares no version.');
  }
  await publish(isPreRelease(version));
});
