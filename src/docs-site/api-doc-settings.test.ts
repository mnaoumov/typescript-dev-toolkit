import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

describe('api-doc settings', () => {
  it('refuses to be read before it is configured, and returns what was configured', async () => {
    vi.resetModules();
    const { configureApiDocs, getApiDocSettings } = await import('./api-doc-settings.ts');

    expect(() => getApiDocSettings()).toThrow('call configureApiDocs() first');

    const settings = {
      basePath: '/x',
      externalTypeLinks: new Map<string, string>(),
      outputDirectory: '/out',
      packageName: 'x',
      packageSites: new Map<string, string>(),
      sidebarFile: '/sidebar.json'
    };
    configureApiDocs(settings);
    expect(getApiDocSettings()).toBe(settings);
  });
});
