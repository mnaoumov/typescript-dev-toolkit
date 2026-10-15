/**
 * @file
 *
 * Linting utility for ESLint configuration with support for automatic fixing.
 *
 * This module provides a function to lint files based on the ESLint configuration defined in `eslint.config.ts`.
 * It can automatically fix linting issues if specified, and logs results to the console.
 *
 * It also keeps a crashed linter apart from a red codebase. Handing ESLint's exit code straight to
 * {@link execFromRoot} and letting it throw reports every non-zero code the same way -- `Command failed with
 * exit code N` -- which puts a rule that threw, a broken config and an OS-level death in the same bucket as
 * real findings. The reader then goes hunting for a defect in source code that was never judged at all.
 */

import { getLibDebugger } from '@mnaoumov/typescript-lib/debug';
import { basename } from '@mnaoumov/typescript-lib/path';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';

import type { ExecResult } from '../exec.ts';

import { resolveToolCommand } from '../package-manager.ts';
import { RepoPaths } from '../repo-paths.ts';
import {
  execFromRoot,
  resolvePathFromRootSafe
} from '../root.ts';

/**
 * The flags that make a WARNING count as a finding, passed on every run.
 *
 * ESLint exits `0` when a run reported warnings and no errors, so without `--max-warnings 0` the gate reads a
 * warning as a clean tree: `lint` prints it, returns success, and CI, the pre-commit hook and every sweep
 * agree the tree is clean. A warning that nothing ever fails on is a warning that stands for ever, and the
 * fleet has carried several that each needed a person rather than a gate to notice them.
 *
 * It is passed unconditionally and there is no option to raise it: a ceiling a repo can raise is a gate
 * somebody turns off. It is passed on the `--fix` runs too, because whatever is left after fixing is exactly
 * what the no-fix run would have judged, so the two cannot disagree about what counts. It is a static command
 * part rather than a batched argument, so every batch of a split command line carries it.
 *
 * `--no-warn-ignored` has to travel with it. The pre-commit hook hands ESLint explicit file lists, and ESLint
 * reports an explicitly passed, globally ignored path (a `templates/` file, say) as a WARNING rather than
 * skipping it. Under `--max-warnings 0` that warning alone would fail the commit, although it says nothing
 * about the code.
 */
const ESLINT_WARNINGS_AS_FINDINGS_ARGUMENTS: readonly string[] = ['--max-warnings', '0', '--no-warn-ignored'];

/**
 * What an ESLint run actually established.
 *
 * - `clean` -- it linted everything and found nothing, warnings included: see
 *   {@link ESLINT_WARNINGS_AS_FINDINGS_ARGUMENTS} for what makes the "included" half true.
 * - `lint-problems` -- it linted everything and the SOURCE is red.
 * - `did-not-lint` -- it never got through the lint, so the source has not been judged at all.
 */
export type EslintExitKind = 'clean' | 'did-not-lint' | 'lint-problems';

/**
 * The message thrown for real findings, kept apart from {@link describeFailureToLint}'s.
 */
export const LINT_PROBLEMS_MESSAGE = 'ESLint reported lint problems. The findings are printed above.';

/**
 * ESLint's exit-code contract: `0` is clean, `1` means it finished and reported lint problems, and every
 * other code means it never finished linting at all -- a rule threw, the config is broken, or the OS killed
 * the process. Only `1` is evidence about the source; the rest are evidence about the linter, and a caller
 * that reads them as findings goes hunting for a defect that is not there.
 *
 * `0` is only as strong as {@link ESLINT_WARNINGS_AS_FINDINGS_ARGUMENTS} makes it: on its own ESLint exits `0`
 * for a run that reported WARNINGS and no errors, which this would read as `clean`.
 *
 * @see {@link https://eslint.org/docs/latest/use/command-line-interface#exit-codes}
 */
const ESLINT_EXIT_CODE_CLEAN = 0;

const ESLINT_EXIT_CODE_LINT_PROBLEMS = 1;

