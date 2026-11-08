# CHANGELOG

## 6.3.0

This release has 1 new feature and 1 fix.

### New

- **changelog:** add a rewrite-changelog command that regroups published sections

### Fixed

- **changelog:** escape the brackets of an issue title lifted into a grouped entry

## 6.2.0

This release has 1 new feature, 1 fix and 3 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **version:** group the generated changelog section for readers

### Fixed

- **eslint:** preserve typed-array slice copies

### Documentation

- drop the Obsidian resources link from See also
- **readme:** link the changelog
- **readme:** compare related TypeScript development tools

## 6.1.0

This release has 1 new feature and 1 fix.

### New

- **version:** publish releases before pushing version bumps

### Fixed

- restore source maps for cached Vitest modules

## 6.0.2

This release has 1 fix.

### Fixed

- **docs:** link inherited members through multiple base classes

## 6.0.1

This release has 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **markdownlint:** serve linkinator from the root folder so a lone file resolves ../ links

### Documentation

- add issue-filing instructions for AI agents

## 6.0.0

This release has 1 breaking change.

### Breaking changes

- **eslint:** adopt eslint-plugin-unicorn 79 in the shared config

## 5.4.2

This release has maintenance changes only. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

## 5.4.1

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **markdownlint:** warn on a 408 in the link check, and retry it in the site check

## 5.4.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **eslint:** let prefer-dedent ignore callbacks of named calls, run without the imports

## 5.3.0

This release has 1 new feature.

### New

- **markdownlint:** skip links named in LINK_CHECK_SKIP for one run, warning on each

## 5.2.0

This release has 1 new feature.

### New

- **eslint:** add prefer-dedent, fixing literal arrays joined with a newline to dedent

## 5.1.0

This release has 3 new features and 8 fixes.

### New

- **test-runners:** forward CLI arguments through the test wrappers
- **eslint:** require named patch arguments
- **eslint:** add opt-in readonly member array policy

### Fixed

- **eslint:** leave a locally bound Promise.resolve() to prefer-noop-async
- **over-exposure:** stop reporting symbol-keyed members as unreferenced
- **svelte:** compile TypeScript components without svelte-preprocess
- **eslint:** preserve imports in async no-op fixes
- **test:** honor bulk worker budgets in Vitest runners
- **docs:** respect bulk concurrency limits and bound link retries
- **format:** align dprint with ESLint braces and imports
- honor bulk processor budgets in staged checks

## 5.0.0

1. **Breaking:** enable `typescript-dev-toolkit/no-keyword-identifiers` in the shared ESLint configuration. Bare `object`, `string`, `number`, `boolean`, `symbol`, `bigint`, `undefined`, `arguments`, `function`, `module` and `event` binding names now require a `$` prefix, such as `$object`.
2. Offer scope-aware rename suggestions for local bindings, updating their references while preserving TypeScript annotations. Renames are suggestions only; `lint:fix` never applies them automatically. Contract-sensitive cases and name collisions require a manual rename.
3. Keep compound names, property keys, import aliases and reads of builtin globals legal. Update this package's own bindings to the convention.

## 4.0.0

This release has 1 breaking change.

### Breaking changes

- **eslint:** require readonly properties in all interfaces

## 3.13.1

This release has maintenance changes only. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

## 3.13.0

This release has 1 new feature and 1 fix.

### New

- **version:** link the issues a commit body names from the release notes

### Fixed

- **markdownlint:** let a link still rate-limited after the retries pass with a warning

## 3.12.0

This release has 1 new feature.

### New

- **version:** fix a generated changelog section nobody reviews before refusing it

## 3.11.0

This release has 2 new features.

### New

- refuse a changelog-breaking commit subject at commit time and in the release preflight
- **test-runners:** an on-demand test:mutation run with Stryker

## 3.10.0

This release has 1 new feature.

### New

- **docs-site:** an apiIndexIntro override, and no subpath claim under an importStatement hook

## 3.9.0

This release has 1 new feature.

### New

- **docs-site:** a public API barrel mode, and npmjs package links probed on the registry

## 3.8.0

This release has 1 new feature.

### New

- **docs-site:** options for import statements, member routes, excluded folders, type params

## 3.7.4

This release has 2 fixes.

### Fixed

- **upstream-sync:** quote command output without color codes and lead with the failure
- **version:** refuse to tag or push a release commit that did not land on the release branch

## 3.7.3

This release has 1 fix.

### Fixed

