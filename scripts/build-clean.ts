import { wrapCliTask } from '../src/cli-utils.ts';
import { buildCleanLibrary } from '../src/library-build.ts';

await wrapCliTask(async () => {
  await buildCleanLibrary();
});
