/**
 * @file
 *
 * Guards the CLI arguments a test wrapper forwards to its runner against the options the wrapper sets itself.
 */

/**
 * Params for {@link assertNoOwnedArguments}.
 */
export interface AssertNoOwnedArgumentsParams {
  /**
   * The arguments the caller forwards.
   */
  readonly forwardedArguments: readonly string[];

  /**
   * The options the wrapper sets itself.
   */
  readonly ownedOptions: readonly OwnedOption[];

  /**
   * The runner's name, shown in the error.
   */
  readonly runnerName: string;
}

/**
 * An option a test wrapper sets itself, so a forwarded argument may not name it.
 */
export interface OwnedOption {
  /**
   * The spellings that name the option, each matched alone (`--project`) or with a value (`--project=x`).
   */
  readonly names: readonly string[];

  /**
   * Prefixes that name the option's sub-options, such as `--coverage.`.
   */
  readonly prefixes?: readonly string[];

  /**
   * What to use instead, shown in the error.
   */
  readonly replacement: string;
}

/**
 * Throws when a forwarded argument names an option the wrapper sets itself.
 *
 * Letting it through would not override the wrapper reliably: vitest adds every `--project` to the wrapper's own, and a
 * later `--coverage.thresholds.lines` would quietly lower a coverage gate.
 *
 * @param params - The {@link AssertNoOwnedArgumentsParams}.
 */
export function assertNoOwnedArguments(params: AssertNoOwnedArgumentsParams): void {
  const { forwardedArguments, ownedOptions, runnerName } = params;
  const problems: string[] = [];
  for (const argument of forwardedArguments) {
    const option = ownedOptions.find((candidate) => isOwnedArgument(argument, candidate));
    if (option) {
      problems.push(`${argument} (use ${option.replacement} instead)`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`The ${runnerName} wrapper sets these options itself, so they cannot be forwarded: ${problems.join(', ')}.`);
  }
}

function isOwnedArgument(argument: string, option: OwnedOption): boolean {
  const name = argument.replace(/[=].*$/su, '');
  return option.names.includes(name) || (option.prefixes ?? []).some((prefix) => argument.startsWith(prefix));
}
