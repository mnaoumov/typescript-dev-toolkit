import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { join } from 'node:path';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { DocsSiteConfig } from './docs-site-config.ts';

import { execFromRoot } from '../root.ts';
import { generateApiDocs } from './api-docs.ts';
import { assertDocsLinksResolve } from './docs-links.ts';
import { getDocsSiteAssetsDirectory } from './docs-site-assets.ts';
import {
  buildDocsSite,
  devDocsSite,
  previewDocsSite
} from './docs-site-commands.ts';
import { resolveDocsSiteConfig } from './docs-site-config.ts';
import { generateOgImages } from './og-images.ts';
import { syncRepoHomepage } from './repo-homepage.ts';

vi.mock('../root.ts', () => ({ execFromRoot: vi.fn() }));
vi.mock('./api-docs.ts', () => ({ generateApiDocs: vi.fn() }));
vi.mock('./docs-links.ts', () => ({ assertDocsLinksResolve: vi.fn() }));
vi.mock('./og-images.ts', () => ({ generateOgImages: vi.fn() }));
vi.mock('./repo-homepage.ts', () => ({ syncRepoHomepage: vi.fn() }));

const CONFIG: DocsSiteConfig = { repo: 'typescript-dev-toolkit', title: 'TypeScript Dev Toolkit' };

describe('docs-site commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds: API pages, OG cards, astro build, then the link check, in that order', async () => {
    const order: string[] = [];
    vi.mocked(generateApiDocs).mockImplementation(async () => {
      order.push('api');
      await noopAsync();
    });
    vi.mocked(generateOgImages).mockImplementation(async () => {
      order.push('og');
      await noopAsync();
    });
    vi.mocked(execFromRoot).mockImplementation(castTo<typeof execFromRoot>(async () => {
      order.push('astro');
      await noopAsync();
      return '';
    }));
    vi.mocked(assertDocsLinksResolve).mockImplementation(async () => {
      order.push('links');
      await noopAsync();
    });

    await buildDocsSite(CONFIG);

    const resolved = resolveDocsSiteConfig(CONFIG);
    expect(order).toEqual(['api', 'og', 'astro', 'links']);
    expect(generateApiDocs).toHaveBeenCalledWith({ rootDirectory: resolved.rootDirectory, settings: resolved.apiDocSettings, sourceDirectory: resolved.sourceDirectory });
    expect(generateOgImages).toHaveBeenCalledWith({
      brandText: '@mnaoumov/typescript-dev-toolkit',
      contentDocsDirectory: resolved.contentDocsDirectory,
      faviconPath: resolved.faviconPath,
      fontsDirectory: join(getDocsSiteAssetsDirectory(), 'fonts'),
      outputDirectory: resolved.ogOutputDirectory
    });
    expect(execFromRoot).toHaveBeenCalledWith(['astro', 'build'], { cwd: resolved.rootDirectory });
    expect(assertDocsLinksResolve).toHaveBeenCalledWith({ outputDirectory: resolved.distDirectory, siteBaseUrl: 'https://mnaoumov.dev/typescript-dev-toolkit/' });
    expect(syncRepoHomepage).not.toHaveBeenCalled();
  });

  it('checks the repository homepage against the site URL after the build when asked', async () => {
    await buildDocsSite({ ...CONFIG, owner: 'someone', repoHomepage: 'check', siteOrigin: 'https://example.com' });

    expect(syncRepoHomepage).toHaveBeenCalledWith({
      homepageUrl: 'https://example.com/typescript-dev-toolkit/',
      mode: 'check',
      owner: 'someone',
      repo: 'typescript-dev-toolkit'
    });
  });

  it('serves the dev server in the foreground after generating the API pages', async () => {
    await devDocsSite(CONFIG);

    expect(generateApiDocs).toHaveBeenCalledOnce();
    expect(execFromRoot).toHaveBeenCalledWith(['astro', 'dev'], { cwd: process.cwd(), env: { ASTRO_DEV_BACKGROUND: '1' }, isInteractive: true });
  });

  it('previews the last build', async () => {
    await previewDocsSite(CONFIG);

    expect(generateApiDocs).not.toHaveBeenCalled();
    expect(execFromRoot).toHaveBeenCalledWith(['astro', 'preview'], { cwd: process.cwd(), isInteractive: true });
  });
});
