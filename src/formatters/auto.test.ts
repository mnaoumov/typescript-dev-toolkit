import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvePathFromRootSafeParams } from '../root.ts';

import {
  detectFormatter,
  format
} from './auto.ts';

const {
  mockExistsSync,
  mockFormatWithBiome,
  mockFormatWithDprint,
  mockFormatWithPrettier,
  mockHasBiomeConfig,
  mockHasPrettierConfig
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockFormatWithBiome: vi.fn(),
  mockFormatWithDprint: vi.fn(),
  mockFormatWithPrettier: vi.fn(),
  mockHasBiomeConfig: vi.fn<() => boolean>(),
  mockHasPrettierConfig: vi.fn<() => Promise<boolean>>()
}));

vi.mock('../root.ts', () => ({
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('./biome.ts', () => ({
  format: mockFormatWithBiome,
  hasBiomeConfig: mockHasBiomeConfig
}));

vi.mock('./dprint.ts', () => ({
  format: mockFormatWithDprint
}));

vi.mock('./prettier.ts', () => ({
  format: mockFormatWithPrettier,
  hasPrettierConfig: mockHasPrettierConfig
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockHasBiomeConfig.mockReturnValue(false);
  mockHasPrettierConfig.mockResolvedValue(false);
});

describe('detectFormatter', () => {
  it('should prefer dprint.json over every other configuration', async () => {
    mockExistsSync.mockImplementation((path: string) => path === '/root/dprint.json');
    mockHasPrettierConfig.mockResolvedValue(true);
    mockHasBiomeConfig.mockReturnValue(true);
    expect(await detectFormatter()).toBe('dprint');
  });

  it('should prefer Prettier over Biome', async () => {
    mockHasPrettierConfig.mockResolvedValue(true);
    mockHasBiomeConfig.mockReturnValue(true);
    expect(await detectFormatter()).toBe('prettier');
  });

  it('should pick Biome', async () => {
    mockHasBiomeConfig.mockReturnValue(true);
    expect(await detectFormatter()).toBe('biome');
  });

  it('should fall back to dprint', async () => {
    expect(await detectFormatter()).toBe('dprint');
  });
});

describe('format', () => {
  it('should run the detected formatter with the options', async () => {
    mockHasBiomeConfig.mockReturnValue(true);
    await format({ paths: ['a.ts'], rewrite: false });
    expect(mockFormatWithBiome).toHaveBeenCalledWith({ paths: ['a.ts'], rewrite: false });
  });

  it('should run the formatter it is told to', async () => {
    mockHasBiomeConfig.mockReturnValue(true);
    await format({ formatter: 'prettier' });
    expect(mockFormatWithPrettier).toHaveBeenCalledWith({});
    expect(mockFormatWithBiome).not.toHaveBeenCalled();
  });

  it('should run dprint without options', async () => {
    await format();
    expect(mockFormatWithDprint).toHaveBeenCalledWith({});
  });
});
