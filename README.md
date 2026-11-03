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

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/typescript-dev-toolkit/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/typescript-dev-toolkit/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
