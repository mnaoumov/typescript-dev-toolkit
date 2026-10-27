import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  test,
  testCoverage
} from './test-runners/vitest.ts';

const REPOSITORY_NODE_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const RUN_TIMEOUT = 120_000;
let fixtureFolder = '';
let originalCwd = '';

beforeAll(() => {
  originalCwd = process.cwd();
  fixtureFolder = mkdtempSync(join(tmpdir(), 'vitest-workers-'));
  symlinkSync(REPOSITORY_NODE_MODULES, join(fixtureFolder, 'node_modules'), 'junction');
  writeFileSync(join(fixtureFolder, 'package.json'), JSON.stringify({ name: 'vitest-workers-fixture', type: 'module' }));
  mkdirSync(join(fixtureFolder, 'src'));
  writeFileSync(join(fixtureFolder, 'src/value.ts'), 'export const value = 1;\n');
  writeFileSync(
    join(fixtureFolder, 'src/value.test.ts'),
    `
import { expect, it } from 'vitest';
import { value } from './value.ts';
it('runs with the resolved cap', () => {
  expect(value).toBe(1);
  expect(process.env.VITEST_MAX_WORKERS).toBe('1');
});
`
  );
  process.chdir(fixtureFolder);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  process.chdir(originalCwd);
  unlinkSync(join(fixtureFolder, 'node_modules'));
  rmSync(fixtureFolder, { force: true, recursive: true });
});

describe('Vitest bulk workers', () => {
  it.each([['maxWorkers: 1', test], ['fileParallelism: false', testCoverage]])('preserves serial project configuration %s in real Vitest', async (serialOption, run) => {
    vi.stubEnv('BULK_CORES', '2');
    vi.stubEnv('VITEST_MAX_WORKERS', '8');
    writeFileSync(
      join(fixtureFolder, 'vitest.config.ts'),
      `
import { writeFileSync } from 'node:fs';
export default {
  test: {
    coverage: { provider: 'v8', include: ['src/value.ts'] },
    projects: [
      { test: { name: 'unit-tests', include: ['src/*.test.ts'], ${serialOption} } },
      { test: { name: 'unit-tests:other', include: ['src/*.test.ts'], maxWorkers: '100%', sequence: { groupOrder: 1 } } }
    ],
    reporters: [{ onInit(ctx) { writeFileSync('workers.json', JSON.stringify(ctx.projects.map(p => p.config.maxWorkers))); } }]
  }
};
`
    );
    await expect(run({ projects: ['unit-tests'] })).resolves.toBeUndefined();
    expect(JSON.parse(readFileSync(join(fixtureFolder, 'workers.json'), 'utf-8'))).toEqual([1, 1]);
    expect(process.env['VITEST_MAX_WORKERS']).toBe('8');
  }, RUN_TIMEOUT);
});
