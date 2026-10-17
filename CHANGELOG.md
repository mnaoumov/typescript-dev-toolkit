# CHANGELOG

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
