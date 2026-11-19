/**
 * @file
 *
 * Ctrl+C during a release. While the release has edited files it has not committed yet, an interrupt puts those
 * files back the way they were, so the tree is clean and the release can simply be run again. After the tag, an
 * interrupt says what is on origin and how to resume. Re-implemented after `obsidian-plugin-dev-kit`'s
 * `src/release/interrupt.ts` (MIT).
 */

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { errorToString } from '@mnaoumov/typescript-lib/error';
import { rm } from 'node:fs/promises';
import process from 'node:process';

import {
  execFromRoot,
  resolvePathFromRootSafe
} from './root.ts';

/**
 * The exit code of a process ended by Ctrl+C (128 + SIGINT).
 */
export const INTERRUPTED_EXIT_CODE = 130;

/**
 * Parameters for {@link guardReleaseInterrupt}.
 */
export interface GuardReleaseInterruptParams {
  /**
   * How the guard reaches the process. Defaults to the real `SIGINT` and `process.exit`.
   */
  readonly hooks?: InterruptHooks;

  /**
   * Runs once on the first Ctrl+C, before the process exits. A failure is reported, never swallowed, and the
   * process still exits.
   *
   * @param write - Writes a line for the person running the release.
   * @returns A {@link Promise} that resolves when the cleanup is done.
   */
  readonly onInterrupt: (write: (text: string) => void) => Promise<void>;
}

/**
 * What the guard needs from the process. Injected so a test can see the exit code without ending the test run.
 */
export interface InterruptHooks {
  /**
   * Ends the process.
   *
   * @param code - The exit code.
   */
  readonly exit: (code: number) => void;

  /**
   * Registers a Ctrl+C listener.
   *
   * @param listener - The listener.
   * @returns What removes the listener again.
   */
  readonly onInterrupt: (listener: () => void) => () => void;

  /**
   * Writes a line for the person running the release.
   *
   * @param text - The text.
   */
  readonly write: (text: string) => void;
}

/**
 * An active guard.
 */
export interface ReleaseInterruptGuard {
  /**
   * Unregisters the listener. Calling it again does nothing.
   */
  readonly stop: () => void;
}

/**
 * The uncommitted changes of the working tree at one moment, as paths relative to the project root.
 */
export interface WorkingTreeChanges {
  /**
   * Tracked paths that differ from `HEAD`, staged or not, including a staged new file.
   */
  readonly changedPaths: readonly string[];

  /**
   * Untracked paths that are not ignored.
   */
  readonly untrackedPaths: readonly string[];
}

/**
 * The real process: `SIGINT`, `process.exit` and standard error.
 *
 * @returns The hooks.
 */
export function getProcessInterruptHooks(): InterruptHooks {
  return {
    exit(code: number): void {
      process.exit(code);
    },
    onInterrupt(listener: () => void): () => void {
      process.on('SIGINT', listener);
      return (): void => {
        process.off('SIGINT', listener);
      };
    },
    write(text: string): void {
      process.stderr.write(`${text}\n`);
    }
  };
}

/**
 * While the guard is active, the first Ctrl+C runs {@link GuardReleaseInterruptParams.onInterrupt} and exits with
 * {@link INTERRUPTED_EXIT_CODE}. Registering a `SIGINT` listener removes Node's default exit, so the guard ends the
 * process itself. A second Ctrl+C while the cleanup runs is ignored, so the cleanup is never cut in half.
 *
 * @param params - The {@link GuardReleaseInterruptParams}.
 * @returns The guard.
 */
export function guardReleaseInterrupt(params: GuardReleaseInterruptParams): ReleaseInterruptGuard {
  const hooks = params.hooks ?? getProcessInterruptHooks();
  let isHandling = false;
  let isActive = true;
  const unregister = hooks.onInterrupt(() => {
    if (isHandling) {
      return;
    }
    isHandling = true;
    invokeAsyncSafely(handle);
  });

  return {
    stop(): void {
      if (!isActive) {
        return;
      }

      isActive = false;
      unregister();
    }
  };

  async function handle(): Promise<void> {
    try {
      await params.onInterrupt((text) => {
        hooks.write(text);
      });
    } catch (error) {
      hooks.write(`Cleaning up after Ctrl+C failed: ${errorToString(error)}`);
    }
    hooks.exit(INTERRUPTED_EXIT_CODE);
  }
}

/**
 * Reads the uncommitted changes of the working tree.
 *
 * @returns A {@link Promise} that resolves to the {@link WorkingTreeChanges}.
 */
export async function readWorkingTreeChanges(): Promise<WorkingTreeChanges> {
  return {
    changedPaths: splitNullSeparated(await execFromRoot(['git', 'diff', '--name-only', '-z', 'HEAD'], { isQuiet: true })),
    untrackedPaths: splitNullSeparated(await execFromRoot(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { isQuiet: true }))
  };
}

/**
 * Undoes every change made since `before`: a tracked path that was unchanged then is restored from `HEAD` (in the
 * index and the working tree, which also removes a staged new file), and an untracked path that did not exist then
 * is deleted. A path that was already changed before is left alone, because the release cannot tell its edit from
 * the owner's.
 *
 * @param before - The changes when the release started editing.
 * @returns A {@link Promise} that resolves to the paths it put back, sorted.
 */
export async function restoreWorkingTreeChanges(before: WorkingTreeChanges): Promise<string[]> {
  const now = await readWorkingTreeChanges();
  const changedBefore = new Set(before.changedPaths);
  const untrackedBefore = new Set(before.untrackedPaths);
  const changedPaths = now.changedPaths.filter((path) => !changedBefore.has(path));
  const newPaths = now.untrackedPaths.filter((path) => !untrackedBefore.has(path));

  if (changedPaths.length > 0) {
    await execFromRoot(['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...changedPaths], { isQuiet: true });
  }

  for (const path of newPaths) {
    await rm(resolvePathFromRootSafe({ path }), { force: true });
  }

  return [...changedPaths, ...newPaths].sort();
}

function splitNullSeparated(text: string): string[] {
  return text.split('\0').filter(Boolean);
}
