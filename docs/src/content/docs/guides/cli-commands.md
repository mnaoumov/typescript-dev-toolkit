---
title: Commands
description: Build, lint, format, spellcheck, test, gate and release commands, callable from a script or the CLI.
---

`@mnaoumov/typescript-dev-toolkit` exposes its commands as functions, one module per tool. Each is identified by its import subpath. Import one and call it from a script:

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/auto';

await lint();
```

## Available Commands

### Clean the build folder

```typescript
import { buildClean } from '@mnaoumov/typescript-dev-toolkit/build';
```

Cleans the `dist` folder.

### Compile code

```typescript
import { buildCompile } from '@mnaoumov/typescript-dev-toolkit/build';
```

Checks that the code compiles: Svelte when the project has any, then TypeScript. A project script `build:compile:svelte` or `build:compile:typescript` replaces the matching half.

### Compile TypeScript code

```typescript
import { buildCompileTypeScript } from '@mnaoumov/typescript-dev-toolkit/build';
```

Checks that the TypeScript code compiles. It type-checks the project's own declarations with `skipLibCheck: false` too, so a broken `.d.ts` that ships with a dependency does not fail the build while one of the project's does.

### Compile Svelte code

```typescript
import { buildCompileSvelte } from '@mnaoumov/typescript-dev-toolkit/build';
```

Checks that the Svelte code compiles, by running `svelte-check`.

The project is scanned for `.svelte`, `.svelte.js` and `.svelte.ts` files (ignoring `node_modules`, `dist`, and whatever the `tsconfig.json` `exclude` lists). When there are none, the step is skipped. When there are some, the project must declare `svelte-check` as a dependency, and the step fails with an error naming it otherwise.

### Build templates

```typescript
import { buildTemplates } from '@mnaoumov/typescript-dev-toolkit/build';
```

Copies the `templates` folder to `dist/templates`, stripping a trailing `.template` from each file name (e.g. `eslint.config.mts.template` is copied as `eslint.config.mts`).

### Build a library

```typescript
import {
  buildCleanLibrary,
  buildLibrary,
  buildLibraryTypes,
  generateLibraryExports,
  generateLibraryIndex,
  runBuildSteps
} from '@mnaoumov/typescript-dev-toolkit/library-build';
```

The pipeline every `@mnaoumov` package's `build:*` scripts call: the generated barrels, the declarations, the unbundled CommonJS and ESM output, and the `exports` map of `package.json`. `runBuildSteps` runs, in order, each step the project defines a script for.

`generateLibraryExports` rebuilds the `exports` map from the source folders and throws when it changed, so the change is reviewed and committed. A package that also ships files no source folder builds passes them as `additionalExports`, keyed by subpath, and they go into the map after the generated entries:

<!-- snippet-check: context import { generateLibraryExports } from '@mnaoumov/typescript-dev-toolkit/library-build'; -->
```typescript
await generateLibraryExports({
  additionalExports: {
    './tsconfig/*': './tsconfig/*.json'
  }
});
```

### Format code

```typescript
import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/auto';
```

Formats the code with the formatter the project configures, found from the files at its root, in this order:

1. `dprint.json`: [dprint](https://dprint.dev/).
2. A Prettier configuration (`.prettierrc*`, `prettier.config.*`, or a `prettier` key in `package.json`): [Prettier](https://prettier.io/).
3. `biome.json` or `biome.jsonc`: [Biome](https://biomejs.dev/).

A project with none of them gets dprint. Pass `{ formatter: 'prettier' }` (or `'biome'`, `'dprint'`) to choose one, and `{ rewrite: false }` to check the formatting without changing anything. Each formatter also has a module of its own: `formatters/dprint`, `formatters/prettier` and `formatters/biome`.

When using dprint with the shared ESLint configuration, add these options to the `typescript` section of your project's `dprint.json`:

```json
{
  "typescript": {
    "importDeclaration.sortNamedImports": "maintain",
    "useBraces": "always"
  }
}
```

`useBraces` keeps single-line control-flow bodies compatible with ESLint's required braces. Preserving named-import order lets ESLint sort by local aliases; dprint would otherwise sort by imported names and undo the lint fix. The formatter reads your configuration as given, so updating the toolkit alone does not change these project options.

Prettier and Biome are optional peers, so install the one you use (`npm install --save-dev prettier` or `npm install --save-dev @biomejs/biome`). The package ships a shared configuration for each, written to match the dprint style as closely as the tool allows: single quotes, no trailing commas, semicolons, two-space indentation, parentheses around every arrow parameter, and a 120-column line, because both re-wrap every statement to their line width.

For Prettier, `prettier.config.mjs`:

```javascript
import { getPrettierConfig } from '@mnaoumov/typescript-dev-toolkit/formatters/prettier';

