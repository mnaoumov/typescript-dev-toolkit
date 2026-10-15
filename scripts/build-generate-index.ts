import { wrapCliTask } from '../src/cli-utils.ts';
import { generateLibraryIndex } from '../src/library-build.ts';

await wrapCliTask(async () => {
  await generateLibraryIndex();
});
