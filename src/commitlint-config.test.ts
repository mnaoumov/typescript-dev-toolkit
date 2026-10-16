import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  commitlintConfig,
  // eslint-disable-next-line import-x/no-deprecated -- The deprecated alias is what is under test.
  obsidianDevUtilsConfig
} from './commitlint-config.ts';

describe('commitlintConfig', () => {
  it('should extend @commitlint/config-conventional by an absolute path, so a consumer need not declare it', () => {
    expect(commitlintConfig.extends).toHaveLength(1);
    const [extendedPath] = commitlintConfig.extends ?? [];
    expect(extendedPath).toBeDefined();
    expect(isAbsolute(extendedPath ?? '')).toBe(true);
    expect(existsSync(extendedPath ?? '')).toBe(true);
    expect((extendedPath ?? '').replaceAll('\\', '/')).toContain('/node_modules/@commitlint/config-conventional/');
  });

  it('should keep obsidianDevUtilsConfig as an alias of the same object', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated, import-x/no-deprecated -- The deprecated alias is what is under test.
    expect(obsidianDevUtilsConfig).toBe(commitlintConfig);
  });
});
