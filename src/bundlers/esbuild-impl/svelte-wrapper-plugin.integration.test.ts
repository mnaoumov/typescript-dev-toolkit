/**
 * @file
 *
 * Integration tests for {@link svelteWrapperPlugin} in a real esbuild build with the real `esbuild-svelte` and `svelte`.
 *
 * The component uses what the Svelte compiler cannot read without the TypeScript preprocessor: an `enum`, annotations,
 * a type import, and a value import that only the markup uses, which a preprocessor that drops unused imports would lose.
 * This repository does not install `svelte-preprocess`, so the `<style lang="scss">` case is the one a consumer without it
 * meets.
 *
 * `svelte` is external, so the output holds the compiled component alone.
 */

import type { BuildResult } from 'esbuild';

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  join,
  resolve
} from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

import { svelteWrapperPlugin } from './svelte-wrapper-plugin.ts';

const COMPONENT = `<script lang="ts">
  import type { Greeting } from './greeting.ts';
  import { shout } from './shout.ts';

  enum Mood { Calm, Loud }

  let { name }: Greeting = $props();
  const mood: Mood = Mood.Loud;
</script>

<p>{mood === Mood.Loud ? shout(name) : name}</p>
`;

let fixtureDirectory = '';

interface InMemoryBuildOptions {
  readonly write: false;
}

async function buildComponent(fileName: string): Promise<BuildResult<InMemoryBuildOptions>> {
  return await build({
    // eslint-disable-next-line unicorn/name-replacements -- esbuild's own option name.
    absWorkingDir: fixtureDirectory,
    bundle: true,
    entryPoints: [fileName],
    external: ['svelte', 'svelte/*'],
    format: 'esm',
    logLevel: 'silent',
    nodePaths: [resolve(process.cwd(), 'node_modules')],
    platform: 'browser',
    plugins: [svelteWrapperPlugin(true)],
    write: false
  });
}

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'svelte-wrapper-plugin-'));
  writeFileSync(join(fixtureDirectory, 'greeting.ts'), 'export interface Greeting { name: string }\n');
  writeFileSync(join(fixtureDirectory, 'shout.ts'), 'export function shout(text: string): string { return text.toUpperCase(); }\n');
  writeFileSync(join(fixtureDirectory, 'Component.svelte'), COMPONENT);
  writeFileSync(join(fixtureDirectory, 'Styled.svelte'), '<p>styled</p>\n\n<style lang="scss">\n  $color: red;\n  p { color: $color; }\n</style>\n');
});

afterAll(() => {
  rmSync(fixtureDirectory, { force: true, recursive: true });
});

describe('svelteWrapperPlugin', () => {
  it('compiles a TypeScript component, keeping the import only its markup uses', async () => {
    const result = await buildComponent('Component.svelte');
    const code = result.outputFiles[0]?.text ?? '';
    expect(result.errors).toEqual([]);
    expect(code).toContain('function shout(text)');
    expect(code).toContain('shout($$props.name)');
    expect(code).toContain('Mood2[Mood2["Loud"] = 1] = "Loud";');
    expect(code).not.toContain('Greeting');
  });

  /*
   * Under Vitest the import of a missing package fails with Vite's own `Could not resolve` message, so the build runs in a
   * child Node process, where it fails as it does for a consumer.
   */
  it('fails a style language other than CSS, naming svelte-preprocess', () => {
    const repoRoot = process.cwd();
    const scriptPath = join(fixtureDirectory, 'build-styled.ts');
    writeFileSync(
      scriptPath,
      `import { build } from 'esbuild';
import { svelteWrapperPlugin } from ${JSON.stringify(pathToFileURL(resolve(repoRoot, 'src/bundlers/esbuild-impl/svelte-wrapper-plugin.ts')).href)};

await build({
  absWorkingDir: ${JSON.stringify(fixtureDirectory)},
  bundle: true,
  entryPoints: ['Styled.svelte'],
  external: ['svelte', 'svelte/*'],
  format: 'esm',
  logLevel: 'silent',
  platform: 'browser',
  plugins: [svelteWrapperPlugin(true)],
  write: false
});
`
    );
    const result = spawnSync(process.execPath, [resolve(repoRoot, 'node_modules/jiti/lib/jiti-cli.mjs'), scriptPath], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, NODE_PATH: resolve(repoRoot, 'node_modules') }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Styled.svelte: install `svelte-preprocess` in the project to compile scss.');
  });
});
