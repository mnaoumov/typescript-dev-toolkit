import process from 'node:process';

import { wrapCliTask } from '../src/cli-utils.ts';
import {
  gate,
  parseGateArguments
} from '../src/gate.ts';

const [, , ...$arguments] = process.argv;

await wrapCliTask(async () => {
  const options = parseGateArguments($arguments);
  await gate(options);
});
