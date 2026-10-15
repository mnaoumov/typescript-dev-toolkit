import { wrapCliTask } from '../src/cli-utils.ts';
import { generateLibraryExports } from '../src/library-build.ts';

await wrapCliTask(async () => {
  await generateLibraryExports();
});
