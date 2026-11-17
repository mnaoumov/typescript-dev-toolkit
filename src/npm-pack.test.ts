import {
  describe,
  expect,
  it
} from 'vitest';

import { parseNpmPackOutput } from './npm-pack.ts';

describe('parseNpmPackOutput', () => {
  it('reads the array npm 11 prints', () => {
    expect(parseNpmPackOutput(JSON.stringify([{ filename: 'library-1.0.0.tgz' }], null, 2))).toEqual({ filename: 'library-1.0.0.tgz' });
  });

  it('reads the object npm 12 prints, after whatever the prepare script printed, braces included', () => {
    const output = `> library@1.0.0 prepare\nhusky - { not json }\n${JSON.stringify({ library: { filename: 'library-1.0.0.tgz' } }, null, 2)}`;
    expect(parseNpmPackOutput(output)).toEqual({ filename: 'library-1.0.0.tgz' });
  });

  it('throws when there is no payload, or the payload holds no result', () => {
    expect(() => parseNpmPackOutput('npm error code E404')).toThrow('Failed to find the JSON payload in the `npm pack --json` output');
    expect(() => parseNpmPackOutput('[]')).toThrow('Found no pack result in the `npm pack --json` output');
  });
});
