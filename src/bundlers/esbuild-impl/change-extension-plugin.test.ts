import {
  describe,
  expect,
  it
} from 'vitest';

import { rewriteImportPathExtensions } from './change-extension-plugin.ts';

describe('rewriteImportPathExtensions', () => {
  describe.each([
    '.mjs',
    '.cjs'
  ])('extension %s', (extension) => {
    it('rewrites require() paths', () => {
      expect(rewriteImportPathExtensions('require(\'../foo.ts\')', extension)).toBe(`require('../foo${extension}')`);
    });

    it('rewrites double-quoted require() paths, keeping the quote', () => {
      expect(rewriteImportPathExtensions('require("../foo.ts")', extension)).toBe(`require("../foo${extension}")`);
    });

    it('rewrites single-quoted static from paths', () => {
      expect(rewriteImportPathExtensions('import { foo } from \'../foo.ts\';', extension)).toBe(`import { foo } from '../foo${extension}';`);
    });

    it('leaves an import() spelled inside a double-quoted string literal parseable', () => {
      const source = 'const message = "A dynamic `import(\'{{specifier}}\')` stays";';
      expect(rewriteImportPathExtensions(source, extension)).toBe(source);
    });

    it('leaves a require() spelled inside a single-quoted string literal parseable', () => {
      const source = 'const message = \'Use require("{{specifier}}") instead\';';
      expect(rewriteImportPathExtensions(source, extension)).toBe(source);
    });

    it('keeps the quote of a .ts path spelled inside a string literal', () => {
      const source = 'const message = "Call import(\'./foo.ts\') here";';
      expect(rewriteImportPathExtensions(source, extension)).toBe(`const message = "Call import('./foo${extension}') here";`);
    });

    it('does not match across two calls on one line', () => {
      const source = 'require("a") + require(\'./b.ts\')';
      expect(rewriteImportPathExtensions(source, extension)).toBe(`require("a") + require('./b${extension}')`);
    });

    it('leaves a path whose extension only contains .ts untouched', () => {
      expect(rewriteImportPathExtensions('import("./foo.tsx")', extension)).toBe('import("./foo.tsx")');
    });

    it('rewrites static from paths', () => {
      expect(rewriteImportPathExtensions('export { foo } from "../foo.ts";', extension)).toBe(`export { foo } from "../foo${extension}";`);
    });

    it('rewrites dynamic import() paths', () => {
      expect(rewriteImportPathExtensions('const { foo } = await import("../foo.ts");', extension)).toBe(`const { foo } = await import("../foo${extension}");`);
    });

    it('rewrites single-quoted dynamic import() paths', () => {
      expect(rewriteImportPathExtensions('const { foo } = await import(\'../foo.ts\');', extension)).toBe(`const { foo } = await import('../foo${extension}');`);
    });

    it('leaves an already-resolved dynamic import() path untouched', () => {
      expect(rewriteImportPathExtensions('import("../foo.mjs")', extension)).toBe('import("../foo.mjs")');
    });

    it('rewrites the open-demo-vault regression case', () => {
      const source = 'const { openDemoVault } = await import("../desktop-demo-vault-opener.ts");';
      const expected = `const { openDemoVault } = await import("../desktop-demo-vault-opener${extension}");`;
      expect(rewriteImportPathExtensions(source, extension)).toBe(expected);
    });
  });
});
