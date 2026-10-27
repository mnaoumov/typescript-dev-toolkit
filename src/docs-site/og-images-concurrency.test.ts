import type { Dirent } from 'node:fs';

import { setImmediate } from 'node:timers/promises';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { generateOgImages } from './og-images.ts';

const { render, write } = vi.hoisted(() => ({ render: vi.fn<() => Promise<Buffer>>(), write: vi.fn() }));

vi.mock('node:fs', () => ({ existsSync: (path: string): boolean => path === '/content' }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: (): Pick<Dirent, 'isDirectory' | 'name'>[] => Array.from({ length: 6 }, (_, index) => ({ isDirectory: (): boolean => false, name: `${String(index)}.md` })),
  readFile: (): string => '---\ntitle: Card\n---',
  writeFile: write
}));
vi.mock('./og-image.ts', () => ({
  computeOgHash: (): string => 'hash',
  loadFonts: (): object[] => [{}],
  loadLogoDataUri: (): null => null,
  renderOgImage: render
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('OG rendering concurrency', () => {
  it.each([['1', 1], ['2', 2], [undefined, 6], ['bad', 6]])('limits active renders for budget %s and writes every card', async (budget, expected) => {
    vi.stubEnv('BULK_CORES', budget);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let active = 0;
    let peak = 0;
    render.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await setImmediate();
      active--;
      return Buffer.from('image');
    });
    await generateOgImages({
      brandText: 'Brand',
      contentDocsDirectory: '/content',
      faviconPath: '/favicon.svg',
      fontsDirectory: '/fonts',
      outputDirectory: '/og'
    });
    expect(peak).toBe(expected);
    expect(render).toHaveBeenCalledTimes(6);
    expect(write.mock.calls.filter(([path]) => String(path).endsWith('.png'))).toHaveLength(6);
    expect(write).toHaveBeenCalledWith('/og/.cache-manifest.json', expect.stringContaining('"logoHash": ""'));
  });
});
