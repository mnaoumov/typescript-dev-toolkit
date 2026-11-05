#!/usr/bin/env node

// The `rewrite-changelog` command. The logic lives in `src/changelog-rewrite-cli.ts`, built into `dist/`.
import process from 'node:process';

import { runRewriteChangelogCli } from '../dist/lib/esm/changelog-rewrite-cli.mjs';

process.exitCode = await runRewriteChangelogCli(process.argv.slice(2));