/**
 * The banner ESLint's fatal-error handler writes to stderr before exiting. It is NOT crash-specific: ESLint
 * prints it for a mistyped path and a broken config just as readily as for a rule that threw, so it answers
 * "ESLint threw instead of finishing" and nothing finer. {@link RULE_CRASH_REG_EXP} is what separates the
 * rule crash out of that set.
 */
const ESLINT_ABORT_BANNER = 'Oops! Something went wrong!';

/**
 * ESLint names the offending rule on its own line, and only when a RULE is what threw.
 */
const RULE_CRASH_REG_EXP = /^Rule: "/m;

/**
 * The npm chatter that shares the child's stderr and says nothing about why the lint failed.
 */
const NPM_NOTICE_PREFIX = 'npm notice';

/**
 * A stack frame in ESLint's own output -- the lines above it say what happened, these say only where.
 */
const STACK_FRAME_REG_EXP = /^at\s/;

const MAX_FAILURE_DETAIL_LINES = 6;

/**
 * Exit codes at or above this are Windows NT status values rather than ordinary process exit codes --
 * notably `3221225477` (`0xC0000005`, an access violation). The ESLint child really does die that way on
 * Windows (measured at 1 run in 30 on an unchanged, lint-clean tree), and npm then reports it to its own
 * caller as a plain exit `1` -- which is indistinguishable from "the code is red" unless something says
 * otherwise. That is what {@link describeFailureToLint} is for.
 */
const MIN_NT_STATUS_EXIT_CODE = 0x1_00_00;

const HEX_RADIX = 16;

/**
 * Parameters for the {@link lint} function.
 */
export interface LintOptions {
  /**
   * The configuration file copied to the project root when the project has none. Without it, ESLint runs
   * against whatever it finds, and reports a missing configuration itself.
   */
  readonly defaultConfigFilePath?: string | undefined;

  /**
   * Optional file paths to lint. If omitted, lints the entire project.
   */
  readonly paths?: string[] | undefined;

  /**
   * Whether to fix linting issues automatically.
   *
   * @default `false`
   */
  readonly shouldFix?: boolean | undefined;
}

/**
 * Decides which of the three things an ESLint run established.
 *
 * A killed process is `did-not-lint` whatever its exit code says, because a signal means it was stopped
 * rather than that it finished. An exit `1` carrying ESLint's fatal-error banner is `did-not-lint` too: that
 * is a crash npm relayed as a plain `1`, not a finding.
 *
 * @param result - What the ESLint child did.
 * @returns The kind of ending it was.
 */
export function classifyEslintExit(result: ExecResult): EslintExitKind {
  if (result.exitCode === ESLINT_EXIT_CODE_CLEAN && result.exitSignal === null) {
    return 'clean';
  }

  return result.exitCode === ESLINT_EXIT_CODE_LINT_PROBLEMS && !result.stderr.includes(ESLINT_ABORT_BANNER)
    ? 'lint-problems'
    : 'did-not-lint';
}

/**
 * Says which of the four failures to lint happened, and quotes back what ESLint said about it.
 *
 * @param result - What the ESLint child did.
 * @returns The message to throw, which says outright that it is not a finding about the source.
 */
export function describeFailureToLint(result: ExecResult): string {
  const details = extractFailureDetails(result.stderr);

  return [
    getFailureHeadline(result),
    'This is NOT a lint finding: the source code has not been judged, so do not go looking for a defect in it.',
    'Re-run the command. Only if it reproduces is there something to fix, and the thing to fix is the linter.',
    `  exit code: ${formatExitCode(result.exitCode)}`,
    ...result.exitSignal === null ? [] : [`  terminated by signal: ${result.exitSignal}`],
    details.length > 0 ? '  ESLint said:' : '  ESLint printed no diagnostic at all.',
    ...details.map((detail) => `    ${detail}`)
  ].join('\n');
}

/**
 * Lint the project with ESLint.
 *
 * @param options - The {@link LintOptions}.
 * @throws An `Error` carrying {@link LINT_PROBLEMS_MESSAGE} when the source is red, and
 * {@link describeFailureToLint}'s message when ESLint never finished linting at all.
 */