export default {
  ...getPrettierConfig(),
  // Your own options.
};
```

A project with no Prettier configuration at all is formatted with the shared one. Markdown and lockfiles are left alone, as with dprint, and `.gitignore` and `.prettierignore` are honored.

For Biome, `biome.json`:

```json
{
  "extends": ["./node_modules/@mnaoumov/typescript-dev-toolkit/assets/biome.json"]
}
```

A project with no `biome.json` gets that file written on the first run. The shared configuration reads `.gitignore`, so the project must be a git repository.

### Lint code

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/auto';
```

Lints the code with ESLint when the project has an `eslint.config.*` file, with Biome when it has only a `biome.json` or `biome.jsonc`, and with ESLint when it has neither. Pass `{ linter: 'biome' }` or `{ linter: 'eslint' }` to choose one, and `{ shouldFix: true }` to apply the autofixes. A warning fails either linter.

ESLint (`linters/eslint`) reports a run that never finished linting (a rule crash, a broken config or path) as such rather than as findings, because the two need different fixes. The shared ESLint config keeps only the nine `@stylistic` rules a formatter cannot express, and a test checks that they agree with dprint, Prettier and Biome alike, so any of the three can own layout beside it.

The shared configuration requires readonly property references in interfaces and object type aliases. To also prohibit mutation through member arrays, explicitly enable `typescript-dev-toolkit/readonly-member-arrays` at `error` in your ESLint configuration. This separate rule suggests `readonly T[]` for `T[]` and `ReadonlyArray<T>` for the builtin `Array<T>`, including nullable unions and nested object properties. A locally declared `Array` is ignored, and a locally declared `ReadonlyArray` prevents the generic suggestion. Suggestions require review of callers: `push`, indexed writes and passing the value to a mutable-array parameter can stop compiling. There is no automatic fix, and the shared configuration leaves this collection policy off. An intentional mutable collection can carry an explained disable for this rule. This is shallow enforcement of directly written member array types; it does not resolve array aliases or make nested arrays, tuples, method signatures or generic containers immutable.

