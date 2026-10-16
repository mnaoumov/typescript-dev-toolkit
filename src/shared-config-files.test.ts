import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getSharedConfigFilePath,
  SharedConfigFile
} from './shared-config-files.ts';

describe('getSharedConfigFilePath', () => {
  it.each([SharedConfigFile.Biome, SharedConfigFile.Prettier])('should find %s and it should parse', (file) => {
    const path = getSharedConfigFilePath(file);
    expect(path.replaceAll('\\', '/')).toMatch(new RegExp(`/assets/${file.replace('.', String.raw`\.`)}$`));
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed).toBeTypeOf('object');
  });

  it('should throw when no folder above the module holds the file', () => {
    const moduleUrl = pathToFileURL(join(tmpdir(), 'no-assets', 'module.ts')).href;
    expect(() => getSharedConfigFilePath(SharedConfigFile.Biome, moduleUrl)).toThrow(/No assets\/biome\.json above/);
  });
});
