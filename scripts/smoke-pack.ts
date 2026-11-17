/**
 * @file
 *
 * Packs this package, installs the tarball into an empty project, loads every exported module as ESM and as CommonJS,
 * and runs the bins. Run it after `npm run build`; CI runs it after the gate.
 */

import { wrapCliTask } from '../src/cli-utils.ts';
import { smokePack } from '../src/pack-smoke.ts';

await wrapCliTask(() =>
  smokePack({
    installedOptionalPeers: [
      {
        name: 'yaml',
        reason: 'cspell-config-lib and eslint-plugin-unicorn, both dependencies, depend on it'
      }
    ],
    // The documentation-site builder needs its optional peers (Astro, ts-morph, resvg...), and the root barrel
    // re-exports it, which is why a consumer imports a subpath.
    peerBoundModules: ['.', 'docs-site', 'docs-site/**']
  })
);
