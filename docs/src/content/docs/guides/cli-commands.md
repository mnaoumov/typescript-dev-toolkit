---
title: Commands
description: Build, lint, format, spellcheck, test, gate and release commands, callable from a script or the CLI.
---

`@mnaoumov/typescript-dev-toolkit` exposes its commands as functions, one module per tool. Each is identified by its import subpath. Import one and call it from a script:

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/eslint';

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
import { format } from '@mnaoumov/typescript-dev-toolkit/formatters/dprint';
```

Formats the code with [dprint](https://dprint.dev/). Pass `{ rewrite: false }` to check the formatting without changing anything.

### Lint code

```typescript
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/eslint';
```

Lints the code with ESLint. A warning fails it. Pass `{ shouldFix: true }` to apply the autofixes.

A run that never finished linting (a rule crash, a broken config or path) is reported as such rather than as findings, because the two need different fixes.

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
} from '@mnaoumov/typescript-dev-toolkit/test-runners/vitest';
```

Runs the test suite with Vitest: once, once with v8 coverage, or in watch mode.

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
import { lint } from '@mnaoumov/typescript-dev-toolkit/linters/eslint';

await wrapCliTask(async () => {
  await lint();
});
```

## Skipping a command

Every npm script can be switched off by an environment variable: take the script's name, uppercase it, and replace every non-alphanumeric character with `_`. `LINT_MD=0 npm run lint:md` prints `Skipped (LINT_MD is off).` and succeeds. The off values are `0`, `false`, `off` and `no`, and the variable can sit in a gitignored `.env` file.

## Ignored paths follow `.gitignore`

The commands that walk the whole project (`lint`, `lint:md`, `format`, `spellcheck`) skip whatever `.gitignore` skips, so a generated folder is excluded from every check the moment it is gitignored.