export async function lint(options?: LintOptions): Promise<void> {
  const { defaultConfigFilePath, paths, shouldFix } = options ?? {};
  const configFiles = [
    RepoPaths.EslintConfigJs,
    RepoPaths.EslintConfigMjs,
    RepoPaths.EslintConfigCjs,
    RepoPaths.EslintConfigTs,
    RepoPaths.EslintConfigMts,
    RepoPaths.EslintConfigCts
  ];

  const doesConfigFileExist = configFiles.some((configFile) => {
    const configFilePath = resolvePathFromRootSafe({ path: configFile });
    return existsSync(configFilePath);
  });

  if (!doesConfigFileExist && defaultConfigFilePath) {
    getLibDebugger('ESLint:lint')('ESLint configuration file not found. Creating default config...');
    await cp(defaultConfigFilePath, resolvePathFromRootSafe({ path: basename(defaultConfigFilePath) }));
  }

  /* v8 ignore start -- The paths-provided branch is only exercised by consumer projects passing file lists. */
  const targets = paths?.length ? paths : [RepoPaths.CurrentFolder];
  /* v8 ignore stop */
  const result = await execFromRoot([
    ...resolveToolCommand({ tool: 'eslint' }),
    ...ESLINT_WARNINGS_AS_FINDINGS_ARGUMENTS,
    ...(shouldFix ? ['--fix'] : []),
    { batchedArguments: targets }
  ], {
    shouldIgnoreExitCode: true,
    shouldIncludeDetails: true
  });

  const kind = classifyEslintExit(result);

  if (kind === 'clean') {
    return;
  }

  throw new Error(kind === 'lint-problems' ? LINT_PROBLEMS_MESSAGE : describeFailureToLint(result));
}

/**
 * Quotes back everything ESLint said that carries information. It drops only the banner itself, npm's chatter
 * and the stack frames, and keeps whatever is left: listing known prefixes instead covered the rule crash and
 * dropped the one line that mattered for a mistyped path (`No files matching the pattern ...`).
 *
 * @param stderr - Everything the child wrote to stderr.
 * @returns The informative lines, de-duplicated and capped.
 */
function extractFailureDetails(stderr: string): string[] {
  const details: string[] = [];

  for (const rawLine of stderr.split('\n')) {
    if (details.length === MAX_FAILURE_DETAIL_LINES) {
      break;
    }

    const line = rawLine.trim();
    const isNoise = line === ''
      || line.startsWith(ESLINT_ABORT_BANNER)
      || line.startsWith(NPM_NOTICE_PREFIX)
      || STACK_FRAME_REG_EXP.test(line);
    if (!isNoise && !details.includes(line)) {
      details.push(line);
    }
  }

  return details;
}

/**
 * Spells an exit code, adding the hex form for the NT status values a reader cannot recognize in decimal.
 *
 * @param exitCode - The child's exit code, or `null` when a signal ended it first.
 * @returns The code as it should be read back.
 */
function formatExitCode(exitCode: null | number): string {
  if (exitCode === null) {
    return '(none - the process was terminated before it could exit)';
  }

  return exitCode < MIN_NT_STATUS_EXIT_CODE ? String(exitCode) : `${String(exitCode)} (0x${exitCode.toString(HEX_RADIX).toUpperCase()})`;
}

/**
 * Names which of the four ways ESLint failed to lint this was.
 *
 * @param result - What the ESLint child did.
 * @returns The first line of {@link describeFailureToLint}'s message.
 */
function getFailureHeadline(result: ExecResult): string {
  if (result.exitSignal !== null) {
    return 'ESLint was KILLED before it finished linting.';
  }

  if (result.exitCode !== null && result.exitCode >= MIN_NT_STATUS_EXIT_CODE) {
    return 'ESLint DIED at the OS level - an access violation or similar, with no diagnostic of its own.';
  }

  if (RULE_CRASH_REG_EXP.test(result.stderr)) {
    return 'ESLint CRASHED: a rule threw while linting. The rule and the file it was on are named below.';
  }

  return result.stderr.includes(ESLINT_ABORT_BANNER)
    ? 'ESLint ABORTED: it threw instead of finishing - a broken config or command line, or an internal error.'
    : 'ESLint exited non-zero without reporting findings, so it did not finish linting.';
}
