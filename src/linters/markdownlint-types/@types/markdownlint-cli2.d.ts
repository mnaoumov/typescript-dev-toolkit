/**
 * @file
 *
 * The types for `markdownlint-cli2`'s programmatic entry point, which the package itself describes in JSDoc
 * and ships no declaration for. Vendored here, beside the configuration-schema types, for the same reason.
 *
 * Only the parameters {@link lintMarkdownContent} and {@link fixMarkdownContent} pass are declared. The full parameter
 * object also carries `argv`, `allowStdin`, `fileContents`, `fs` and `noImport`, none of which a caller linting
 * one in-memory document has any use for — and declaring an option nobody passes is a claim about a shape
 * nothing here ever checks.
 */

declare module 'markdownlint-cli2' {
  /**
   * What `markdownlint-cli2` hands an output formatter.
   */
  interface MarkdownlintCli2FormatterOptions {
    /**
     * Every finding of the run, each one markdownlint's own `LintError` with the reported path added, so a fixable
     * one still carries its `fixInfo`.
     */
    readonly results: readonly (import('markdownlint').LintError & { readonly fileName: string })[];
  }

  /**
   * The options that win over every configuration `markdownlint-cli2` discovers.
   */
  interface MarkdownlintCli2OptionsOverride {
    /**
     * The output formatters, each a module id or the formatter function itself, followed by its parameters. Setting
     * it replaces the default formatter, so nothing reaches `logError`.
     */
    readonly outputFormatters?: readonly (readonly [(options: MarkdownlintCli2FormatterOptions) => Promise<void> | void])[] | undefined;
  }

  /**
   * The parameters of {@link main}.
   */
  interface MarkdownlintCli2Parameters {
    /**
     * The directory whose `markdownlint-cli2` configuration applies, and the base every reported path is
     * relative to.
     *
     * @default `process.cwd()`
     */
    readonly directory?: string | undefined;

    /**
     * Called once per finding, with the line the default output formatter would have printed.
     */
    readonly logError?: ((message: string) => void) | undefined;

    /**
     * Called with the banner and the progress lines — everything that is not a finding.
     */
    readonly logMessage?: ((message: string) => void) | undefined;

    /**
     * Whether to skip glob expansion entirely, including the `globs` the configuration declares. Set it when
     * the only input is {@link nonFileContents}, so the run cannot wander into the repository's own files.
     *
     * @default `false`
     */
    readonly noGlobs?: boolean | undefined;

    /**
     * Content to lint that is not read from disk, keyed by the POSIX path it is linted AS. The path decides
     * which directory's configuration applies and how the path-relative rules (such as `relative-links`)
     * resolve, so it should be the path the content is destined for.
     */
    readonly nonFileContents?: Record<string, string> | undefined;

    /**
     * The options the discovered configuration is merged OVER — a base, not an override. `config` is merged
     * key by key and every other option is replaced wholesale, so anything the repository states itself wins.
     */
    readonly optionsDefault?: import('./markdownlint-cli2-config-schema.d.ts').MarkdownlintCli2ConfigurationSchema | undefined;

    /**
     * The options merged over everything discovered, which win over the repository's own configuration.
     */
    readonly optionsOverride?: MarkdownlintCli2OptionsOverride | undefined;
  }

  /**
   * Runs `markdownlint-cli2`.
   *
   * @param parameters - The {@link MarkdownlintCli2Parameters}.
   * @returns A {@link Promise} that resolves to the process exit code: `0` when nothing was reported, `1`
   * when something was, `2` when the run itself failed.
   */
  export function main(parameters: MarkdownlintCli2Parameters): Promise<number>;
}