Biome (`linters/biome`) lints with its recommended rules from the shared `biome.json`, which also turns off `useLiteralKeys` (TypeScript's `noPropertyAccessFromIndexSignature` asks for the opposite) and the unused-variable rules in `.astro`, `.svelte` and `.vue` files, whose markup Biome does not read.

### Lint Markdown

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint';
```

Lints the Markdown with `markdownlint-cli2`, then checks its links with `linkinator`. Pass `{ shouldFix: true }` to apply the autofixes.

To leave some links unchecked for one run, set `LINK_CHECK_SKIP` to a comma-separated list. An entry holding `://` is a URL prefix and skips every link starting with it. Any other entry is a host and skips the links to exactly that host, so `mail.tm` does not skip `docs.mail.tm`. Use it for a host your network blocks, or for a link that only the release you are cutting will publish:

```sh
LINK_CHECK_SKIP=mail.tm,https://github.com/owner/repo/releases/tag/1.2.3 npm run lint:md
```

Every skipped link prints a `WARNING` line naming the file, and so does an entry that skipped nothing. Set the variable on the command that needs it, never in `.env`. It is read from `.env` like every other variable, but a skip that stays there lets a link go stale with nothing to report it.

### Spellcheck

```typescript
import { spellcheck } from '@mnaoumov/typescript-dev-toolkit/linters/cspell';
```

Checks the project for spelling errors with `cspell`.

### Find over-exposed declarations

```typescript
import { findOverExposure } from '@mnaoumov/typescript-dev-toolkit/linters/over-exposure';
```

Reports declarations exposed more broadly than their references require: an `export`ed symbol referenced only within its own file, or a `public` / `protected` class member referenced only inside its own class or its subclasses. The analysis is whole-program and type-aware. A declaration carrying a TSDoc comment is treated as intended public API and is never reported.

Pass `shouldFix: true` to tighten every finding that can be tightened safely, and `shouldForce: true` as well to tighten the ones only test files hold wide.

### Test

```typescript
import {
  test,
  testCoverage,
  testWatch
} from '@mnaoumov/typescript-dev-toolkit/test-runners/auto';
```

Runs the test suite once, once with v8 coverage, or in watch mode, with the runner the project configures, found from the files at its root, in this order:

1. `vitest.config.*`: [Vitest](https://vitest.dev/).
2. `jest.config.*`, or a `jest` key in `package.json`: [Jest](https://jestjs.io/).

A project with neither gets Vitest. A `vite.config.*` does not count, since a project can bundle with vite and test with jest. Pass `{ runner: 'jest' }` (or `'vitest'`) to choose one, `{ projects: ['unit-tests'] }` to run some projects only, and `{ minCoverageInPercents: 100 }` to `testCoverage` to fail below that coverage of lines, functions, branches and statements alike. Each runner also has a module of its own: `test-runners/vitest` and `test-runners/jest`. The two read `projects` differently: Vitest also runs each name's `name:*` sub-projects, while jest's `--selectProjects` matches a `displayName` exactly.

The Vitest wrappers honor `BULK_CORES` when it is a positive safe integer. For example, `BULK_CORES=2` caps a run at two workers, while a selected project configured for one worker keeps the entire invocation serial. The cap also respects a smaller inherited `VITEST_MAX_WORKERS` setting. Missing or invalid budgets leave Vitest's ordinary behavior unchanged. In bulk mode the configuration is resolved before the CLI starts, so it loads twice; keep configuration modules free of side effects.

Pass `{ additionalArguments: [...] }` to append further runner CLI arguments after the wrapper's own: file filters, `-t`, `--maxWorkers`, `--reporter` or `--bail`. A script entry point forwards its own arguments that way, so `npm test -- src/foo.test.ts --maxWorkers=2` runs that one file on two workers. An argument naming an option the wrapper sets itself throws instead of being forwarded, because it would not override the wrapper reliably: Vitest adds every `--project` to the wrapper's own, and a later `--coverage.thresholds.lines` would quietly lower the coverage gate. For Vitest those are `--project`, `--coverage` and `--coverage.*`, `--run` and `--watch`; for Jest `--selectProjects`, `--coverage`, `--collectCoverage`, `--coverageThreshold`, `--watch` and `--watchAll`. An explicit `--maxWorkers` replaces the `BULK_CORES` cap, since a CLI limit replaces the environment one.

#### Jest

Jest and ts-jest are optional peers, so install them when you use jest:

```bash
npm install --save-dev jest ts-jest
```

`jest.config.ts`:

```typescript
import { defineJestConfig } from '@mnaoumov/typescript-dev-toolkit/test-runners/jest-config';

export default defineJestConfig({
  // Your own jest options; each one replaces its default.
  testEnvironment: 'jsdom'
});
```

`defineJestConfig` sets:

- the tests: `src/**/*.test.ts`, never under `node_modules` or `dist`, in the `node` environment;
- the ts-jest transform for `.ts`, `.tsx`, `.mts` and `.cts`, with `isolatedModules`, so each file is transpiled on its own without a type check, as Vitest does;
- a `moduleNameMapper` entry that resolves a relative `./foo.js` import onto `./foo.ts`, which a `module: nodenext` project writes, and which TypeScript writes for `./foo.ts` under `rewriteRelativeImportExtensions`;
- v8 coverage over `src/`, without the barrels, the declarations, the tests and the test helpers, into `coverage/`: the same files the Vitest library configuration reports.

Every jest option you pass replaces its default, except `moduleNameMapper`, whose entries are added to the `.js` one. It also takes two options of its own:

- `esm`: whether jest loads the project as ES modules (`extensionsToTreatAsEsm` and ts-jest's `useESM`). It defaults to `true` when `package.json` declares `"type": "module"`.
- `tsJestOptions`: ts-jest options spread over the defaults, e.g. `{ tsconfig: 'tsconfig.test.json' }`. A `tsconfig` given here replaces the `{ isolatedModules: true }` default.

Jest's ESM loader needs Node's `--experimental-vm-modules` flag. The jest runner adds it to `NODE_OPTIONS`, keeping what that variable already holds, by the same `"type": "module"` rule; pass `{ esm: false }` or `{ esm: true }` to override it. `testWatch` runs `jest --watch`, which needs a git or Mercurial repository to find the changed files.

### Mutation testing

```typescript
import { testMutation } from '@mnaoumov/typescript-dev-toolkit/test-runners/stryker';
```

Runs [Stryker](https://stryker-mutator.io/) on demand over Vitest. It is slow, so it never belongs in a commit hook or the branch gate: a full run over a few hundred modules takes about an hour. Pass `{ modulePaths: ['src/foo.ts'] }` to mutate those modules and run only their sibling `*.test.ts` files; with no paths it mutates everything, incrementally. Stryker and its Vitest runner are optional peers, and the runner must be 10.1.1 or later, the first release that matches test names the way Vitest 5 does:

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner
```

`stryker.config.mjs`:

```javascript
import { defineStrykerConfig } from '@mnaoumov/typescript-dev-toolkit/test-runners/stryker-config';

export default defineStrykerConfig();
```

`vitest.stryker.config.ts`, a single flattened project Stryker runs its mutants against:

```typescript
import type { ViteUserConfig } from 'vitest/config';

import { getStrykerTestInclude } from '@mnaoumov/typescript-dev-toolkit/test-runners/stryker-config';

const config: ViteUserConfig = {
  test: {
    environment: 'node',
    exclude: ['node_modules', 'dist', 'src/**/*.integration.test.ts'],
    include: getStrykerTestInclude(['src/**/*.test.ts'])
  }
};

export default config;
```

Add `/.stryker-tmp`, `/reports` and `/stryker-setup-*.js` to `.gitignore`. `defineStrykerConfig` runs Stryker in place, because its sandbox copy breaks module resolution through `node_modules`. In place, Stryker puts the whole tree back as it was when the run started, so `testMutation` refuses a tree with uncommitted changes, and nothing may be edited during a run. It also sets `vitest.related: false`, since the scoped run names its tests itself, and keeps Stryker out of `docs/`, `dist/` and `coverage/`. Each key you pass replaces its default. Lines under `/* v8 ignore */` still show up as `NoCoverage`, because Stryker does not read those comments.

### Branch gate

```typescript
import { gate } from '@mnaoumov/typescript-dev-toolkit/gate';
```

Runs the checks a release runs as its preflight, as a command of its own, so a branch finds out in seconds what would otherwise fail the release minutes in. The steps run fastest-first:

`format:check` → `spellcheck` → `lint:md` → `build` → `lint` → `find-overexposed` → `test:coverage`

A step the project defines no script for is skipped. `--no-build` skips the build when its output is current, and `--integration` runs `test:integration` last.

### Release

```typescript
import { updateVersion } from '@mnaoumov/typescript-dev-toolkit/version';
```

Runs the gate, bumps the version, writes `CHANGELOG.md`, commits, tags, pushes and creates the GitHub release. It refuses a bump lower than the commits since the last release require, a changelog section that fails `lint:md` or `spellcheck`, and a run without a terminal unless it is given `--changelog-file <path>` or `--no-changelog-editing`.

### Publish

```typescript
import { publish } from '@mnaoumov/typescript-dev-toolkit/npm-publish';
```

Publishes the package to NPM. It carries no credentials of its own: run it from a CI job registered as a [trusted publisher](https://docs.npmjs.com/trusted-publishers) for the package, where the npm CLI trades the job's OIDC token for a publish grant.

### Documentation site

```typescript
import {
  buildDocsSite,
  devDocsSite,
  previewDocsSite
} from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-commands';
```

Builds, serves or previews a package's Astro + Starlight documentation site: the guides under `docs/src/content/docs`, and an API reference generated from the package's TSDoc. The build also renders an Open Graph card per page and checks every link of the output. Each takes the same configuration the site's `astro.config.ts` passes to `defineDocsSiteConfig` (`@mnaoumov/typescript-dev-toolkit/docs-site/astro-config`). Astro, Starlight and the generator's other dependencies are optional peers, which a project installs only to build a site.

`devDocsSite` and `previewDocsSite` pass the script's own command-line arguments on to `astro dev` and `astro preview`, so `npm run docs:preview -- --port 4399` serves on that port. Pass an array as the second argument to give Astro other arguments.

#### Repository homepage

Set `repoHomepage` in the site's configuration to have `buildDocsSite` keep the repository's GitHub homepage pointing at the site. The URL it expects is the site's own: Astro's `site` plus its `base`, with a trailing slash.

<!-- snippet-check: context import type { DocsSiteConfig } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-config'; -->
```typescript
export const DOCS_SITE_CONFIG: DocsSiteConfig = {
  owner: 'your-account',
  repo: 'your-package',
  repoHomepage: 'set',
  siteOrigin: 'https://your-account.github.io',
  title: 'Your Package'
};
```

- `'off'` (the default) does nothing.
- `'check'` compares the homepage with the site's URL and, on a mismatch, prints a warning with the `gh repo edit <owner>/<repo> --homepage <url>` line that fixes it.
- `'set'` also sets a mismatched homepage, through the `gh` CLI with the credentials it already has.

It never fails the build. A workflow's `GITHUB_TOKEN` can read the homepage but cannot change repository settings, so in CI `'set'` reports the mismatch like `'check'`, as a `::warning::` annotation. Pass the token to the build step as `GH_TOKEN` so `gh` can read the repository; run `docs:build` once locally, or the printed command, to set it.

#### Guide snippets

```typescript
import {
  assertDocsSnippetsCompile,
  findDocsSnippetProblems
} from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-snippets';
```

Type-checks every fenced `ts`, `typescript`, `js` and `javascript` block of the guides under `docs/src/content/docs`, the generated `api` folder excepted, each as a module of its own, with the project's `tsconfig.json`. A JavaScript block is checked with `checkJs` and is not held to implicit `any`. `assertDocsSnippetsCompile` throws listing every problem as `path:line - TS<code>: <message>`, for a `docs:check-snippets` script; `findDocsSnippetProblems` returns them, for a test.

- `prelude` declares the names every guide may use without declaring them, as a module: a `declare global { ... }` block with the imports it needs.
- `compilerOptions` is laid over the `tsconfig.json` ones. A package whose guides import it by its own name passes `paths` mapping that name onto its sources, with absolute paths.
- `<!-- snippet-check: context <TypeScript> -->` on a line above a fence prepends declarations or imports to that one block, for a name its prose has introduced. Several such lines add up.
- `<!-- snippet-check: skip <reason> -->` above a fence exempts a block that is deliberately not compilable. A skip without a reason is reported.

#### Outdated references

```typescript
import { assertNoOutdatedReferences } from '@mnaoumov/typescript-dev-toolkit/docs-site/outdated-references';
```

Fails on a reference that sends a reader to the retired `obsidian-dev-utils` package: one of its module paths, a link into its repository, an import of it, or its legacy `__obsidianDevUtils.sharedAbortController` console recipe. The bare name is not flagged, because it is still a wire name. It scans `README.md`, the guides (not the `api` folder), and every non-test `.ts` file under `src/` and `scripts/`, skipping whichever is missing. A line that names an old address on purpose carries `outdated-reference-ok`.

### Sync upstreams

```bash
npx sync-upstreams [--dry-run] [--only=<name>[,<name>]] [--base=<branch>] [--config=<path>]
```

For a repository that vendors upstream code: checks every upstream that `upstreams.json` lists and opens or updates one PR per upstream that moved, on the branch `upstream/<name>`. The PR carries the upstream compare link, the changed upstream files, the output of the handler and the verify command, and the diff summary of what was generated. A failing handler or verify still opens the PR, as a draft, so a breaking upstream change is seen rather than skipped. Nothing is merged automatically.

```json
{
  "verify": "npm run lint && npm test",
  "upstreams": [
    {
      "name": "sample",
      "repo": "owner/sample",
      "ref": "main",
      "commit": "<the commit the vendored copy matches>",
      "paths": ["src/**"],
      "handler": "npm run sync:sample"
    },
    {
      "name": "lib",
      "npm": "some-lib",
      "tag": "latest",
      "version": "1.2.3",
      "handler": "npm run sync:lib",
      "verify": "npm run build"
    }
  ]
}
```

A git entry follows a branch or tag on GitHub, pinned to a commit, and a move that touches none of its `paths` (globs) opens no PR. An npm entry follows a dist-tag (`latest` when absent), pinned to a version. The handler is a shell command that turns the newer upstream into changes in this repository; it runs with `UPSTREAM_NAME` and `UPSTREAM_TARGET` (the new commit or version) set, and the sync then records the new pin unless the handler already moved it. An entry's own `verify` replaces the top-level one.

`--dry-run` prints each PR and changes nothing. `--base` names the branch the PRs target (`main` by default). `GITHUB_TOKEN` is sent to the GitHub API when set, and `gh` must be authenticated for anything but a dry run. The same logic is importable from `@mnaoumov/typescript-dev-toolkit/upstream-sync` (`syncUpstreams`) and `@mnaoumov/typescript-dev-toolkit/upstream-sync-cli` (`runSyncUpstreamsCli`).

To run it on a schedule, call the reusable workflow, pinned to a release tag:

```yaml
on:
  schedule:
    - cron: '17 4 * * *'
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  sync:
    uses: mnaoumov/typescript-dev-toolkit/.github/workflows/sync-upstreams.yml@3.3.0
```

It takes `install-command` (`npm ci`), `setup-command` (none), `sync-command` (`npx sync-upstreams`), `node-version-file` (`.nvmrc`), `config`, `base` (the branch the workflow runs on), `only` and `dry-run` as inputs. A PR opened with `GITHUB_TOKEN` triggers no other workflow, which is why the verify command runs inside the sync.

## Script entry points

Run the commands through `npm run` with a [jiti](https://github.com/unjs/jiti) entry point per script:

```json
{
  "scripts": {
    "build": "jiti scripts/build.ts",
    "format": "jiti scripts/format.ts",
    "gate": "jiti scripts/gate.ts",
    "lint": "jiti scripts/lint.ts",
    "test": "jiti scripts/test.ts",
    "version": "jiti scripts/version.ts"
  }
}
```

Each script wraps its command in `wrapCliTask`, which turns a thrown error into a failing exit code:

```typescript
import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/auto';

await wrapCliTask(async () => {
  await lint();
});
```

## Skipping a command

Every npm script can be switched off by an environment variable: take the script's name, uppercase it, and replace every non-alphanumeric character with `_`. `LINT_MD=0 npm run lint:md` prints `Skipped (LINT_MD is off).` and succeeds. The off values are `0`, `false`, `off` and `no`, and the variable can sit in a gitignored `.env` file.

## Ignored paths follow `.gitignore`

The commands that walk the whole project (`lint`, `lint:md`, `format`, `spellcheck`) skip whatever `.gitignore` skips, so a generated folder is excluded from every check the moment it is gitignored.
