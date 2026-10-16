/**
 * @file
 *
 * Shared nano-staged configuration for pre-commit hooks.
 */

import {
  isAbsolute,
  relative
} from 'node:path';
import process from 'node:process';

import {
  isEnvVariableOff,
  loadEnvFileIfExists
} from './env-toggle.ts';
import {
  getEffectiveCommandLineLength,
  getMaxBatchCommandLength
} from './exec.ts';
import { readPackageJsonSync } from './npm.ts';
import { getPackageManagerRunCommand } from './package-manager.ts';

/**
 * Options for {@link getNanoStagedConfig}.
 */
export interface GetNanoStagedConfigOptions {
  /**
   * Repo-specific file-rewriting tasks, keyed by the nano-staged pattern that claims their files.
   *
   * Each gets spellcheck appended and its files removed from the spellcheck-only key, exactly like the shared
   * writers. A pattern must not contain `/`, and must not repeat a shared writer pattern. Each command is a
   * prefix the staged paths are appended to, in batches, like the shared ones (`npm run lint:fix --`).
   */
  readonly additionalWriterTasks?: Readonly<Record<string, readonly string[]>>;
}

/**
 * A nano-staged configuration whose every key is a {@link NanoStagedTask}.
 */
export type NanoStagedConfig = Record<string, NanoStagedTask>;

/**
 * A function-valued nano-staged task: it receives the staged files its pattern claims and returns the
 * commands to run over them, in order.
 */
export type NanoStagedTask = (context: NanoStagedTaskContext) => string[];

/**
 * What nano-staged passes to a function-valued task.
 */
export interface NanoStagedTaskContext {
  /**
   * The absolute paths of the staged files the task's pattern claims.
   */
  readonly filenames: readonly string[];
}

/**
 * The `<manager> run` prefix every task below is built on, resolved once for the process.
 *
 * Detection probes for a lockfile beside `package.json`, so it is a handful of `existsSync` calls and
 * nothing more — no `.env` read and no `process.exit`, which is what lets it sit at module scope.
 */
const PACKAGE_MANAGER_RUN_COMMAND = getPackageManagerRunCommand().join(' ');

const SPELLCHECK_SCRIPT_NAME = 'spellcheck';

const SPELLCHECK_COMMAND = toScriptCommand(SPELLCHECK_SCRIPT_NAME);

/**
 * Room left in every batch for the resolved path of the package manager's executable.
 *
 * nano-staged runs `npm` as the absolute path of `npm.cmd` (`<comspec> /D /S /C "<path>" "<arg>" …`), which
 * the batch cannot see, so a full Windows `MAX_PATH` is set aside for it.
 */
const EXECUTABLE_PATH_RESERVE = 260;

/**
 * The characters nano-staged's command tokenizer cannot carry inside an argument.
 *
 * A function-valued task returns its commands as STRINGS, and nano-staged splits each one with
 * `stringArgvToArray`, which emits a quoted token twice (once bare, once with its quotes) and has no escape.
 * So a path holding whitespace or a quote cannot be passed as itself.
 */
