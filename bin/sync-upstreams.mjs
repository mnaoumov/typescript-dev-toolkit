#!/usr/bin/env node

// The `sync-upstreams` command. The logic lives in `src/upstream-sync-cli.ts`, built into `dist/`.
import process from 'node:process';

import { runSyncUpstreamsCli } from '../dist/lib/esm/upstream-sync-cli.mjs';

process.exitCode = await runSyncUpstreamsCli(process.argv.slice(2));
