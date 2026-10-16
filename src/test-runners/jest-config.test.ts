import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolvePathFromRootSafeParams } from '../root.ts';

import {
  defineJestConfig,
  isEsmPackage,
  JEST_TYPESCRIPT_TRANSFORM_PATTERN
} from './jest-config.ts';

const {
  mockExistsSync,
  mockReadPackageJsonSync
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadPackageJsonSync: vi.fn<() => PackageJsonStub>()
}));

interface PackageJsonStub {
  readonly type?: string;
}

vi.mock('../root.ts', () => ({
  resolvePathFromRootSafe: (params: ResolvePathFromRootSafeParams): string => `/root/${params.path}`
}));

vi.mock('../npm.ts', () => ({
  readPackageJsonSync: mockReadPackageJsonSync
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
  mockExistsSync.mockReturnValue(true);
  mockReadPackageJsonSync.mockReturnValue({ type: 'module' });
});

describe('isEsmPackage', () => {
  it('should be true for a package declaring "type": "module"', () => {
    expect(isEsmPackage()).toBe(true);
  });

  it('should be false for a CommonJS package', () => {
    mockReadPackageJsonSync.mockReturnValue({});
    expect(isEsmPackage()).toBe(false);
  });

  it('should be false without a package.json', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isEsmPackage()).toBe(false);
    expect(mockReadPackageJsonSync).not.toHaveBeenCalled();
  });
});

describe('defineJestConfig', () => {
  it('should configure an ESM package by default', () => {
    expect(defineJestConfig()).toEqual({
      collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/@types/**',
        '!src/**/index.ts',
        '!src/**/*.d.ts',
        '!src/**/*.test.ts',
        '!src/test-helpers/**'
      ],
      coverageDirectory: './coverage',
      coverageProvider: 'v8',
      coverageReporters: ['text', 'lcov', 'html'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
      },
      roots: ['<rootDir>/src'],
      testEnvironment: 'node',
      testMatch: ['**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/'],
      transform: {
        [JEST_TYPESCRIPT_TRANSFORM_PATTERN]: ['ts-jest', { tsconfig: { isolatedModules: true }, useESM: true }]
      }
    });
  });

  it('should configure a CommonJS package without the ESM settings', () => {
    mockReadPackageJsonSync.mockReturnValue({});
    const config = defineJestConfig();
    expect(config.extensionsToTreatAsEsm).toEqual([]);
    expect(config.transform).toEqual({
      [JEST_TYPESCRIPT_TRANSFORM_PATTERN]: ['ts-jest', { tsconfig: { isolatedModules: true }, useESM: false }]
    });
  });

  it('should let esm override the package type', () => {
    const config = defineJestConfig({ esm: false });
    expect(config.extensionsToTreatAsEsm).toEqual([]);
    expect(mockReadPackageJsonSync).not.toHaveBeenCalled();
  });

  it('should spread tsJestOptions over the transform defaults', () => {
    const config = defineJestConfig({ tsJestOptions: { diagnostics: false, tsconfig: 'tsconfig.test.json' } });
    expect(config.transform).toEqual({
      [JEST_TYPESCRIPT_TRANSFORM_PATTERN]: ['ts-jest', { diagnostics: false, tsconfig: 'tsconfig.test.json', useESM: true }]
    });
  });

  it('should add moduleNameMapper entries to the .js mapper', () => {
    const config = defineJestConfig({ moduleNameMapper: { '^obsidian$': 'obsidian-test-mocks/obsidian' } });
    expect(config.moduleNameMapper).toEqual({
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^obsidian$': 'obsidian-test-mocks/obsidian'
    });
  });

  it('should let any other jest option replace its default', () => {
    const transform = { '^.+\\.tsx?$': 'babel-jest' };
    const config = defineJestConfig({ roots: ['<rootDir>'], setupFiles: ['./setup.ts'], testEnvironment: 'jsdom', transform });
    expect(config.roots).toEqual(['<rootDir>']);
    expect(config.setupFiles).toEqual(['./setup.ts']);
    expect(config.testEnvironment).toBe('jsdom');
    expect(config.transform).toBe(transform);
  });
});
