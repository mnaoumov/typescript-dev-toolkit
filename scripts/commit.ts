import { wrapCliTask } from '../src/cli-utils.ts';
import { execFromRoot } from '../src/root.ts';

await wrapCliTask(async () => {
  await execFromRoot('czg');
});
