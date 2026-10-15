import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ExecResult } from './exec.ts';
import type { ResolveToolCommandParams } from './package-manager.ts';
import type { ResolvePathFromRootSafeParams } from './root.ts';

import {
  classifyEslintExit,
  describeFailureToLint,
  lint,
  LINT_PROBLEMS_MESSAGE
} from './linters/eslint.ts';

const {
  mockCp,
  mockExecFromRoot,
  mockExistsSync,
  mockResolvePathFromRootSafe,
  mockResolveToolCommand
} = vi.hoisted(() => ({
  mockCp: vi.fn(),
  mockExecFromRoot: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockResolvePathFromRootSafe: vi.fn<(params: ResolvePathFromRootSafeParams) => string>(),
  mockResolveToolCommand: vi.fn<(params: ResolveToolCommandParams) => string[]>()
}));

vi.mock('./root.ts', () => ({
  execFromRoot: mockExecFromRoot,
  resolvePathFromRootSafe: mockResolvePathFromRootSafe
}));

vi.mock('./package-manager.ts', () => ({
  resolveToolCommand: mockResolveToolCommand
}));

vi.mock('node:fs', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs')>();
  return {
    ...$module,
    existsSync: mockExistsSync
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const $module = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...$module,
    cp: mockCp
  };
});

vi.mock('@mnaoumov/typescript-lib/debug', () => ({
  getLibDebugger: vi.fn(() => vi.fn())
}));

/**
 * The real stderr of an ESLint rule crash, transcribed verbatim from an `npm run lint` that died inside
 * `no-empty` on an unchanged, lint-clean tree. The fixtures are real output rather than invented to suit the
 * extractor (only the linted file's path is neutralized): the `Oops!` banner is not crash-specific, and only real
 * output said so.
 */
const RULE_CRASH_STDERR = [
  '',
  'Oops! Something went wrong! :(',
  '',
  'ESLint: 10.7.0',
  '',
  'TypeError: Cannot read properties of undefined (reading \'length\')',
  String.raw`Occurred while linting F:\dev\projects\example\src\entities\bot-ai.ts:347`,
  'Rule: "no-empty"',
  '    at BlockStatement (node_modules/eslint/lib/rules/no-empty.js:60:19)',
  '    at ruleErrorHandler (node_modules/eslint/lib/linter/linter.js:645:33)',
  '    at Linter.verifyAndFix (node_modules/eslint/lib/linter/linter.js:1534:20)'
].join('\n');

/**
 * The real stderr of a mistyped path, transcribed from `npm run lint -- src/no-such-file.ts`. It carries the
 * SAME `Oops!` banner as the rule crash above.
 */
const USAGE_ERROR_STDERR = [
  '',
  'Oops! Something went wrong! :(',
  '',
  'ESLint: 10.7.0',
  '',
  'No files matching the pattern "src/no-such-file.ts" were found.',
  'Please check for typing mistakes in the pattern.'
].join('\n');

/**
 * `0xC0000005`, the access violation the ESLint child raises on Windows with no output of its own. It cannot
 * be triggered on demand, so it is pinned by its exit code alone.
 */
const ACCESS_VIOLATION_EXIT_CODE = 3_221_225_477;

beforeEach(() => {
  vi.resetAllMocks();
  mockExecFromRoot.mockResolvedValue(makeResult({}));
  mockCp.mockResolvedValue(undefined);
  mockResolvePathFromRootSafe.mockImplementation((params: ResolvePathFromRootSafeParams) => `/root/${params.path}`);
  mockResolveToolCommand.mockImplementation((params: ResolveToolCommandParams) => [params.tool]);
});

