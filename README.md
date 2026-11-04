# @mnaoumov/typescript-dev-toolkit

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

[My other Obsidian resources](https://mnaoumov.dev/obsidian/)

| Tool | Features | How `@mnaoumov/typescript-dev-toolkit` differs |
| --- | --- | --- |
| [`@mnaoumov/obsidian-dev-toolkit`](https://github.com/mnaoumov/obsidian-dev-toolkit) (my tool) | Obsidian plugin builds; demo vaults; plugin releases; plugin-specific lint and test setup | Generic foundation of `@mnaoumov/obsidian-dev-toolkit`; usable outside Obsidian; leaves plugin packaging and demo vaults to that extension |
| [`gts`](https://github.com/google/gts) | TypeScript style guide; ESLint and Prettier configuration; project setup and compilation | Overlaps with `gts` in shared lint and format tooling; adds ESM/CommonJS packaging, test runners, spellcheck, documentation sites and release orchestration; uses its own conventions rather than Google's style guide |
| [`tsdown`](https://tsdown.dev/) | Rolldown-based library builds; declaration generation; Rollup and unplugin plugin support | Overlaps with `tsdown` in library builds; adds lint, format, test and release tooling; uses esbuild rather than the Rolldown plugin ecosystem |
| [`TSDX`](https://tsdx.io/docs) | Package scaffolding; ESM and CommonJS builds; Vitest tests; oxlint and oxfmt commands | Same goal as `TSDX` for TypeScript package development; exposes composable script APIs and shared configurations; adds spellcheck and documentation-site generation; leaves project scaffolding to other tools |
| [`tsup`](https://github.com/egoist/tsup) | esbuild-based library bundling; multiple entry points; watch mode | Overlaps with `tsup` in esbuild-based builds; adds shared lint, format, test, gate and release tooling; does not implement the tsup CLI or its configuration API |

Last searched for similar tools on 2026-11-03.

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/typescript-dev-toolkit/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/typescript-dev-toolkit/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
