import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ResolveToolCommandParams } from '../package-manager.ts';

import { lint } from './biome.ts';

const {
  mockEnsureBiomeConfig,
  mockExecFromRoot
} = vi.hoisted(() => ({
  mockEnsureBiomeConfig: vi.fn(),
  mockExecFromRoot: vi.fn()
}));

vi.mock('../root.ts', () => ({
  execFromRoot: mockExecFromRoot
}));

vi.mock('../package-manager.ts', () => ({
  resolveToolCommand: (params: ResolveToolCommandParams): string[] => [params.tool]
}));

vi.mock('../formatters/biome.ts', () => ({
  BIOME_EXPLICIT_PATHS_ARGUMENTS: ['--files-ignore-unknown=true', '--no-errors-on-unmatched'],
  ensureBiomeConfig: mockEnsureBiomeConfig
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue('');
});

describe('lint', () => {
  it('should lint the whole project with warnings as errors', async () => {
    await lint();
    expect(mockEnsureBiomeConfig).toHaveBeenCalledWith({ defaultConfigFilePath: undefined });
    expect(mockExecFromRoot).toHaveBeenCalledWith(['biome', 'lint', '--error-on-warnings', { batchedArguments: ['.'] }]);
  });

  it('should fix the given paths', async () => {
    await lint({ defaultConfigFilePath: '/consumer/biome.json', paths: ['src/a.ts'], shouldFix: true });
    expect(mockEnsureBiomeConfig).toHaveBeenCalledWith({ defaultConfigFilePath: '/consumer/biome.json' });
    expect(mockExecFromRoot).toHaveBeenCalledWith([
      'biome',
      'lint',
      '--error-on-warnings',
      '--write',
      '--files-ignore-unknown=true',
      '--no-errors-on-unmatched',
      { batchedArguments: ['src/a.ts'] }
    ]);
  });
});
