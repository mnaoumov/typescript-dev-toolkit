import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  createProgram,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind
} from 'typescript';
import {
  describe,
  expect,
  it
} from 'vitest';

// A consumer of one subpath, type-checking with `skipLibCheck: false`, against this package's own BUILT declarations:
// `vitest` is an optional peer, so nothing a consumer of `root` loads may reach it.
describe('the built declarations of the root subpath', () => {
  it.each(['dist/lib/esm/root.d.mts', 'dist/lib/cjs/root.d.cts'])('%s loads nothing from vitest and type-checks clean', (declarationPath) => {
    const rootName = join(process.cwd(), declarationPath);
    expect(existsSync(rootName), `${declarationPath} is missing: run npm run build first`).toBe(true);

    const program = createProgram({
      options: {
        module: ModuleKind.NodeNext,
        moduleResolution: ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: false,
        strict: true
      },
      rootNames: [rootName]
    });

    const fileNames = program.getSourceFiles().map((sourceFile) => sourceFile.fileName);
    expect(fileNames.filter((fileName) => fileName.includes('/node_modules/vitest/'))).toEqual([]);

    const ownDiagnostics = getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.file?.fileName.includes('/dist/lib/') === true);
    expect(ownDiagnostics.map((diagnostic) => diagnostic.file?.fileName)).toEqual([]);
  });
});
