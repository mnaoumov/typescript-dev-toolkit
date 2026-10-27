import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getBulkConcurrency } from './bulk-concurrency.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getBulkConcurrency', () => {
  it.each([undefined, '', ' ', '0', '-2', '1.5', '2x', 'Infinity', '9007199254740992'])('keeps the default for invalid budget %s', (budget) => {
    vi.stubEnv('BULK_CORES', budget);
    expect(getBulkConcurrency(10)).toBe(10);
  });

  it.each([['1', 1], ['2', 2], [' 2 ', 2], ['20', 10]])('caps the default for budget %s', (budget, expected) => {
    vi.stubEnv('BULK_CORES', budget);
    expect(getBulkConcurrency(10)).toBe(expected);
  });

  it('reads the budget at invocation time', () => {
    vi.stubEnv('BULK_CORES', '1');
    expect(getBulkConcurrency(20)).toBe(1);
    vi.stubEnv('BULK_CORES', '2');
    expect(getBulkConcurrency(20)).toBe(2);
  });
});
