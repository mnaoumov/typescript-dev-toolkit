/**
 * @file
 *
 * Typescript equivalent of the markdownlint-cli2 configuration schema.
 */

import type { Rule } from 'markdownlint';

/**
 * Markdownlint-cli2 configuration schema : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/schema/markdownlint-cli2-config-schema.json
 */
export interface MarkdownlintCli2ConfigurationSchema {
  /**
   * JSON Schema URI (expected by some editors)
   */
  readonly $schema?: string;
  /**
   * Markdownlint configuration schema : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/schema/.markdownlint.jsonc
   */
  readonly config?: MarkdownlintConfigurationSchema;
  /**
   * Module names or paths of custom rules to load and use when linting : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly customRules?: (Rule | string)[];
  /**
   * Whether to enable fixing of linting errors reported by rules that emit fix information : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly fix?: boolean;
  /**
   * Regular expression used to match and ignore any front matter at the beginning of a document : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly frontMatter?: string;
  /**
   * Whether to ignore files referenced by .gitignore (or glob expression) (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly gitignore?: boolean | string;
  /**
   * Glob expressions to include when linting (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly globs?: string[];
  /**
   * Glob expressions to ignore when linting : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly ignores?: string[];
  /**
   * Markdown-it plugins to load and use when linting : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly markdownItPlugins?:
    | [
      string,
      Record<string, unknown>
    ][]
    | [string];
  /**
   * Additional paths to resolve module locations from : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly modulePaths?: string[];
  /**
   * Whether to disable the display of the banner message and version numbers on stdout (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly noBanner?: boolean;
  /**
   * Whether to disable support of HTML comments within Markdown content : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly noInlineConfig?: boolean;
  /**
   * Whether to disable the display of progress on stdout (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly noProgress?: boolean;
  /**
   * Output formatters to load and use to customize markdownlint-cli2 output (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly outputFormatters?:
    | [
      string,
      Record<string, unknown>
    ][]
    | [string];
  /**
   * Whether to show the list of found files on stdout (only valid at the root) : https://github.com/DavidAnson/markdownlint-cli2/blob/v0.18.1/README.md#markdownlint-cli2jsonc
   */
  readonly showFound?: boolean;
}
/**
 * Markdownlint configuration schema : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/schema/.markdownlint.jsonc
 */