const TOKENIZER_UNSAFE_CHARACTERS_REG_EXP = /[\s"']/g;

/**
 * The npm scripts that REWRITE a staged file, in the order they run, keyed by the nano-staged pattern that
 * claims it.
 *
 * `lint:fix` and `format` both rewrite the file, so they have to share one key: nano-staged runs its
 * per-pattern groups under `Promise.all` (`run()` in `nano-staged/lib/cmd-runner.js`), and sequences only
 * the commands INSIDE a single key's array (`runTask()`, a `for ... of await`). Split across two keys they
 * race, whichever finishes last wins, and the commit stages bytes that neither tool would have produced on
 * its own.
 *
 * So do NOT express a directory exclusion by giving one of these two its own negated key -- that silently
 * takes the ordering away. An exclusion belongs in the excluded tool's own config, where ESLint's
 * `globalIgnores` already puts it: a path ESLint ignores is reported as a warning and exits 0 when it is
 * passed explicitly, so it costs a console line rather than a failed commit and needs no key here.
 */
const WRITER_SCRIPT_NAMES: Readonly<Record<string, readonly string[]>> = {
  '*.{ts,tsx,mts}': ['lint:fix', 'format'],
  '*.md': ['lint:md:fix']
};

const WRITER_TASKS: Readonly<Record<string, readonly string[]>> = toWriterTasks(() => true);

/**
 * Nano-staged configuration that runs file-based lint, format, and spellcheck on staged files.
 *
 * Only includes tools that can operate on individual files. Whole-project checks
 * (TypeScript compilation, unit tests) are left to CI.
 *
 * Commands run through the package manager that owns the tree — `npm run ... --`, `bun run ... --`, and
 * so on — so nano-staged file paths are forwarded as CLI arguments, batched to fit the command line (see
 * `toBatchedTask`).
 *
 * Spellcheck is partitioned across the keys rather than given a catch-all `'*'` key (see
 * `partitionSpellcheck`). A repo adding a file-rewriting task of its own passes it to
 * {@link getNanoStagedConfig} as `additionalWriterTasks` rather than spreading this object and adding a key,
 * which would reintroduce the overlap for that key's files.
 */
export const obsidianDevUtilsConfig: NanoStagedConfig = partitionSpellcheck(WRITER_TASKS, true);

const NANO_STAGED_ENV_VARIABLE = 'NANO_STAGED';

/**
 * Resolves the nano-staged configuration to use, honoring a per-developer opt-out.
 *
 * Loads a gitignored `.env` if present, then — when `NANO_STAGED` is set to an off value (`0`, `false`,
 * `off`, or `no`) — prints a notice and exits the process successfully so the pre-commit checks are
 * skipped. This mirrors husky's own `HUSKY=0` switch, but scoped to the nano-staged step (so the
 * commit-msg hook still runs). Otherwise it returns {@link obsidianDevUtilsConfig}, or — when
 * `additionalWriterTasks` are given — the same configuration re-partitioned with those writers added.
 *
 * A shared task whose npm script the project's `package.json` does not declare is left out, so a project
 * without, say, markdownlint does not fail its first commit that stages a `.md` file on a missing script. A
 * writer pattern left with no writer is dropped, and spellcheck runs only when `spellcheck` is declared, in
 * which case its files fall to the spellcheck-only key. The `additionalWriterTasks` are the caller's own and
 * are kept as given.
 *
 * `NANO_STAGED` is not an npm script, so it carries its own switch rather than the script-name-derived one
 * every npm script gets — but both share the same notion of an off value, via {@link isEnvVariableOff}.
 *
 * This is a function rather than module-level code so importing the package barrel never triggers the
 * `.env` read or the process exit; call it from the thin `scripts/nano-staged-config.ts` entry. Resolving the
 * package manager is the one thing that does run at module scope, and it does neither of those two
 * things — it only probes for a lockfile.
 *
 * @param options - The optional options.
 * @returns The nano-staged task configuration. Does not return when the opt-out is active.
 */
export function getNanoStagedConfig(options?: GetNanoStagedConfigOptions): NanoStagedConfig {
  loadEnvFileIfExists();

  if (isEnvVariableOff(NANO_STAGED_ENV_VARIABLE)) {
    process.stdout.write(`nano-staged: skipped (${NANO_STAGED_ENV_VARIABLE} is off).\n`);
    process.exit(0);
  }

  const scriptNames = new Set(Object.keys(readPackageJsonSync().scripts ?? {}));
  const hasAllSharedScripts = [SPELLCHECK_SCRIPT_NAME, ...Object.values(WRITER_SCRIPT_NAMES).flat()]
    .every((scriptName) => scriptNames.has(scriptName));
  const additionalWriterTasks = options?.additionalWriterTasks ?? {};
  if (hasAllSharedScripts && Object.keys(additionalWriterTasks).length === 0) {
    return obsidianDevUtilsConfig;
  }

  const writerTasks = toWriterTasks((scriptName) => scriptNames.has(scriptName));
  const duplicatePattern = Object.keys(additionalWriterTasks).find((pattern) => Object.hasOwn(writerTasks, pattern));
  if (duplicatePattern !== undefined) {
    throw new Error(`nano-staged writer pattern '${duplicatePattern}' is already a shared writer pattern.`);
  }

  return partitionSpellcheck({ ...writerTasks, ...additionalWriterTasks }, scriptNames.has(SPELLCHECK_SCRIPT_NAME));
}

/**
 * Splits command arguments into batches that each fit one command line after a given prefix.
 *
 * Each argument is costed as nano-staged passes it on Windows — quoted, then `^`-escaped by `cmd.exe`'s
 * rules — through {@link getEffectiveCommandLineLength}, and the budget is {@link getMaxBatchCommandLength},
 * which already holds back the reserve for the `npm` → `cmd.exe` → `.bin` shim chain re-expanding the
 * arguments. An argument too long for any batch still gets a batch of its own: it fails loudly there, which
 * dropping it would not.
 *
 * @param prefix - The command the arguments are appended to.
 * @param commandArguments - The arguments to split.
 * @returns The batches, in order, together holding every argument once.
 */
function batchCommandArguments(prefix: string, commandArguments: readonly string[]): string[][] {
  const emptyLength = getEffectiveCommandLineLength('');
  const budget = getMaxBatchCommandLength() - EXECUTABLE_PATH_RESERVE - getEffectiveCommandLineLength(prefix);
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;

  for (const commandArgument of commandArguments) {
    const argumentLength = getEffectiveCommandLineLength(` "${commandArgument}"`) - emptyLength;
    if (batch.length > 0 && batchLength + argumentLength > budget) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push(commandArgument);
    batchLength += argumentLength;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

/**
 * Builds a nano-staged configuration in which spellcheck never reads a file while another task rewrites it.
 *
 * The same `Promise.all` that forces two writers into one key makes a catch-all `'*'` spellcheck key run
 * CONCURRENTLY with every writer key, so cspell would read a file that ESLint or dprint is rewriting in
 * place -- a spurious finding on a half-written file, or a pass over content that is not what gets
 * committed. So the staged files are PARTITIONED instead:
 *
 * - every writer key gets spellcheck appended as its LAST command, so it reads that key's files after they
 *   have been rewritten;
 * - one complement key spellchecks exactly the files no writer key claims.
 *
 * The complement is written in nano-staged's own glob dialect, which compiles `!(...)` to a lookahead that
 * is NOT anchored at the end of the path: `!(*.md)*` would exclude `notes.md.bak` too. A nested `!(?)`
 * compiles to `(?!.)`, which IS an end anchor, so each alternative is suffixed with it. A writer pattern
 * containing `/` would switch nano-staged into globstar mode, where `*` stops crossing directories and the
 * construction no longer holds -- hence the throw. The unit test pins the partition against the installed
 * nano-staged compiler, so a release that changes its dialect fails there rather than in a commit.
 *
 * Without spellcheck there is nothing to partition: each writer key runs its own commands, and no complement
 * key is emitted.
 *
 * @param writerTasks - The file-rewriting tasks, keyed by the pattern that claims their files.
 * @param shouldSpellcheck - Whether the project has a `spellcheck` script to run.
 * @returns The configuration, with the spellcheck step partitioned across the keys.
 */
function partitionSpellcheck(writerTasks: Readonly<Record<string, readonly string[]>>, shouldSpellcheck: boolean): NanoStagedConfig {
  if (!shouldSpellcheck) {
    return Object.fromEntries(Object.entries(writerTasks).map(([pattern, commands]) => [pattern, toBatchedTask(commands)]));
  }

  const patterns = Object.keys(writerTasks);
  const patternWithSlash = patterns.find((pattern) => pattern.includes('/'));
  if (patternWithSlash !== undefined) {
    throw new Error(`nano-staged writer pattern '${patternWithSlash}' contains '/', which the spellcheck partition cannot express.`);
  }

  // `!()*` would compile to a lookahead that rejects every path, so with no writer the complement is everything.
  const complementPattern = patterns.length === 0 ? '*' : `!(${patterns.map((pattern) => `${pattern}!(?)`).join('|')})*`;
  const config: NanoStagedConfig = {
    [complementPattern]: toBatchedTask([SPELLCHECK_COMMAND])
  };

  for (const [pattern, commands] of Object.entries(writerTasks)) {
    config[pattern] = toBatchedTask([...commands, SPELLCHECK_COMMAND]);
  }

  return config;
}

/**
 * Builds a task that runs each command over every staged file it receives, in as many batches as the command
 * line needs.
 *
 * nano-staged appends a string task's files to ONE command, so a commit staging a few hundred files ran
 * `npm run lint:fix -- <every path>` and failed on Windows with `The command line is too long.`, refusing
 * exactly the whole-repo commits that most need the hook. A function-valued task builds its own commands
 * instead, and these are batched against the same budget `exec()` uses (see `batchCommandArguments`).
 *
 * The commands keep their order: every batch of the first command runs before any batch of the second,
 * because nano-staged runs one key's commands one after another, so a writer still finishes before the next
 * writer, and spellcheck still reads the rewritten files.
 *
 * @param commands - The command prefixes, in the order they run.
 * @returns The task.
 */
function toBatchedTask(commands: readonly string[]): NanoStagedTask {
  return ({ filenames }) => {
    const commandArguments = filenames.map((filename) => toCommandArgument(filename));
    return commands.flatMap((command) => batchCommandArguments(command, commandArguments).map((batch) => `${command} ${batch.join(' ')}`));
  };
}

/**
 * Turns a staged file's absolute path into the argument a batched task passes for it.
 *
 * The path is made relative to the working directory, where nano-staged and the task both run, which roughly
 * halves its length and so the number of batches; a path outside it stays absolute. A relative path starting
 * with `-` gets `./`, so no tool reads it as an option.
 *
 * Whitespace and quotes become `?`, because nano-staged's tokenizer cannot carry them (see
 * {@link TOKENIZER_UNSAFE_CHARACTERS_REG_EXP}). Every tool the tasks run (ESLint, dprint, cspell,
 * markdownlint-cli2) takes its paths as globs, and `?` matches exactly the one character it replaced, so the
 * file is still found; a sibling differing only in that character would match too, which costs a lint of an
 * extra file, not a missed one.
 *
 * @param filename - The absolute path of the staged file.
 * @returns The argument.
 */
function toCommandArgument(filename: string): string {
  const relativePath = relative(process.cwd(), filename);
  let commandArgument = (relativePath.startsWith('..') || isAbsolute(relativePath) ? filename : relativePath).replaceAll('\\', '/');
  if (commandArgument.startsWith('-')) {
    commandArgument = `./${commandArgument}`;
  }
  return commandArgument.replaceAll(TOKENIZER_UNSAFE_CHARACTERS_REG_EXP, '?');
}

/**
 * Builds the command prefix that runs an npm script over the paths appended to it.
 *
 * @param scriptName - The script name.
 * @returns The command prefix, such as `npm run lint:fix --`.
 */
function toScriptCommand(scriptName: string): string {
  return `${PACKAGE_MANAGER_RUN_COMMAND} ${scriptName} --`;
}

/**
 * Builds the shared writer tasks from {@link WRITER_SCRIPT_NAMES}, keeping only the scripts a filter accepts
 * and dropping a pattern left with none.
 *
 * @param shouldIncludeScript - Whether to run a given script.
 * @returns The writer tasks, keyed by the pattern that claims their files.
 */
function toWriterTasks(shouldIncludeScript: (scriptName: string) => boolean): Record<string, readonly string[]> {
  const writerTasks: Record<string, readonly string[]> = {};
  for (const [pattern, scriptNames] of Object.entries(WRITER_SCRIPT_NAMES)) {
    const commands = scriptNames.filter((scriptName) => shouldIncludeScript(scriptName)).map((scriptName) => toScriptCommand(scriptName));
    if (commands.length > 0) {
      writerTasks[pattern] = commands;
    }
  }
  return writerTasks;
}
