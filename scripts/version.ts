/**
 * @file
 *
 * The release entry point: `npm run version '--' <type> [flags]`.
 *
 * The generic release bumps the version, settles `CHANGELOG.md`, commits, tags, pushes and creates the GitHub
 * release. The release carries no assets: the package is distributed through NPM, which
 * `.github/workflows/publish-npm.yml` publishes to from a fresh build when the release is published.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import {
  parseVersionArguments,
  updateVersion
} from '../src/version.ts';

await wrapCliTask(async () => {
  const [, , ...versionArguments] = process.argv;
  const { options, versionUpdateType } = parseVersionArguments(versionArguments);
  await updateVersion(versionUpdateType, {
    ...options,
    getReleaseAssetPaths: () => Promise.resolve([])
  });
});
