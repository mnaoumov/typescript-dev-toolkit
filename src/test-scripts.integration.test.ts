import { spawnSync } from 'node:child_process';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

// This repository's own `npm test` entry, run for real: the CLI arguments after the script must reach vitest, which a
// mocked `execFromRoot` cannot show. Until they did, `npm test -- <file> --maxWorkers=2` ran the whole suite.
const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JITI_CLI = join(REPOSITORY_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-cli.mjs');
const RUN_TIMEOUT_IN_MILLISECONDS = 120_000;

interface TestScriptResult {
  readonly exitCode: null | number;
  readonly output: string;
}

function runTestScript(scriptArguments: string[]): TestScriptResult {
  const result = spawnSync(process.execPath, [JITI_CLI, 'scripts/test.ts', ...scriptArguments], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  return { exitCode: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('scripts/test.ts', () => {
  it('forwards a file filter and runner options to vitest', () => {
    const { exitCode, output } = runTestScript(['src/test-runners/auto.test.ts', '--maxWorkers=1']);
    expect(output).toContain('src/test-runners/auto.test.ts');
    expect(output).toMatch(/Test Files\s+1 passed \(1\)/u);
    expect(exitCode).toBe(0);
  }, RUN_TIMEOUT_IN_MILLISECONDS);

  it('refuses a forwarded option the wrapper sets itself', () => {
    const { exitCode, output } = runTestScript(['--project=integration-tests']);
    expect(output).toContain('--project=integration-tests (use the `projects` option instead)');
    expect(exitCode).not.toBe(0);
  }, RUN_TIMEOUT_IN_MILLISECONDS);
});
