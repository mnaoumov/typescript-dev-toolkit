# @mnaoumov/typescript-dev-toolkit

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![npm version](https://img.shields.io/npm/v/@mnaoumov/typescript-dev-toolkit)](https://www.npmjs.com/package/@mnaoumov/typescript-dev-toolkit) [![npm downloads](https://img.shields.io/npm/dm/@mnaoumov/typescript-dev-toolkit)](https://www.npmjs.com/package/@mnaoumov/typescript-dev-toolkit) [![CI](https://img.shields.io/github/actions/workflow/status/mnaoumov/typescript-dev-toolkit/ci.yml?branch=main&label=CI)](https://github.com/mnaoumov/typescript-dev-toolkit/actions/workflows/ci.yml) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/typescript-dev-toolkit) [![License](https://img.shields.io/github/license/mnaoumov/typescript-dev-toolkit)](https://github.com/mnaoumov/typescript-dev-toolkit/blob/main/LICENSE) [![Node.js](https://img.shields.io/node/v/@mnaoumov/typescript-dev-toolkit)](https://nodejs.org/) [![Types](https://img.shields.io/npm/types/@mnaoumov/typescript-dev-toolkit)](https://www.npmjs.com/package/@mnaoumov/typescript-dev-toolkit)

Generic tooling for TypeScript projects: the build, lint, format, spellcheck, test, gate and release scripts, the shared commitlint, nano-staged and markdownlint configurations, and custom ESLint rules. Install it as a dev dependency.

## Installation

```bash
npm install --save-dev @mnaoumov/typescript-dev-toolkit
```

## Documentation

The guides and the API reference are at <https://mnaoumov.dev/typescript-dev-toolkit/>.

## Publish release assets before the version bump

For a project whose updater reads a version file on its default branch and then downloads matching GitHub release assets, opt into publication before the branch push:

```typescript
import { updateVersion } from '@mnaoumov/typescript-dev-toolkit/version';

await updateVersion('patch', {
  getReleaseAssetPaths: () => Promise.resolve(['dist/main.js']),
  shouldEditChangelog: false,
  shouldPublishBeforePush: true
});
```

Use `updateVersionInExtraFiles` to update project-specific version files and `prepareGitHubRelease` to prepare assets. Preparation and asset validation finish before any push. The release tag is pushed to `origin` first, then the release is published and checked for its exact tag, non-draft status and completed asset uploads. Only then is the verified version commit pushed to the original branch, followed by issue closing. Missing assets or a failed publication or verification leave the remote branch unchanged. Local commits and tags, and any remote tag or release already created, remain for recovery; this mode does not roll them back.

The default npm release order is unchanged. `shouldRelease: false` keeps all work local with either order.

## Where it fits

It is one of five packages that replace [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils): [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib), [`@mnaoumov/typescript-test-toolkit`](https://github.com/mnaoumov/typescript-test-toolkit), [`@mnaoumov/typescript-dev-toolkit`](https://github.com/mnaoumov/typescript-dev-toolkit), [`@mnaoumov/obsidian-lib`](https://github.com/mnaoumov/obsidian-lib) and [`@mnaoumov/obsidian-dev-toolkit`](https://github.com/mnaoumov/obsidian-dev-toolkit). It depends on [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib). It moved here from that repository with its history.

## See also

<!-- cspell:words TSDX -->

| Tool | Features | How `@mnaoumov/typescript-dev-toolkit` differs |
| --- | --- | --- |
| [`@mnaoumov/obsidian-dev-toolkit`](https://github.com/mnaoumov/obsidian-dev-toolkit) (my tool) | Obsidian plugin builds; demo vaults; plugin releases; plugin-specific lint and test setup | Generic foundation of `@mnaoumov/obsidian-dev-toolkit`; usable outside Obsidian; leaves plugin packaging and demo vaults to that extension |
| [`gts`](https://github.com/google/gts) | TypeScript style guide; ESLint and Prettier configuration; project setup and compilation | Overlaps with `gts` in shared lint and format tooling; adds ESM/CommonJS packaging, test runners, spellcheck, documentation sites and release orchestration; uses its own conventions rather than Google's style guide |
| [`np`](https://github.com/sindresorhus/np) | Interactive npm publishing; release branch, clean tree and behind-remote checks; tests before the bump; dry-run mode; GitHub release draft | Covers part of `np`: the same pre-release checks and dry-run; adds changelog generation, lint, build and test gates; publishes to npm from CI through trusted publishing rather than from the developer's machine; no interactive version prompt |
| [`release-it`](https://github.com/release-it/release-it) | Version bump; git commit, tag and push; GitHub and GitLab releases; changelog; npm publish; hooks and plugins | Covers part of `release-it`: version bump, tag, push, GitHub release and changelog; adds Conventional Commits bump floor and changelog checks; no plugin system or GitLab releases |
| [`semantic-release`](https://github.com/semantic-release/semantic-release) | Next version from commit messages; release notes; publishing from CI; plugins | Covers part of `semantic-release`: Conventional Commits changelog and a bump floor from commit messages; releases from a developer machine with a reviewed changelog rather than on every CI push |
| [`tsdown`](https://tsdown.dev/) | Rolldown-based library builds; declaration generation; Rollup and unplugin plugin support | Overlaps with `tsdown` in library builds; adds lint, format, test and release tooling; uses esbuild rather than the Rolldown plugin ecosystem |
| [`TSDX`](https://tsdx.io/docs) | Package scaffolding; ESM and CommonJS builds; Vitest tests; oxlint and oxfmt commands | Same goal as `TSDX` for TypeScript package development; exposes composable script APIs and shared configurations; adds spellcheck and documentation-site generation; leaves project scaffolding to other tools |
| [`tsup`](https://github.com/egoist/tsup) | esbuild-based library bundling; multiple entry points; watch mode; no longer actively maintained, pointing to `tsdown` | Overlaps with `tsup` in esbuild-based builds; adds shared lint, format, test, gate and release tooling; does not implement the tsup CLI or its configuration API |

Last searched for similar tools on 2026-11-21.

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/typescript-dev-toolkit/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/typescript-dev-toolkit/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
