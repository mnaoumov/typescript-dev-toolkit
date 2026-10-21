import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { ImportStatementContext } from './api-doc-settings.ts';

import { DEFAULT_PACKAGE_SITES } from './api-doc-package-sites.ts';
import { resolveDocsSiteConfig } from './docs-site-config.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

interface PackageJsonFixture {
  readonly name?: string;
  readonly version?: string;
}

function createRoot(packageJson: PackageJsonFixture): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-site-config-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson));
  return root;
}

describe('resolveDocsSiteConfig', () => {
  it('derives every path and URL from the repository name', () => {
    const root = createRoot({ name: '@mnaoumov/typescript-lib', version: '1.2.3' });

    const resolved = resolveDocsSiteConfig({ repo: 'typescript-lib', rootDirectory: root, title: 'TypeScript Lib' });

    expect(resolved).toEqual({
      apiDocSettings: {
        basePath: '/typescript-lib',
        excludedDirectories: [],
        externalTypeLinks: new Map(),
        genericTypeParameters: [],
        outputDirectory: join(root, 'docs', 'src', 'content', 'docs', 'api'),
        packageName: '@mnaoumov/typescript-lib',
        packageSites: DEFAULT_PACKAGE_SITES,
        sidebarFile: join(root, 'docs', 'src', 'generated-sidebar.json')
      },
      basePath: '/typescript-lib',
      contentDocsDirectory: join(root, 'docs', 'src', 'content', 'docs'),
      distDirectory: join(root, 'docs', 'dist'),
      docsDirectory: join(root, 'docs'),
      docsSourceDirectory: join(root, 'docs', 'src'),
      editLinkBaseUrl: 'https://github.com/mnaoumov/typescript-lib/edit/main/',
      faviconPath: join(root, 'docs', 'public', 'favicon.svg'),
      githubUrl: 'https://github.com/mnaoumov/typescript-lib',
      guidesDirectory: 'guides',
      ogOutputDirectory: join(root, 'docs', 'public', 'og'),
      owner: 'mnaoumov',
      packageName: '@mnaoumov/typescript-lib',
      packageVersion: '1.2.3',
      publicDirectory: join(root, 'docs', 'public'),
      repo: 'typescript-lib',
      repoHomepage: 'off',
      rootDirectory: root,
      siteBaseUrl: 'https://mnaoumov.dev/typescript-lib/',
      siteOrigin: 'https://mnaoumov.dev',
      sourceDirectory: join(root, 'src'),
      title: 'TypeScript Lib'
    });
  });

  it('honors every override', () => {
    const root = createRoot({ name: 'pkg', version: '0.0.1' });
    const externalTypeLinks = new Map([['App', 'https://example.com/app']]);
    const packageSites = new Map([['other', 'https://example.com/other/']]);
    const excludedDirectories = ['internal'];
    const genericTypeParameters = ['TMock'];
    function importStatement({ name }: ImportStatementContext): string {
      return name;
    }
    function memberRouteSegment(name: string): string {
      return name;
    }

    const resolved = resolveDocsSiteConfig({
      docsDirectory: 'site',
      excludedDirectories,
      externalTypeLinks,
      genericTypeParameters,
      guidesDirectory: 'manual',
      importStatement,
      memberRouteSegment,
      owner: 'someone',
      packageSites,
      repo: 'pkg',
      repoHomepage: 'set',
      rootDirectory: root,
      siteOrigin: 'https://example.com',
      sourceDirectory: 'lib',
      title: 'Pkg'
    });

    expect(resolved.docsDirectory).toBe(join(root, 'site'));
    expect(resolved.apiDocSettings.externalTypeLinks).toBe(externalTypeLinks);
    expect(resolved.apiDocSettings.excludedDirectories).toBe(excludedDirectories);
    expect(resolved.apiDocSettings.genericTypeParameters).toBe(genericTypeParameters);
    expect(resolved.apiDocSettings.importStatement).toBe(importStatement);
    expect(resolved.apiDocSettings.memberRouteSegment).toBe(memberRouteSegment);
    expect(resolved.guidesDirectory).toBe('manual');
    expect(resolved.githubUrl).toBe('https://github.com/someone/pkg');
    expect(resolved.owner).toBe('someone');
    expect(resolved.repoHomepage).toBe('set');
    expect(resolved.apiDocSettings.packageSites).toBe(packageSites);
    expect(resolved.siteBaseUrl).toBe('https://example.com/pkg/');
    expect(resolved.sourceDirectory).toBe(join(root, 'lib'));
  });

  it('defaults the root to the working directory', () => {
    expect(resolveDocsSiteConfig({ repo: 'typescript-dev-toolkit', title: 'T' }).rootDirectory).toBe(process.cwd());
  });

  it('refuses a package.json without a name or a version', () => {
    expect(() => resolveDocsSiteConfig({ repo: 'x', rootDirectory: createRoot({ name: 'x' }), title: 'X' })).toThrow('has no name or no version');
    expect(() => resolveDocsSiteConfig({ repo: 'x', rootDirectory: createRoot({ version: '1.0.0' }), title: 'X' })).toThrow('has no name or no version');
  });
});