describe('lint', () => {
  it('should run eslint when config file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint();
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['eslint', { batchedArguments: ['.'] }]),
      expect.anything()
    );
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('should pass --fix when shouldFix is true', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint({ shouldFix: true });
    expect(mockExecFromRoot).toHaveBeenCalledWith(
      expect.arrayContaining(['eslint', '--fix', { batchedArguments: ['.'] }]),
      expect.anything()
    );
  });

  it('should not pass --fix when shouldFix is false', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint({ shouldFix: false });
    const call = mockExecFromRoot.mock.calls[0] as string[][];
    expect(call[0]).not.toContain('--fix');
  });

  it('should make a warning fail the run, on the plain and the --fix run alike', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint();
    await lint({ shouldFix: true });
    expect(mockExecFromRoot.mock.calls[0]?.[0]).toEqual(['eslint', '--max-warnings', '0', '--no-warn-ignored', { batchedArguments: ['.'] }]);
    expect(mockExecFromRoot.mock.calls[1]?.[0]).toEqual(['eslint', '--max-warnings', '0', '--no-warn-ignored', '--fix', { batchedArguments: ['.'] }]);
  });

  it('should keep the warning flags out of the batched arguments, so every batch of a split command line gets them', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint({ paths: ['a.ts', 'b.ts'] });
    const [command] = mockExecFromRoot.mock.calls[0] as [unknown[]];
    expect(command.at(-1)).toEqual({ batchedArguments: ['a.ts', 'b.ts'] });
    expect(command.slice(0, -1)).toEqual(['eslint', '--max-warnings', '0', '--no-warn-ignored']);
  });

  it('should copy the default config it is given when no config file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    await lint({ defaultConfigFilePath: '/pkg/dist/templates/eslint.config.mts' });
    expect(mockCp).toHaveBeenCalledTimes(1);
    expect(mockCp).toHaveBeenCalledWith('/pkg/dist/templates/eslint.config.mts', '/root/eslint.config.mts');
    expect(mockExecFromRoot).toHaveBeenCalledTimes(1);
  });

  it('should run eslint without copying anything when no config file exists and no default is given', async () => {
    mockExistsSync.mockReturnValue(false);
    await lint();
    expect(mockCp).not.toHaveBeenCalled();
    expect(mockExecFromRoot).toHaveBeenCalledTimes(1);
  });

  it('should read the exit code itself rather than let the exec throw on it', async () => {
    mockExistsSync.mockReturnValue(true);
    await lint();
    expect(mockExecFromRoot.mock.calls[0]?.[1]).toEqual({ shouldIgnoreExitCode: true, shouldIncludeDetails: true });
  });

  it('should stay silent when ESLint found nothing of either kind', async () => {
    mockExistsSync.mockReturnValue(true);
    await expect(lint()).resolves.toBeUndefined();
  });

  it('should throw the findings message for the exit 1 that warnings alone produce', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFromRoot.mockResolvedValue(makeResult({
      exitCode: 1,
      stderr: 'ESLint found too many warnings (maximum: 0).',
      stdout: '  1:1  warning  `jsdoc` is a namespace import  import-x/no-named-as-default-member'
    }));
    await expect(lint()).rejects.toThrow(LINT_PROBLEMS_MESSAGE);
  });

  it('should throw a failure to lint, not findings, when a rule crashed', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFromRoot.mockResolvedValue(makeResult({ exitCode: 2, stderr: RULE_CRASH_STDERR }));
    await expect(lint()).rejects.toThrow('ESLint CRASHED');
  });
});

describe('classifyEslintExit', () => {
  it('reads exit 0 as a clean lint', () => {
    expect(classifyEslintExit(makeResult({ exitCode: 0 }))).toBe('clean');
  });

  it('reads exit 1 as findings about the source', () => {
    expect(classifyEslintExit(makeResult({ exitCode: 1, stdout: '  3:1  error  Unexpected var  no-var' }))).toBe('lint-problems');
  });

  it('reads a rule crash as did-not-lint, however it exited', () => {
    expect(classifyEslintExit(makeResult({ exitCode: 2, stderr: RULE_CRASH_STDERR }))).toBe('did-not-lint');
    expect(classifyEslintExit(makeResult({ exitCode: 1, stderr: RULE_CRASH_STDERR }))).toBe('did-not-lint');
  });

  it('reads a configuration or command-line failure as did-not-lint', () => {
    expect(classifyEslintExit(makeResult({ exitCode: 2, stderr: USAGE_ERROR_STDERR }))).toBe('did-not-lint');
  });

  it('reads an OS-level death as did-not-lint, not as findings', () => {
    expect(classifyEslintExit(makeResult({ exitCode: ACCESS_VIOLATION_EXIT_CODE }))).toBe('did-not-lint');
  });

  it('reads a killed process as did-not-lint even when its exit code is 0', () => {
    expect(classifyEslintExit(makeResult({ exitCode: 0, exitSignal: 'SIGKILL' }))).toBe('did-not-lint');
  });
});

