# CHANGELOG

## 5.4.1

- fix(markdownlint): warn on a 408 in the link check, and retry it in the site check
- build(deps): override re2js to ^2.9.1 for GHSA-gg6h-894w-4m9c

## 5.4.0

- test(docs-site): run api-docs.test.ts in the slow project, with a hook budget for its beforeAll
- feat(eslint): let prefer-dedent ignore callbacks of named calls, run without the imports

## 5.3.0

- feat(markdownlint): skip links named in LINK_CHECK_SKIP for one run, warning on each

## 5.2.0

- feat(eslint): add prefer-dedent, fixing literal arrays joined with a newline to dedent

## 5.1.0

- fix(eslint): leave a locally bound Promise.resolve() to prefer-noop-async
- feat(test-runners): forward CLI arguments through the test wrappers
- fix(over-exposure): stop reporting symbol-keyed members as unreferenced
- fix(svelte): compile TypeScript components without svelte-preprocess
- feat(eslint): require named patch arguments
- fix(eslint): preserve imports in async no-op fixes
- fix(test): honor bulk worker budgets in Vitest runners
- fix(docs): respect bulk concurrency limits and bound link retries
- fix(format): align dprint with ESLint braces and imports
- feat(eslint): add opt-in readonly member array policy
- fix: honor bulk processor budgets in staged checks

## 5.0.0

1. **Breaking:** enable `typescript-dev-toolkit/no-keyword-identifiers` in the shared ESLint configuration. Bare `object`, `string`, `number`, `boolean`, `symbol`, `bigint`, `undefined`, `arguments`, `function`, `module` and `event` binding names now require a `$` prefix, such as `$object`.
2. Offer scope-aware rename suggestions for local bindings, updating their references while preserving TypeScript annotations. Renames are suggestions only; `lint:fix` never applies them automatically. Contract-sensitive cases and name collisions require a manual rename.
3. Keep compound names, property keys, import aliases and reads of builtin globals legal. Update this package's own bindings to the convention.

## 4.0.0

- feat(eslint)!: require readonly properties in all interfaces

## 3.13.1

- test: give expensive suites a budget for machine load
- build(deps): accept @mnaoumov/typescript-lib 2
- test(library-build): give every buildLibraryTypes case the 30 s build timeout

## 3.13.0

- fix(markdownlint): let a link still rate-limited after the retries pass with a warning
- feat(version): link the issues a commit body names from the release notes

## 3.12.0

- feat(version): fix a generated changelog section nobody reviews before refusing it

## 3.11.0

- feat: refuse a changelog-breaking commit subject at commit time and in the release preflight
- feat(test-runners): an on-demand test:mutation run with Stryker

## 3.10.0

- feat(docs-site): an apiIndexIntro override, and no subpath claim under an importStatement hook

## 3.9.0

- feat(docs-site): a public API barrel mode, and npmjs package links probed on the registry

## 3.8.0

- feat(docs-site): options for import statements, member routes, excluded folders, type params

## 3.7.4

- fix(upstream-sync): quote command output without color codes and lead with the failure
- fix(version): refuse to tag or push a release commit that did not land on the release branch

## 3.7.3

- fix(deps): bump markdownlint-cli2 to ^0.24.0 so consumers stop resolving smol-toml 1.8.0

## 3.7.2

- chore(build): drop the duplicate build:compile:typescript script
- fix(formatters): exclude .claude/settings.local.json from every dprint run

## 3.7.1

- fix(formatters): allow an explicit dprint path list that dprint.json excludes entirely

## 3.7.0

- feat(docs-site): type-check guide snippets and flag retired obsidian-dev-utils addresses

## 3.6.4

- fix(docs-site): keep the target of a bare {@link} in plain-text descriptions

## 3.6.3

- fix(docs-site): escape the braces of a function's return type on its API page

## 3.6.2

- fix(docs-site): re-render the OG cards when the site logo changes
- docs: replace the site logo and favicon with the approved mark

## 3.6.1

- fix(svelte-wrapper-plugin): load esbuild-svelte at setup, not at module load

## 3.6.0

- feat(library-build): let generateLibraryIndex leave named modules off the barrels

## 3.5.0

- fix(library-build): treat node: specifiers and Electron builtins as builtins in validateDependencies

## 3.4.0

- feat(library-build): add validateDependencies, refusing imports a consumer does not install

## 3.3.0

- feat(upstream-sync): ship the upstream sync as a sync-upstreams bin and a reusable workflow
- docs(agents): say the standalone nano-staged entry has no .astro writer, and why
- feat(library-build): take additional exports entries beside the generated ones

## 3.2.0

- feat(nano-staged-config): leave out a shared task whose script the project lacks

## 3.1.0

- feat(test-runners): add a jest runner, defineJestConfig and a dispatcher that picks the runner
- feat(formatters): support Prettier and Biome as formatters and Biome as linter
- fix(docs-site): pass the script's arguments on to astro dev and astro preview
- fix(docs-site): back off longer on a transient external link failure, and cap the probes per host
- feat(docs-site): optionally keep the repository's GitHub homepage pointing at the site
- docs(site): show the package logo as the splash hero image

## 3.0.0

- feat(eslint-config)!: let dprint own layout and keep only the stylistic rules it cannot express
- test(docs-site): give the hundred-card progress test a timeout that fits a loaded machine

## 2.2.0

- fix(docs-site): never link a type declared in a module the owning site does not document
- fix(nano-staged): batch the staged paths so a large commit fits the command line
- feat(eslint-config): fix a boolean literal ternary branch in TypeScript

## 2.1.0

- feat(commitlint): declare config-conventional and export commitlintConfig
- docs: link the documentation site from the README
- docs: cite obsidian-dataview's declarations as the validated example

## 2.0.0

- feat(docs-site): add the shared documentation-site builder and this package's site
- feat(eslint)!: register the in-house rules under the typescript-dev-toolkit namespace
- docs: mark plugin names as code in AGENTS.md and comments

## 1.3.1

- fix(markdownlint): skip linkinator when linkCheckExcludeGlobs leaves no file

## 1.3.0

- feat(env-toggle): export exitIfScriptDisabled for scripts outside wrapCliTask
- feat(markdownlint): let lint() exclude globs from its linkinator pass
- feat(git): export readIndexContent to read a staged blob as raw bytes
- fix(cli-utils): exit with process.exitCode when a task returns nothing

## 1.2.0

- feat(library-build): give each module and declaration only the globals it needs

## 1.1.0

- feat(linters): tell a crashed ESLint apart from lint findings
- fix(library-build): reference a directives-only declaration from every subpath, not the root barrel

## 1.0.0

- Initial release as a standalone repository: the package moved out of the [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) workspace with its history, and its version line restarts at `1.0.0`
