/**
 * @file
 *
 * Lints the project with ESLint.
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { lint } from '../src/linters/eslint.ts';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await lint({ paths });
});
