import type { Link } from 'mdast';
import type { MdastVisitorContext } from 'satteri';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { pathToFileURL } from 'node:url';
import {
  describe,
  expect,
  it
} from 'vitest';

import { satteriRelativeLinks } from './satteri-relative-links.ts';

describe('satteriRelativeLinks', () => {
  it('rewrites based internal links relative to the current content page', async () => {
    const node = link('/typescript-lib/api/alpha/Alpha/#member');
    const context = mockContext('F:/repo/docs/src/content/docs/api/bravo/Bravo/index.mdx');

    await visit(node, context);

    expect(context.rewrites).toEqual(['../../alpha/Alpha/#member']);
  });

  it('rewrites a self-link to the current directory instead of emitting a 404-ing double slash', async () => {
    const context = mockContext('F:/repo/docs/src/content/docs/api/path/join/index.mdx');
    const plugin = satteriRelativeLinks('/typescript-lib');

    await plugin.link?.(link('/typescript-lib/api/path/join/'), context.value);
    await plugin.link?.(link('/typescript-lib/api/path/join/#overloads'), context.value);

    expect(context.rewrites).toEqual(['./', '#overloads']);
  });

  it('leaves external links unchanged', async () => {
    const context = mockContext('F:/repo/docs/src/content/docs/api/path/join/index.mdx');

    await visit(link('https://example.com'), context);

    expect(context.rewrites).toEqual([]);
  });

  it('leaves an internal link unchanged when the document has no file URL', async () => {
    const context = mockContext(null);

    await visit(link('/typescript-lib/api/alpha/Alpha/'), context);

    expect(context.rewrites).toEqual([]);
  });

  it('resolves against the current document rather than the one memoized from the previous file', async () => {
    // The definition is reused across documents, so the slug memo has to follow the document.
    // A stale one would rewrite every page after the first as though it still sat in that first directory.
    const plugin = satteriRelativeLinks('/typescript-lib');
    const first = mockContext('F:/repo/docs/src/content/docs/api/bravo/Bravo/index.mdx');
    const second = mockContext('F:/repo/docs/src/content/docs/api/charlie/Charlie/index.mdx');

    await plugin.link?.(link('/typescript-lib/api/alpha/Alpha/'), first.value);
    await plugin.link?.(link('/typescript-lib/api/alpha/Alpha/'), second.value);

    expect(first.rewrites).toEqual(['../../alpha/Alpha/']);
    expect(second.rewrites).toEqual(['../../alpha/Alpha/']);
  });

  it('accepts a base with a trailing slash and prefixes a child path with ./', async () => {
    const context = mockContext('F:/repo/docs/src/content/docs/api/alpha/index.mdx');

    await satteriRelativeLinks('/typescript-lib/').link?.(link('/typescript-lib/api/alpha/Alpha/'), context.value);

    expect(context.rewrites).toEqual(['./Alpha/']);
  });

  it('leaves a link alone on a document outside the content collection', async () => {
    const context = mockContext('F:/repo/docs/src/pages/other.mdx');

    await visit(link('/typescript-lib/api/alpha/Alpha/'), context);

    expect(context.rewrites).toEqual([]);
  });
});

interface MockContext {
  rewrites: string[];
  value: MdastVisitorContext;
}

function link(url: string): Link {
  return {
    children: [],
    type: 'link',
    url
  };
}

function mockContext(filePath: null | string): MockContext {
  const rewrites: string[] = [];
  const value = castTo<MdastVisitorContext>({
    fileURL: filePath === null ? undefined : pathToFileURL(filePath),
    setProperty: (_node: unknown, key: string, propertyValue: unknown): void => {
      expect(key).toBe('url');
      rewrites.push(propertyValue as string);
    }
  });

  return {
    rewrites,
    value
  };
}

async function visit(node: Link, context: MockContext): Promise<void> {
  await satteriRelativeLinks('/typescript-lib').link?.(node, context.value);
}
