import { wrapCliTask } from '../src/cli-utils.ts';
import { buildLibraryTypes } from '../src/library-build.ts';

await wrapCliTask(async () => {
  await buildLibraryTypes();
});
