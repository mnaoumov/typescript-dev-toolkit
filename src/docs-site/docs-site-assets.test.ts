import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import { getDocsSiteAssetsDirectory } from './docs-site-assets.ts';

describe('getDocsSiteAssetsDirectory', () => {
  it('finds the shipped assets above this module', () => {
    const directory = getDocsSiteAssetsDirectory();

    expect(directory).toBe(join(import.meta.dirname, '..', '..', 'assets', 'docs-site'));
    expect(existsSync(join(directory, 'components', 'TypeSignature.astro'))).toBe(true);
    expect(existsSync(join(directory, 'fonts', 'inter-latin-400-normal.ttf'))).toBe(true);
  });

  it('throws when no folder above the module holds them', () => {
    const outside = pathToFileURL(join(join(import.meta.dirname, '..', '..', '..'), 'nowhere', 'module.mjs')).href;

    expect(() => getDocsSiteAssetsDirectory(outside)).toThrow('No assets');
  });
});