export interface MarkdownlintConfigurationSchema {
  [k: string]: unknown;
  /**
   * JSON Schema URI (expected by some editors)
   */
  readonly '$schema'?: string;
  /**
   * Accessibility : MD045, MD059
   */
  readonly 'accessibility'?: boolean;
  /**
   * Atx : MD018, MD019
   */
  readonly 'atx'?: boolean;
  /**
   * Atx_closed : MD020, MD021
   */
  readonly 'atx_closed'?: boolean;
  /**
   * Blank_lines : MD012, MD022, MD031, MD032, MD047
   */
  readonly 'blank_lines'?: boolean;
  /**
   * MD031/blanks-around-fences : Fenced code blocks should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md031.md
   */
  readonly 'blanks-around-fences'?:
    | {
      /**
       * Include list items
       */
      readonly list_items?: boolean;
    }
    | boolean;
  /**
   * MD022/blanks-around-headings : Headings should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md022.md
   */
  readonly 'blanks-around-headings'?:
    | {
      /**
       * Blank lines above heading
       */
      readonly lines_above?: number | number[];
      /**
       * Blank lines below heading
       */
      readonly lines_below?: number | number[];
    }
    | boolean;
  /**
   * MD032/blanks-around-lists : Lists should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md032.md
   */
  readonly 'blanks-around-lists'?: boolean;
  /**
   * MD058/blanks-around-tables : Tables should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md058.md
   */
  readonly 'blanks-around-tables'?: boolean;
  /**
   * Blockquote : MD027, MD028
   */
  readonly 'blockquote'?: boolean;
  /**
   * Bullet : MD004, MD005, MD007, MD032
   */
  readonly 'bullet'?: boolean;
  /**
   * Code : MD014, MD031, MD038, MD040, MD046, MD048
   */
  readonly 'code'?: boolean;
  /**
   * MD046/code-block-style : Code block style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md046.md
   */
  readonly 'code-block-style'?:
    | {
      /**
       * Block style
       */
      readonly style?: 'consistent' | 'fenced' | 'indented';
    }
    | boolean;
  /**
   * MD048/code-fence-style : Code fence style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md048.md
   */
  readonly 'code-fence-style'?:
    | {
      /**
       * Code fence style
       */
      readonly style?: 'backtick' | 'consistent' | 'tilde';
    }
    | boolean;
  /**
   * MD014/commands-show-output : Dollar signs used before commands without showing output : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md014.md
   */
  readonly 'commands-show-output'?: boolean;
  /**
   * Default state for all rules
   */
  readonly 'default'?: boolean;
  /**
   * MD059/descriptive-link-text : Link text should be descriptive : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md059.md
   */
  readonly 'descriptive-link-text'?:
    | {
      /**
       * Prohibited link texts
       */
      readonly prohibited_texts?: string[];
    }
    | boolean;
  /**
   * Emphasis : MD036, MD037, MD049, MD050
   */
  readonly 'emphasis'?: boolean;
  /**
   * MD049/emphasis-style : Emphasis style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md049.md
   */
  readonly 'emphasis-style'?:
    | {
      /**
       * Emphasis style
       */
      readonly style?: 'asterisk' | 'consistent' | 'underscore';
    }
    | boolean;
  /**
   * Path to configuration file to extend
   */
  readonly 'extends'?: null | string;
  /**
   * MD040/fenced-code-language : Fenced code blocks should have a language specified : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md040.md
   */
  readonly 'fenced-code-language'?:
    | {
      /**
       * List of languages
       */
      readonly allowed_languages?: string[];
      /**
       * Require language only
       */
      readonly language_only?: boolean;
    }
    | boolean;
  /**
   * MD041/first-line-heading/first-line-h1 : First line in a file should be a top-level heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md041.md
   */
  readonly 'first-line-h1'?:
    | {
      /**
       * Allow content before first heading
       */
      readonly allow_preamble?: boolean;
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * MD041/first-line-heading/first-line-h1 : First line in a file should be a top-level heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md041.md
   */
  readonly 'first-line-heading'?:
    | {
      /**
       * Allow content before first heading
       */
      readonly allow_preamble?: boolean;
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * Hard_tab : MD010
   */
  readonly 'hard_tab'?: boolean;
  /**
   * MD001/heading-increment : Heading levels should only increment by one level at a time : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md001.md
   */
  readonly 'heading-increment'?: boolean;
  /**
   * MD023/heading-start-left : Headings must start at the beginning of the line : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md023.md
   */
  readonly 'heading-start-left'?: boolean;
  /**
   * MD003/heading-style : Heading style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md003.md
   */
  readonly 'heading-style'?:
    | {
      /**
       * Heading style
       */
      readonly style?: 'atx_closed' | 'atx' | 'consistent' | 'setext_with_atx_closed' | 'setext_with_atx' | 'setext';
    }
    | boolean;
  /**
   * Headings : MD001, MD003, MD018, MD019, MD020, MD021, MD022, MD023, MD024, MD025, MD026, MD036, MD041, MD043
   */
  readonly 'headings'?: boolean;
  /**
   * Hr : MD035
   */
  readonly 'hr'?: boolean;
  /**
   * MD035/hr-style : Horizontal rule style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md035.md
   */
  readonly 'hr-style'?:
    | {
      /**
       * Horizontal rule style
       */
      readonly style?: string;
    }
    | boolean;
  /**
   * Html : MD033
   */
  readonly 'html'?: boolean;
  /**
   * Images : MD045, MD052, MD053, MD054
   */
  readonly 'images'?: boolean;
  /**
   * Indentation : MD005, MD007, MD027
   */
  readonly 'indentation'?: boolean;
  /**
   * Language : MD040
   */
  readonly 'language'?: boolean;
  /**
   * Line_length : MD013
   */
  readonly 'line_length'?: boolean;
  /**
   * MD013/line-length : Line length : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md013.md
   */
  readonly 'line-length'?:
    | {
      /**
       * Number of characters for code blocks
       */
      readonly code_block_line_length?: number;
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Number of characters for headings
       */
      readonly heading_line_length?: number;
      /**
       * Include headings
       */
      readonly headings?: boolean;
      /**
       * Number of characters
       */
      readonly line_length?: number;
      /**
       * Stern length checking
       */
      readonly stern?: boolean;
      /**
       * Strict length checking
       */
      readonly strict?: boolean;
      /**
       * Include tables
       */
      readonly tables?: boolean;
    }
    | boolean;
  /**
   * MD051/link-fragments : Link fragments should be valid : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md051.md
   */
  readonly 'link-fragments'?:
    | {
      /**
       * Ignore case of fragments
       */
      readonly ignore_case?: boolean;
      /**
       * Pattern for ignoring additional fragments
       */
      readonly ignored_pattern?: string;
    }
    | boolean;
  /**
   * MD053/link-image-reference-definitions : Link and image reference definitions should be needed : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md053.md
   */
  readonly 'link-image-reference-definitions'?:
    | {
      /**
       * Ignored definitions
       */
      readonly ignored_definitions?: string[];
    }
    | boolean;
  /**
   * MD054/link-image-style : Link and image style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md054.md
   */
  readonly 'link-image-style'?:
    | {
      /**
       * Allow autolinks
       */
      readonly autolink?: boolean;
      /**
       * Allow collapsed reference links and images
       */
      readonly collapsed?: boolean;
      /**
       * Allow full reference links and images
       */
      readonly full?: boolean;
      /**
       * Allow inline links and images
       */
      readonly inline?: boolean;
      /**
       * Allow shortcut reference links and images
       */
      readonly shortcut?: boolean;
      /**
       * Allow URLs as inline links
       */
      readonly url_inline?: boolean;
    }
    | boolean;
  /**
   * Links : MD011, MD034, MD039, MD042, MD051, MD052, MD053, MD054, MD059
   */
  readonly 'links'?: boolean;
  /**
   * MD005/list-indent : Inconsistent indentation for list items at the same level : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md005.md
   */
  readonly 'list-indent'?: boolean;
  /**
   * MD030/list-marker-space : Spaces after list markers : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md030.md
   */
  readonly 'list-marker-space'?:
    | {
      /**
       * Spaces for multi-line ordered list items
       */
      readonly ol_multi?: number;
      /**
       * Spaces for single-line ordered list items
       */
      readonly ol_single?: number;
      /**
       * Spaces for multi-line unordered list items
       */
      readonly ul_multi?: number;
      /**
       * Spaces for single-line unordered list items
       */
      readonly ul_single?: number;
    }
    | boolean;
  /**
   * MD001/heading-increment : Heading levels should only increment by one level at a time : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md001.md
   */
  readonly 'MD001'?: boolean;
  /**
   * MD003/heading-style : Heading style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md003.md
   */
  readonly 'MD003'?:
    | {
      /**
       * Heading style
       */
      readonly style?: 'atx_closed' | 'atx' | 'consistent' | 'setext_with_atx_closed' | 'setext_with_atx' | 'setext';
    }
    | boolean;
  /**
   * MD004/ul-style : Unordered list style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md004.md
   */
  readonly 'MD004'?:
    | {
      /**
       * List style
       */
      readonly style?: 'asterisk' | 'consistent' | 'dash' | 'plus' | 'sublist';
    }
    | boolean;
  /**
   * MD005/list-indent : Inconsistent indentation for list items at the same level : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md005.md
   */
  readonly 'MD005'?: boolean;
  /**
   * MD007/ul-indent : Unordered list indentation : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md007.md
   */
  readonly 'MD007'?:
    | {
      /**
       * Spaces for indent
       */
      readonly indent?: number;
      /**
       * Spaces for first level indent (when start_indented is set)
       */
      readonly start_indent?: number;
      /**
       * Whether to indent the first level of the list
       */
      readonly start_indented?: boolean;
    }
    | boolean;
  /**
   * MD009/no-trailing-spaces : Trailing spaces : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md009.md
   */
  readonly 'MD009'?:
    | {
      /**
       * Spaces for line break
       */
      readonly br_spaces?: number;
      /**
       * Allow spaces for empty lines in list items
       */
      readonly list_item_empty_lines?: boolean;
      /**
       * Include unnecessary breaks
       */
      readonly strict?: boolean;
    }
    | boolean;
  /**
   * MD010/no-hard-tabs : Hard tabs : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md010.md
   */
  readonly 'MD010'?:
    | {
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Fenced code languages to ignore
       */
      readonly ignore_code_languages?: string[];
      /**
       * Number of spaces for each hard tab
       */
      readonly spaces_per_tab?: number;
    }
    | boolean;
  /**
   * MD011/no-reversed-links : Reversed link syntax : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md011.md
   */
  readonly 'MD011'?: boolean;
  /**
   * MD012/no-multiple-blanks : Multiple consecutive blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md012.md
   */
  readonly 'MD012'?:
    | {
      /**
       * Consecutive blank lines
       */
      readonly maximum?: number;
    }
    | boolean;
  /**
   * MD013/line-length : Line length : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md013.md
   */
  readonly 'MD013'?:
    | {
      /**
       * Number of characters for code blocks
       */
      readonly code_block_line_length?: number;
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Number of characters for headings
       */
      readonly heading_line_length?: number;
      /**
       * Include headings
       */
      readonly headings?: boolean;
      /**
       * Number of characters
       */
      readonly line_length?: number;
      /**
       * Stern length checking
       */
      readonly stern?: boolean;
      /**
       * Strict length checking
       */
      readonly strict?: boolean;
      /**
       * Include tables
       */
      readonly tables?: boolean;
    }
    | boolean;
  /**
   * MD014/commands-show-output : Dollar signs used before commands without showing output : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md014.md
   */
  readonly 'MD014'?: boolean;
  /**
   * MD018/no-missing-space-atx : No space after hash on atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md018.md
   */
  readonly 'MD018'?: boolean;
  /**
   * MD019/no-multiple-space-atx : Multiple spaces after hash on atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md019.md
   */
  readonly 'MD019'?: boolean;
  /**
   * MD020/no-missing-space-closed-atx : No space inside hashes on closed atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md020.md
   */
  readonly 'MD020'?: boolean;
  /**
   * MD021/no-multiple-space-closed-atx : Multiple spaces inside hashes on closed atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md021.md
   */
  readonly 'MD021'?: boolean;
  /**
   * MD022/blanks-around-headings : Headings should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md022.md
   */
  readonly 'MD022'?:
    | {
      /**
       * Blank lines above heading
       */
      readonly lines_above?: number | number[];
      /**
       * Blank lines below heading
       */
      readonly lines_below?: number | number[];
    }
    | boolean;
  /**
   * MD023/heading-start-left : Headings must start at the beginning of the line : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md023.md
   */
  readonly 'MD023'?: boolean;
  /**
   * MD024/no-duplicate-heading : Multiple headings with the same content : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md024.md
   */
  readonly 'MD024'?:
    | {
      /**
       * Only check sibling headings
       */
      readonly siblings_only?: boolean;
    }
    | boolean;
  /**
   * MD025/single-title/single-h1 : Multiple top-level headings in the same document : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md025.md
   */
  readonly 'MD025'?:
    | {
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * MD026/no-trailing-punctuation : Trailing punctuation in heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md026.md
   */
  readonly 'MD026'?:
    | {
      /**
       * Punctuation characters
       */
      readonly punctuation?: string;
    }
    | boolean;
  /**
   * MD027/no-multiple-space-blockquote : Multiple spaces after blockquote symbol : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md027.md
   */
  readonly 'MD027'?:
    | {
      /**
       * Include list items
       */
      readonly list_items?: boolean;
    }
    | boolean;
  /**
   * MD028/no-blanks-blockquote : Blank line inside blockquote : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md028.md
   */
  readonly 'MD028'?: boolean;
  /**
   * MD029/ol-prefix : Ordered list item prefix : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md029.md
   */
  readonly 'MD029'?:
    | {
      /**
       * List style
       */
      readonly style?: 'one_or_ordered' | 'one' | 'ordered' | 'zero';
    }
    | boolean;
  /**
   * MD030/list-marker-space : Spaces after list markers : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md030.md
   */
  readonly 'MD030'?:
    | {
      /**
       * Spaces for multi-line ordered list items
       */
      readonly ol_multi?: number;
      /**
       * Spaces for single-line ordered list items
       */
      readonly ol_single?: number;
      /**
       * Spaces for multi-line unordered list items
       */
      readonly ul_multi?: number;
      /**
       * Spaces for single-line unordered list items
       */
      readonly ul_single?: number;
    }
    | boolean;
  /**
   * MD031/blanks-around-fences : Fenced code blocks should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md031.md
   */
  readonly 'MD031'?:
    | {
      /**
       * Include list items
       */
      readonly list_items?: boolean;
    }
    | boolean;
  /**
   * MD032/blanks-around-lists : Lists should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md032.md
   */
  readonly 'MD032'?: boolean;
  /**
   * MD033/no-inline-html : Inline HTML : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md033.md
   */
  readonly 'MD033'?:
    | {
      /**
       * Allowed elements
       */
      readonly allowed_elements?: string[];
    }
    | boolean;
  /**
   * MD034/no-bare-urls : Bare URL used : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md034.md
   */
  readonly 'MD034'?: boolean;
  /**
   * MD035/hr-style : Horizontal rule style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md035.md
   */
  readonly 'MD035'?:
    | {
      /**
       * Horizontal rule style
       */
      readonly style?: string;
    }
    | boolean;
  /**
   * MD036/no-emphasis-as-heading : Emphasis used instead of a heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md036.md
   */
  readonly 'MD036'?:
    | {
      /**
       * Punctuation characters
       */
      readonly punctuation?: string;
    }
    | boolean;
  /**
   * MD037/no-space-in-emphasis : Spaces inside emphasis markers : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md037.md
   */
  readonly 'MD037'?: boolean;
  /**
   * MD038/no-space-in-code : Spaces inside code span elements : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md038.md
   */
  readonly 'MD038'?: boolean;
  /**
   * MD039/no-space-in-links : Spaces inside link text : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md039.md
   */
  readonly 'MD039'?: boolean;
  /**
   * MD040/fenced-code-language : Fenced code blocks should have a language specified : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md040.md
   */
  readonly 'MD040'?:
    | {
      /**
       * List of languages
       */
      readonly allowed_languages?: string[];
      /**
       * Require language only
       */
      readonly language_only?: boolean;
    }
    | boolean;
  /**
   * MD041/first-line-heading/first-line-h1 : First line in a file should be a top-level heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md041.md
   */
  readonly 'MD041'?:
    | {
      /**
       * Allow content before first heading
       */
      readonly allow_preamble?: boolean;
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * MD042/no-empty-links : No empty links : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md042.md
   */
  readonly 'MD042'?: boolean;
  /**
   * MD043/required-headings : Required heading structure : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md043.md
   */
  readonly 'MD043'?:
    | {
      /**
       * List of headings
       */
      readonly headings?: string[];
      /**
       * Match case of headings
       */
      readonly match_case?: boolean;
    }
    | boolean;
  /**
   * MD044/proper-names : Proper names should have the correct capitalization : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md044.md
   */
  readonly 'MD044'?:
    | {
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Include HTML elements
       */
      readonly html_elements?: boolean;
      /**
       * List of proper names
       */
      readonly names?: string[];
    }
    | boolean;
  /**
   * MD045/no-alt-text : Images should have alternate text (alt text) : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md045.md
   */
  readonly 'MD045'?: boolean;
  /**
   * MD046/code-block-style : Code block style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md046.md
   */
  readonly 'MD046'?:
    | {
      /**
       * Block style
       */
      readonly style?: 'consistent' | 'fenced' | 'indented';
    }
    | boolean;
  /**
   * MD047/single-trailing-newline : Files should end with a single newline character : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md047.md
   */
  readonly 'MD047'?: boolean;
  /**
   * MD048/code-fence-style : Code fence style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md048.md
   */
  readonly 'MD048'?:
    | {
      /**
       * Code fence style
       */
      readonly style?: 'backtick' | 'consistent' | 'tilde';
    }
    | boolean;
  /**
   * MD049/emphasis-style : Emphasis style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md049.md
   */
  readonly 'MD049'?:
    | {
      /**
       * Emphasis style
       */
      readonly style?: 'asterisk' | 'consistent' | 'underscore';
    }
    | boolean;
  /**
   * MD050/strong-style : Strong style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md050.md
   */
  readonly 'MD050'?:
    | {
      /**
       * Strong style
       */
      readonly style?: 'asterisk' | 'consistent' | 'underscore';
    }
    | boolean;
  /**
   * MD051/link-fragments : Link fragments should be valid : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md051.md
   */
  readonly 'MD051'?:
    | {
      /**
       * Ignore case of fragments
       */
      readonly ignore_case?: boolean;
      /**
       * Pattern for ignoring additional fragments
       */
      readonly ignored_pattern?: string;
    }
    | boolean;
  /**
   * MD052/reference-links-images : Reference links and images should use a label that is defined : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md052.md
   */
  readonly 'MD052'?:
    | {
      /**
       * Ignored link labels
       */
      readonly ignored_labels?: string[];
      /**
       * Include shortcut syntax
       */
      readonly shortcut_syntax?: boolean;
    }
    | boolean;
  /**
   * MD053/link-image-reference-definitions : Link and image reference definitions should be needed : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md053.md
   */
  readonly 'MD053'?:
    | {
      /**
       * Ignored definitions
       */
      readonly ignored_definitions?: string[];
    }
    | boolean;
  /**
   * MD054/link-image-style : Link and image style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md054.md
   */
  readonly 'MD054'?:
    | {
      /**
       * Allow autolinks
       */
      readonly autolink?: boolean;
      /**
       * Allow collapsed reference links and images
       */
      readonly collapsed?: boolean;
      /**
       * Allow full reference links and images
       */
      readonly full?: boolean;
      /**
       * Allow inline links and images
       */
      readonly inline?: boolean;
      /**
       * Allow shortcut reference links and images
       */
      readonly shortcut?: boolean;
      /**
       * Allow URLs as inline links
       */
      readonly url_inline?: boolean;
    }
    | boolean;
  /**
   * MD055/table-pipe-style : Table pipe style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md055.md
   */
  readonly 'MD055'?:
    | {
      /**
       * Table pipe style
       */
      readonly style?: 'consistent' | 'leading_and_trailing' | 'leading_only' | 'no_leading_or_trailing' | 'trailing_only';
    }
    | boolean;
  /**
   * MD056/table-column-count : Table column count : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md056.md
   */
  readonly 'MD056'?: boolean;
  /**
   * MD058/blanks-around-tables : Tables should be surrounded by blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md058.md
   */
  readonly 'MD058'?: boolean;
  /**
   * MD059/descriptive-link-text : Link text should be descriptive : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md059.md
   */
  readonly 'MD059'?:
    | {
      /**
       * Prohibited link texts
       */
      readonly prohibited_texts?: string[];
    }
    | boolean;
  /**
   * MD045/no-alt-text : Images should have alternate text (alt text) : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md045.md
   */
  readonly 'no-alt-text'?: boolean;
  /**
   * MD034/no-bare-urls : Bare URL used : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md034.md
   */
  readonly 'no-bare-urls'?: boolean;
  /**
   * MD028/no-blanks-blockquote : Blank line inside blockquote : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md028.md
   */
  readonly 'no-blanks-blockquote'?: boolean;
  /**
   * MD024/no-duplicate-heading : Multiple headings with the same content : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md024.md
   */
  readonly 'no-duplicate-heading'?:
    | {
      /**
       * Only check sibling headings
       */
      readonly siblings_only?: boolean;
    }
    | boolean;
  /**
   * MD036/no-emphasis-as-heading : Emphasis used instead of a heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md036.md
   */
  readonly 'no-emphasis-as-heading'?:
    | {
      /**
       * Punctuation characters
       */
      readonly punctuation?: string;
    }
    | boolean;
  /**
   * MD042/no-empty-links : No empty links : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md042.md
   */
  readonly 'no-empty-links'?: boolean;
  /**
   * MD010/no-hard-tabs : Hard tabs : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md010.md
   */
  readonly 'no-hard-tabs'?:
    | {
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Fenced code languages to ignore
       */
      readonly ignore_code_languages?: string[];
      /**
       * Number of spaces for each hard tab
       */
      readonly spaces_per_tab?: number;
    }
    | boolean;
  /**
   * MD033/no-inline-html : Inline HTML : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md033.md
   */
  readonly 'no-inline-html'?:
    | {
      /**
       * Allowed elements
       */
      readonly allowed_elements?: string[];
    }
    | boolean;
  /**
   * MD018/no-missing-space-atx : No space after hash on atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md018.md
   */
  readonly 'no-missing-space-atx'?: boolean;
  /**
   * MD020/no-missing-space-closed-atx : No space inside hashes on closed atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md020.md
   */
  readonly 'no-missing-space-closed-atx'?: boolean;
  /**
   * MD012/no-multiple-blanks : Multiple consecutive blank lines : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md012.md
   */
  readonly 'no-multiple-blanks'?:
    | {
      /**
       * Consecutive blank lines
       */
      readonly maximum?: number;
    }
    | boolean;
  /**
   * MD019/no-multiple-space-atx : Multiple spaces after hash on atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md019.md
   */
  readonly 'no-multiple-space-atx'?: boolean;
  /**
   * MD027/no-multiple-space-blockquote : Multiple spaces after blockquote symbol : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md027.md
   */
  readonly 'no-multiple-space-blockquote'?:
    | {
      /**
       * Include list items
       */
      readonly list_items?: boolean;
    }
    | boolean;
  /**
   * MD021/no-multiple-space-closed-atx : Multiple spaces inside hashes on closed atx style heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md021.md
   */
  readonly 'no-multiple-space-closed-atx'?: boolean;
  /**
   * MD011/no-reversed-links : Reversed link syntax : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md011.md
   */
  readonly 'no-reversed-links'?: boolean;
  /**
   * MD038/no-space-in-code : Spaces inside code span elements : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md038.md
   */
  readonly 'no-space-in-code'?: boolean;
  /**
   * MD037/no-space-in-emphasis : Spaces inside emphasis markers : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md037.md
   */
  readonly 'no-space-in-emphasis'?: boolean;
  /**
   * MD039/no-space-in-links : Spaces inside link text : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md039.md
   */
  readonly 'no-space-in-links'?: boolean;
  /**
   * MD026/no-trailing-punctuation : Trailing punctuation in heading : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md026.md
   */
  readonly 'no-trailing-punctuation'?:
    | {
      /**
       * Punctuation characters
       */
      readonly punctuation?: string;
    }
    | boolean;
  /**
   * MD009/no-trailing-spaces : Trailing spaces : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md009.md
   */
  readonly 'no-trailing-spaces'?:
    | {
      /**
       * Spaces for line break
       */
      readonly br_spaces?: number;
      /**
       * Allow spaces for empty lines in list items
       */
      readonly list_item_empty_lines?: boolean;
      /**
       * Include unnecessary breaks
       */
      readonly strict?: boolean;
    }
    | boolean;
  /**
   * Ol : MD029, MD030, MD032
   */
  readonly 'ol'?: boolean;
  /**
   * MD029/ol-prefix : Ordered list item prefix : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md029.md
   */
  readonly 'ol-prefix'?:
    | {
      /**
       * List style
       */
      readonly style?: 'one_or_ordered' | 'one' | 'ordered' | 'zero';
    }
    | boolean;
  /**
   * MD044/proper-names : Proper names should have the correct capitalization : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md044.md
   */
  readonly 'proper-names'?:
    | {
      /**
       * Include code blocks
       */
      readonly code_blocks?: boolean;
      /**
       * Include HTML elements
       */
      readonly html_elements?: boolean;
      /**
       * List of proper names
       */
      readonly names?: string[];
    }
    | boolean;
  /**
   * MD052/reference-links-images : Reference links and images should use a label that is defined : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md052.md
   */
  readonly 'reference-links-images'?:
    | {
      /**
       * Ignored link labels
       */
      readonly ignored_labels?: string[];
      /**
       * Include shortcut syntax
       */
      readonly shortcut_syntax?: boolean;
    }
    | boolean;
  /**
   * MD043/required-headings : Required heading structure : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md043.md
   */
  readonly 'required-headings'?:
    | {
      /**
       * List of headings
       */
      readonly headings?: string[];
      /**
       * Match case of headings
       */
      readonly match_case?: boolean;
    }
    | boolean;
  /**
   * MD025/single-title/single-h1 : Multiple top-level headings in the same document : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md025.md
   */
  readonly 'single-h1'?:
    | {
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * MD025/single-title/single-h1 : Multiple top-level headings in the same document : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md025.md
   */
  readonly 'single-title'?:
    | {
      /**
       * RegExp for matching title in front matter
       */
      readonly front_matter_title?: string;
      /**
       * Heading level
       */
      readonly level?: number;
    }
    | boolean;
  /**
   * MD047/single-trailing-newline : Files should end with a single newline character : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md047.md
   */
  readonly 'single-trailing-newline'?: boolean;
  /**
   * Spaces : MD018, MD019, MD020, MD021, MD023
   */
  readonly 'spaces'?: boolean;
  /**
   * Spelling : MD044
   */
  readonly 'spelling'?: boolean;
  /**
   * MD050/strong-style : Strong style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md050.md
   */
  readonly 'strong-style'?:
    | {
      /**
       * Strong style
       */
      readonly style?: 'asterisk' | 'consistent' | 'underscore';
    }
    | boolean;
  /**
   * Table : MD055, MD056, MD058
   */
  readonly 'table'?: boolean;
  /**
   * MD056/table-column-count : Table column count : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md056.md
   */
  readonly 'table-column-count'?: boolean;
  /**
   * MD055/table-pipe-style : Table pipe style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md055.md
   */
  readonly 'table-pipe-style'?:
    | {
      /**
       * Table pipe style
       */
      readonly style?: 'consistent' | 'leading_and_trailing' | 'leading_only' | 'no_leading_or_trailing' | 'trailing_only';
    }
    | boolean;
  /**
   * Ul : MD004, MD005, MD007, MD030, MD032
   */
  readonly 'ul'?: boolean;
  /**
   * MD007/ul-indent : Unordered list indentation : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md007.md
   */
  readonly 'ul-indent'?:
    | {
      /**
       * Spaces for indent
       */
      readonly indent?: number;
      /**
       * Spaces for first level indent (when start_indented is set)
       */
      readonly start_indent?: number;
      /**
       * Whether to indent the first level of the list
       */
      readonly start_indented?: boolean;
    }
    | boolean;
  /**
   * MD004/ul-style : Unordered list style : https://github.com/DavidAnson/markdownlint/blob/v0.38.0/doc/md004.md
   */
  readonly 'ul-style'?:
    | {
      /**
       * List style
       */
      readonly style?: 'asterisk' | 'consistent' | 'dash' | 'plus' | 'sublist';
    }
    | boolean;
  /**
   * Url : MD034
   */
  readonly 'url'?: boolean;
  /**
   * Whitespace : MD009, MD010, MD012, MD027, MD028, MD030, MD037, MD038, MD039
   */
  readonly 'whitespace'?: boolean;
}
