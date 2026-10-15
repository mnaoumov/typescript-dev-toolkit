# CHANGELOG

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