describe('describeFailureToLint', () => {
  it('names a rule crash and quotes the version, the file and the rule', () => {
    const message = describeFailureToLint(makeResult({ exitCode: 2, stderr: RULE_CRASH_STDERR }));

    expect(message).toContain('ESLint CRASHED');
    expect(message).toContain('ESLint: 10.7.0');
    expect(message).toContain('Occurred while linting');
    expect(message).toContain('Rule: "no-empty"');
    expect(message).toContain('TypeError: Cannot read properties of undefined (reading \'length\')');
  });

  it('never claims a crash is a lint finding', () => {
    const message = describeFailureToLint(makeResult({ exitCode: 2, stderr: RULE_CRASH_STDERR }));

    expect(message).toContain('NOT a lint finding');
    expect(message).not.toContain(LINT_PROBLEMS_MESSAGE);
    expect(LINT_PROBLEMS_MESSAGE).not.toContain('NOT a lint finding');
  });

  it('spells an NT status exit code in hex and says nothing was printed', () => {
    const message = describeFailureToLint(makeResult({ exitCode: ACCESS_VIOLATION_EXIT_CODE }));

    expect(message).toContain('DIED at the OS level');
    expect(message).toContain('3221225477 (0xC0000005)');
    expect(message).toContain('printed no diagnostic at all');
  });

  it('separates a mistyped path from a rule crash, though both carry the banner', () => {
    const message = describeFailureToLint(makeResult({ exitCode: 2, stderr: USAGE_ERROR_STDERR }));

    expect(message).toContain('ESLint ABORTED');
    expect(message).not.toContain('CRASHED');
    expect(message).toContain('No files matching the pattern "src/no-such-file.ts" were found.');
    expect(message).toContain('exit code: 2');
    expect(message).not.toContain('0x');
  });

  it('says a bare non-zero exit with no banner did not finish linting', () => {
    const message = describeFailureToLint(makeResult({ exitCode: 3, stderr: 'something else' }));

    expect(message).toContain('exited non-zero without reporting findings');
    expect(message).toContain('something else');
  });

  it('quotes no stack frames, banner or npm chatter back', () => {
    const message = describeFailureToLint(makeResult({
      exitCode: 2,
      stderr: `npm notice run eslint .\n${RULE_CRASH_STDERR}`
    }));

    expect(message).not.toContain('npm notice');
    expect(message).not.toContain('Oops!');
    expect(message).not.toContain('node_modules/eslint/lib/rules/no-empty.js');
  });

  it('names the signal when the process was terminated', () => {
    const message = describeFailureToLint(makeResult({ exitCode: null, exitSignal: 'SIGTERM' }));

    expect(message).toContain('KILLED');
    expect(message).toContain('terminated by signal: SIGTERM');
    expect(message).toContain('the process was terminated before it could exit');
  });

  it('caps how much of the stderr it quotes back, and quotes a repeated line once', () => {
    const noisy = Array.from({ length: 50 }, (_, index) => `Rule: "rule-${String(index)}"`).join('\n');
    const message = describeFailureToLint(makeResult({ exitCode: 2, stderr: `Oops! Something went wrong! :(\nRule: "rule-0"\n${noisy}` }));

    expect(message).toContain('Rule: "rule-0"');
    expect(message.split('Rule: "rule-0"')).toHaveLength(2);
    expect(message).not.toContain('Rule: "rule-6"');
  });
});

/**
 * Builds one `ExecResult` over the clean default, so each test names only the field it is about.
 *
 * @param overrides - The fields this case is about.
 * @returns A complete result to classify.
 */
function makeResult(overrides: Partial<ExecResult>): ExecResult {
  return {
    exitCode: 0,
    exitSignal: null,
    stderr: '',
    stdout: '',
    ...overrides
  };
}
