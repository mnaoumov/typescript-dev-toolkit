import { wrapCliTask } from '../src/cli-utils.ts';
import { buildDocsSite } from '../src/docs-site/docs-site-commands.ts';
import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

await wrapCliTask(async () => {
  await buildDocsSite(DOCS_SITE_CONFIG);
});
