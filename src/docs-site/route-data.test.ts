import type { APIContext } from 'astro';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import { onRequest } from './route-data.ts';

interface FakeHeadEntry {
  attrs: Partial<Record<string, string>>;
  tag: string;
}

function makeContext(id: string, url: string, head: FakeHeadEntry[]): APIContext {
  return castTo<APIContext>({
    locals: {
      starlightRoute: {
        head,
        id,
        siteTitleHref: '/typescript-lib/'
      }
    },
    url: new URL(url)
  });
}

describe('onRequest', () => {
  it('adds case-preserved Open Graph and Twitter URLs', () => {
    const head: FakeHeadEntry[] = [];

    onRequest(makeContext('api/abort-controller/abortSignalAny/index', 'https://mnaoumov.dev/typescript-lib/api/abort-controller/abortSignalAny/', head));

    expect(head).toEqual([
      { attrs: { content: 'https://mnaoumov.dev/typescript-lib/og/api/abort-controller/abortSignalAny.png', property: 'og:image' }, tag: 'meta' },
      { attrs: { content: '1200', property: 'og:image:width' }, tag: 'meta' },
      { attrs: { content: '630', property: 'og:image:height' }, tag: 'meta' },
      { attrs: { content: 'https://mnaoumov.dev/typescript-lib/og/api/abort-controller/abortSignalAny.png', name: 'twitter:image' }, tag: 'meta' }
    ]);
  });

  it('strips a file extension from the page id', () => {
    const head: FakeHeadEntry[] = [];

    onRequest(makeContext('guides/testing.md', 'https://mnaoumov.dev/typescript-lib/guides/testing/', head));

    expect(head[0]?.attrs['content']).toBe('https://mnaoumov.dev/typescript-lib/og/guides/testing.png');
  });

  it('falls back to the index image when the slug is empty (root page)', () => {
    const head: FakeHeadEntry[] = [];

    onRequest(makeContext('', 'https://mnaoumov.dev/typescript-lib/', head));

    expect(head[0]?.attrs['content']).toBe('https://mnaoumov.dev/typescript-lib/og/index.png');
  });
});
