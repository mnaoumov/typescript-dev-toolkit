/**
 * @file
 *
 * Lints the project with its linter (ESLint, or Biome).
 */

import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import { lint } from '../src/linters/auto.ts';

const [, , ...paths] = process.argv;

await wrapCliTask(async () => {
  await lint({ paths });
});