- **deps:** bump markdownlint-cli2 to ^0.24.0 so consumers stop resolving smol-toml 1.8.0

## 3.7.2

This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **formatters:** exclude .claude/settings.local.json from every dprint run

## 3.7.1

This release has 1 fix.

### Fixed

- **formatters:** allow an explicit dprint path list that dprint.json excludes entirely

## 3.7.0

This release has 1 new feature.

### New

- **docs-site:** type-check guide snippets and flag retired obsidian-dev-utils addresses

## 3.6.4

This release has 1 fix.

### Fixed

- **docs-site:** keep the target of a bare {@link} in plain-text descriptions

## 3.6.3

This release has 1 fix.

### Fixed

- **docs-site:** escape the braces of a function's return type on its API page

## 3.6.2

This release has 1 fix and 1 documentation change.

### Fixed

- **docs-site:** re-render the OG cards when the site logo changes

### Documentation

- replace the site logo and favicon with the approved mark

## 3.6.1

This release has 1 fix.

### Fixed

- **svelte-wrapper-plugin:** load esbuild-svelte at setup, not at module load

## 3.6.0

This release has 1 new feature.

### New

- **library-build:** let generateLibraryIndex leave named modules off the barrels

## 3.5.0

This release has 1 fix.

### Fixed

- **library-build:** treat node: specifiers and Electron builtins as builtins in validateDependencies

## 3.4.0

This release has 1 new feature.

### New

- **library-build:** add validateDependencies, refusing imports a consumer does not install

## 3.3.0

This release has 2 new features and 1 documentation change.

### New

- **upstream-sync:** ship the upstream sync as a sync-upstreams bin and a reusable workflow
- **library-build:** take additional exports entries beside the generated ones

### Documentation

- **agents:** say the standalone nano-staged entry has no .astro writer, and why

## 3.2.0

This release has 1 new feature.

### New

- **nano-staged-config:** leave out a shared task whose script the project lacks

## 3.1.0

This release has 3 new features, 2 fixes and 1 documentation change.

### New

- **test-runners:** add a jest runner, defineJestConfig and a dispatcher that picks the runner
- **formatters:** support Prettier and Biome as formatters and Biome as linter
- **docs-site:** optionally keep the repository's GitHub homepage pointing at the site

### Fixed

- **docs-site:** pass the script's arguments on to astro dev and astro preview
- **docs-site:** back off longer on a transient external link failure, and cap the probes per host

### Documentation

- **site:** show the package logo as the splash hero image

## 3.0.0

This release has 1 breaking change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- **eslint-config:** let dprint own layout and keep only the stylistic rules it cannot express

## 2.2.0

This release has 1 new feature and 2 fixes.

### New

- **eslint-config:** fix a boolean literal ternary branch in TypeScript

### Fixed

- **docs-site:** never link a type declared in a module the owning site does not document
- **nano-staged:** batch the staged paths so a large commit fits the command line

## 2.1.0

This release has 1 new feature and 2 documentation changes.

### New

- **commitlint:** declare config-conventional and export commitlintConfig

### Documentation

- link the documentation site from the README
- cite obsidian-dataview's declarations as the validated example

## 2.0.0

This release has 1 breaking change, 1 new feature and 1 documentation change.

### Breaking changes

- **eslint:** register the in-house rules under the typescript-dev-toolkit namespace

### New

- **docs-site:** add the shared documentation-site builder and this package's site

### Documentation

- mark plugin names as code in AGENTS.md and comments

## 1.3.1

This release has 1 fix.

### Fixed

- **markdownlint:** skip linkinator when linkCheckExcludeGlobs leaves no file

## 1.3.0

This release has 3 new features and 1 fix.

### New

- **env-toggle:** export exitIfScriptDisabled for scripts outside wrapCliTask
- **markdownlint:** let lint() exclude globs from its linkinator pass
- **git:** export readIndexContent to read a staged blob as raw bytes

### Fixed

- **cli-utils:** exit with process.exitCode when a task returns nothing

## 1.2.0

This release has 1 new feature.

### New

- **library-build:** give each module and declaration only the globals it needs

## 1.1.0

This release has 1 new feature and 1 fix.

### New

- **linters:** tell a crashed ESLint apart from lint findings

### Fixed

- **library-build:** reference a directives-only declaration from every subpath, not the root barrel

## 1.0.0

- Initial release as a standalone repository: the package moved out of the [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) workspace with its history, and its version line restarts at `1.0.0`
