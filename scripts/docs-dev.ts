import { wrapCliTask } from '../src/cli-utils.ts';
import { devDocsSite } from '../src/docs-site/docs-site-commands.ts';
import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

await wrapCliTask(async () => {
  await devDocsSite(DOCS_SITE_CONFIG);
});
