import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  detectLinter,
  lint
} from './auto.ts';

const {
  mockHasBiomeConfig,
  mockHasEslintConfig,
  mockLintWithBiome,
  mockLintWithEslint
} = vi.hoisted(() => ({
  mockHasBiomeConfig: vi.fn<() => boolean>(),
  mockHasEslintConfig: vi.fn<() => boolean>(),
  mockLintWithBiome: vi.fn(),
  mockLintWithEslint: vi.fn()
}));

vi.mock('../formatters/biome.ts', () => ({
  hasBiomeConfig: mockHasBiomeConfig
}));

vi.mock('./biome.ts', () => ({
  lint: mockLintWithBiome
}));

vi.mock('./eslint.ts', () => ({
  hasEslintConfig: mockHasEslintConfig,
  lint: mockLintWithEslint
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockHasBiomeConfig.mockReturnValue(false);
  mockHasEslintConfig.mockReturnValue(false);
});

describe('detectLinter', () => {
  it('should prefer an ESLint configuration over Biome', () => {
    mockHasEslintConfig.mockReturnValue(true);
    mockHasBiomeConfig.mockReturnValue(true);
    expect(detectLinter()).toBe('eslint');
  });

  it('should pick Biome', () => {
    mockHasBiomeConfig.mockReturnValue(true);
    expect(detectLinter()).toBe('biome');
  });

  it('should fall back to ESLint', () => {
    expect(detectLinter()).toBe('eslint');
  });
});

describe('lint', () => {
  it('should run the detected linter with the options', async () => {
    mockHasBiomeConfig.mockReturnValue(true);
    await lint({ paths: ['a.ts'], shouldFix: true });
    expect(mockLintWithBiome).toHaveBeenCalledWith({ paths: ['a.ts'], shouldFix: true });
  });

  it('should run the linter it is told to', async () => {
    mockHasBiomeConfig.mockReturnValue(true);
    await lint({ linter: 'eslint' });
    expect(mockLintWithEslint).toHaveBeenCalledWith({});
  });

  it('should run ESLint without options', async () => {
    await lint();
    expect(mockLintWithEslint).toHaveBeenCalledWith({});
  });
});
