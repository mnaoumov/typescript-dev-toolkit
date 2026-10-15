import { buildCompileTypeScript } from '../src/build.ts';
import { wrapCliTask } from '../src/cli-utils.ts';

await wrapCliTask(async () => {
  await buildCompileTypeScript();
});
