import {
  describe,
  expect,
  it
} from 'vitest';

import { exec } from './exec.ts';

const STDIN_SIZE_IN_BYTES = 16 * 1024 * 1024;
const ATTEMPT_COUNT = 5;

describe('exec with a real child', () => {
  it('should survive a child that exits before reading a large stdin', async () => {
    // 16 MiB is far beyond any pipe buffer, so the write is still pending when `node -e ""` exits and the pipe closes, failing with
    // `EPIPE` (POSIX) or `EOF` (Windows) on every attempt.
    const stdin = 'x'.repeat(STDIN_SIZE_IN_BYTES);
    for (let attempt = 0; attempt < ATTEMPT_COUNT; attempt++) {
      await expect(exec(['node', '-e', ''], { isQuiet: true, stdin })).resolves.toBe('');
    }
  });
});
