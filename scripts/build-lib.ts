/**
 * @file
 *
 * Builds the library: unbundled CommonJS and ESM output.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { buildLibrary } from '../src/library-build.ts';

await wrapCliTask(async () => {
  await buildLibrary();
});
