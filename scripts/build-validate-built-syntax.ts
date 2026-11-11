import { wrapCliTask } from '../src/cli-utils.ts';
import { validateBuiltSyntax } from '../src/validate-built-syntax.ts';

await wrapCliTask(() => validateBuiltSyntax());
