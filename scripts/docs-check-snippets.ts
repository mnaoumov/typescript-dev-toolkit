import { wrapCliTask } from '../src/cli-utils.ts';
import { assertDocsSnippetsCompile } from '../src/docs-site/docs-snippets.ts';
import { DOCS_SNIPPETS_PARAMS } from './docs-snippets-config.ts';

await wrapCliTask(async () => {
  await assertDocsSnippetsCompile(DOCS_SNIPPETS_PARAMS);
});
