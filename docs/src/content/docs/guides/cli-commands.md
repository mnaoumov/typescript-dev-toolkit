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

### Format code

```typescript
import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/auto';
```

Formats the code with the formatter the project configures, found from the files at its root, in this order:

1. `dprint.json`: [dprint](https://dprint.dev/).
2. A Prettier configuration (`.prettierrc*`, `prettier.config.*`, or a `prettier` key in `package.json`): [Prettier](https://prettier.io/).
3. `biome.json` or `biome.jsonc`: [Biome](https://biomejs.dev/).

A project with none of them gets dprint. Pass `{ formatter: 'prettier' }` (or `'biome'`, `'dprint'`) to choose one, and `{ rewrite: false }` to check the formatting without changing anything. Each formatter also has a module of its own: `formatters/dprint`, `formatters/prettier` and `formatters/biome`.

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

Biome (`linters/biome`) lints with its recommended rules from the shared `biome.json`, which also turns off `useLiteralKeys` (TypeScript's `noPropertyAccessFromIndexSignature` asks for the opposite) and the unused-variable rules in `.astro`, `.svelte` and `.vue` files, whose markup Biome does not read.

### Lint Markdown

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint';
```

Lints the Markdown with `markdownlint-cli2`, then checks its links with `linkinator`. Pass `{ shouldFix: true }` to apply the autofixes.

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
