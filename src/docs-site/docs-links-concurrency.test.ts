import type { Dirent } from 'node:fs';

import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { assertDocsLinksResolve } from './docs-links.ts';

const outputDirectory = resolve('site');

vi.mock('node:fs/promises', () => ({
  readdir: (): Pick<Dirent, 'isFile' | 'name' | 'parentPath'>[] => [{ isFile: (): boolean => true, name: 'index.html', parentPath: resolve('site') }],
  readFile: (): string => Array.from({ length: 6 }, (_, index) => `<a href="https://host${String(index)}.example/a">link</a>`).join('')
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('site probe concurrency', () => {
  it.each([['1', 1], ['2', 2], [undefined, 6], ['bad', 6]])('limits active probes for budget %s and checks every URL', async (budget, expected) => {
    vi.stubEnv('BULK_CORES', budget);
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await setImmediate();
      active--;
      return { body: null, headers: new Headers(), status: 200 };
    });
    vi.stubGlobal('fetch', fetchMock);
    await assertDocsLinksResolve({ outputDirectory, siteBaseUrl: 'https://site.example/' });
    expect(peak).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
