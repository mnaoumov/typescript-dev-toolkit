import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { format } from '../src/formatters/dprint.ts';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await format({ paths });
});
