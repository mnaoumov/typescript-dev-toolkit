import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { toPosixPath } from '@mnaoumov/typescript-lib/path';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { defineDocsSiteConfig } from './astro-config.ts';
import { getDocsSiteAssetsDirectory } from './docs-site-assets.ts';

vi.mock('@astrojs/starlight', () => ({ default: vi.fn((options: unknown) => ({ name: 'starlight', options })) }));
vi.mock('@astrojs/markdown-satteri', () => ({ satteri: vi.fn((options: unknown) => ({ name: 'satteri', options })) }));

const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

interface StarlightStub {
  options: StarlightStubOptions;
}

interface StarlightStubComponents {
  SiteTitle: string;
}

interface StarlightStubEditLink {
  baseUrl: string;
}

interface StarlightStubOptions {
  readonly components: StarlightStubComponents;
  readonly customCss: string[];
  readonly editLink: StarlightStubEditLink;
  readonly routeMiddleware: string;
  readonly sidebar: unknown[];
  readonly social: unknown[];
  readonly title: string;
}

function createRoot(sidebar?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'astro-config-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@mnaoumov/typescript-lib', version: '1.2.3' }));
  if (sidebar !== undefined) {
    mkdirSync(join(root, 'docs', 'src'), { recursive: true });
    writeFileSync(join(root, 'docs', 'src', 'generated-sidebar.json'), sidebar);
  }
  return root;
}

describe('defineDocsSiteConfig', () => {
  it('points the whole site at the repository', () => {
    const root = createRoot(JSON.stringify([{ label: 'API reference' }]));
    const assets = toPosixPath(getDocsSiteAssetsDirectory());

    const config = defineDocsSiteConfig({ repo: 'typescript-lib', rootDirectory: root, title: 'TypeScript Lib' });

    expect(config.base).toBe('/typescript-lib');
    expect(config.site).toBe('https://mnaoumov.dev');
    expect(config.srcDir).toBe(join(root, 'docs', 'src'));
    expect(config.outDir).toBe(join(root, 'docs', 'dist'));
    expect(config.publicDir).toBe(join(root, 'docs', 'public'));
    expect(config.trailingSlash).toBe('always');
    expect(config.vite?.define).toEqual({ 'import.meta.env.DOCS_SITE_PACKAGE_VERSION': '"1.2.3"' });
    expect(config.vite?.resolve?.alias).toEqual([{ find: '@mnaoumov/typescript-dev-toolkit/docs-site-components', replacement: `${assets}/components` }]);

    const [integration] = castTo<StarlightStub[]>(config.integrations);
    expect(integration?.options.title).toBe('TypeScript Lib');
    expect(integration?.options.editLink.baseUrl).toBe('https://github.com/mnaoumov/typescript-lib/edit/main/');
    expect(integration?.options.social).toEqual([{ href: 'https://github.com/mnaoumov/typescript-lib', icon: 'github', label: 'GitHub' }]);
    expect(integration?.options.components.SiteTitle).toBe(`${assets}/components/SiteTitle.astro`);
    expect(integration?.options.customCss).toEqual([`${assets}/styles/global.css`]);
    expect(integration?.options.routeMiddleware).toBe(toPosixPath(join(import.meta.dirname, 'route-data.ts')));
    expect(integration?.options.sidebar).toEqual([
      { items: [{ autogenerate: { directory: 'guides' } }], label: 'Guides' },
      { label: 'API reference' }
    ]);
  });

  it('builds without the API sidebar before the generator has run', () => {
    const config = defineDocsSiteConfig({ repo: 'typescript-lib', rootDirectory: createRoot(), title: 'T' });

    const [integration] = castTo<StarlightStub[]>(config.integrations);
    expect(integration?.options.sidebar).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('ignores a sidebar file that is not a list', () => {
    const config = defineDocsSiteConfig({ repo: 'typescript-lib', rootDirectory: createRoot('{}'), title: 'T' });

    const [integration] = castTo<StarlightStub[]>(config.integrations);
    expect(integration?.options.sidebar).toHaveLength(1);
  });
});
