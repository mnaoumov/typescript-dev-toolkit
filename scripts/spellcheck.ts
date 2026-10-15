import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { spellcheck } from '../src/linters/cspell.ts';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await spellcheck({ paths });
});
