import { wrapCliTask } from '../src/cli-utils.ts';
import { validateDependencies } from '../src/validate-dependencies.ts';

const RUN_AS_COMMAND = 'run as a command through resolveToolCommand';

await wrapCliTask(() =>
  validateDependencies({
    unimportedDependencies: {
      '@biomejs/biome': `${RUN_AS_COMMAND} by the biome formatter and linter`,
      '@commitlint/config-conventional': 'resolved by path in commitlint-config, which commitlint then loads',
      '@stryker-mutator/core': `${RUN_AS_COMMAND} by testMutation`,
      '@stryker-mutator/vitest-runner': 'loaded by Stryker for the testRunner: \'vitest\' that defineStrykerConfig sets',
      '@tsconfig/strictest': 'extended by every consumer\'s tsconfig.json',
      'cspell': `${RUN_AS_COMMAND} by spellcheck and spellcheckContent`,
      'dprint': `${RUN_AS_COMMAND} by the dprint formatter`,
      'jiti': 'runs every consumer\'s package scripts (jiti scripts/<name>.ts)',
      'prettier': `${RUN_AS_COMMAND} by the prettier formatter`,
      'svelte-check': `${RUN_AS_COMMAND} by buildCompileSvelte`,
      'svelte-preprocess': 'loaded through a variable specifier by the Svelte preprocessor fallback',
      'typedoc-plugin-mdn-links': 'its data file is read by path from node_modules by the docs-site link rendering'
    }
  })
);
