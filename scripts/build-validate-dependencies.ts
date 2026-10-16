import { wrapCliTask } from '../src/cli-utils.ts';
import { validateDependencies } from '../src/validate-dependencies.ts';

await wrapCliTask(() => validateDependencies());
