import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { lint } from '../src/linters/markdownlint.ts';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await lint({ paths, shouldFix: true });
});
