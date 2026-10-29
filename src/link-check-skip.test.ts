import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  doesLinkCheckSkipEntryMatch,
  extractUrls,
  getLinkCheckSkipWarnings,
  mergeLinkinatorSkipConfig,
  parseLinkCheckSkipEntries,
  readLinkCheckSkipEntries,
  toLinkinatorSkipPattern
} from './link-check-skip.ts';

const { mockLoadEnvFileIfExists } = vi.hoisted(() => ({
  mockLoadEnvFileIfExists: vi.fn()
}));

vi.mock('./env-toggle.ts', () => ({
  loadEnvFileIfExists: mockLoadEnvFileIfExists
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseLinkCheckSkipEntries', () => {
  it('splits on commas, trims, drops blanks and lowercases hosts', () => {
    expect(parseLinkCheckSkipEntries(' Mail.TM , ,https://github.com/owner/repo/releases/tag/1.2.3,')).toEqual([
      { kind: 'host', value: 'mail.tm' },
      { kind: 'prefix', value: 'https://github.com/owner/repo/releases/tag/1.2.3' }
    ]);
  });

  it('yields nothing for a blank value', () => {
    expect(parseLinkCheckSkipEntries('  ')).toEqual([]);
  });

  it('refuses an entry that is neither a host nor a URL prefix', () => {
    expect(() => parseLinkCheckSkipEntries('mail.tm/en')).toThrow('LINK_CHECK_SKIP entry mail.tm/en is neither a host name nor a URL prefix');
  });
});

describe('readLinkCheckSkipEntries', () => {
  it('loads .env first, then reads the variable', () => {
    vi.stubEnv('LINK_CHECK_SKIP', 'mail.tm');
    expect(readLinkCheckSkipEntries()).toEqual([{ kind: 'host', value: 'mail.tm' }]);
    expect(mockLoadEnvFileIfExists).toHaveBeenCalledOnce();
  });

  it('yields nothing when the variable is unset', () => {
    vi.stubEnv('LINK_CHECK_SKIP', undefined);
    expect(readLinkCheckSkipEntries()).toEqual([]);
  });
});

describe('doesLinkCheckSkipEntryMatch', () => {
  const host = { kind: 'host', value: 'mail.tm' } as const;
  const prefix = { kind: 'prefix', value: 'https://github.com/owner/repo/releases/tag/1.2.3' } as const;

  it.each([
    ['https://mail.tm/', true],
    ['https://MAIL.tm:8080/en/faq/', true],
    ['https://docs.mail.tm/', false],
    ['https://mail.tm.example.com/', false],
    ['not a url', false]
  ])('matches a host entry against %s: %s', (url, expected) => {
    expect(doesLinkCheckSkipEntryMatch(url, host)).toBe(expected);
  });

  it.each([
    ['https://github.com/owner/repo/releases/tag/1.2.3', true],
    ['https://github.com/owner/repo/releases/tag/1.2.3#notes', true],
    ['https://github.com/owner/repo/releases/tag/1.2.2', false]
  ])('matches a prefix entry against %s: %s', (url, expected) => {
    expect(doesLinkCheckSkipEntryMatch(url, prefix)).toBe(expected);
  });
});

describe('toLinkinatorSkipPattern', () => {
  it.each([
    ['https://mail.tm', true],
    ['https://mail.tm/en/faq/', true],
    ['https://user@mail.tm:8080?x', true],
    ['https://mail.tm#top', true],
    ['https://docs.mail.tm/', false],
    ['https://mailxtm/', false],
    ['https://mail.tm.example.com/', false],
    ['https://example.org/?u=https://mail.tm/', false]
  ])('the host pattern against %s: %s', (url, expected) => {
    expect(new RegExp(toLinkinatorSkipPattern({ kind: 'host', value: 'mail.tm' })).test(url)).toBe(expected);
  });

  it('anchors and escapes a prefix', () => {
    const regExp = new RegExp(toLinkinatorSkipPattern({ kind: 'prefix', value: 'https://a.b/c?d=1' }));
    expect(regExp.test('https://a.b/c?d=1&e')).toBe(true);
    expect(regExp.test('https://aXb/c?d=1')).toBe(false);
    expect(regExp.test('https://x.y/?u=https://a.b/c?d=1')).toBe(false);
  });
});

describe('extractUrls', () => {
  it('finds the URLs of markdown links, autolinks and bare text, dropping trailing punctuation', () => {
    expect(extractUrls('[a](https://a.example/x) <https://b.example/> see https://c.example/y. and `https://d.example`')).toEqual([
      'https://a.example/x',
      'https://b.example/',
      'https://c.example/y',
      'https://d.example'
    ]);
  });
});

describe('getLinkCheckSkipWarnings', () => {
  it('warns once per skipped link per file, for every unused entry, and about the variable', () => {
    const entries = parseLinkCheckSkipEntries('mail.tm,https://github.com/o/r/releases/tag/1.0.0,unused.example');
    expect(getLinkCheckSkipWarnings(entries, [
      { content: '[a](https://mail.tm/) [b](https://mail.tm/) [c](https://example.com/)', path: 'README.md' },
      { content: 'https://github.com/o/r/releases/tag/1.0.0', path: 'docs/guide.md' }
    ])).toEqual([
      'WARNING: LINK_CHECK_SKIP skips https://mail.tm/ in README.md (entry mail.tm).',
      'WARNING: LINK_CHECK_SKIP skips https://github.com/o/r/releases/tag/1.0.0 in docs/guide.md (entry https://github.com/o/r/releases/tag/1.0.0).',
      'WARNING: LINK_CHECK_SKIP entry unused.example matched no link; remove it.',
      'WARNING: LINK_CHECK_SKIP is set. Set it for one command only, never in .env: a lasting skip lets links go stale unnoticed.'
    ]);
  });

  it('warns about nothing without entries', () => {
    expect(getLinkCheckSkipWarnings([], [{ content: 'https://mail.tm/', path: 'README.md' }])).toEqual([]);
  });
});

describe('mergeLinkinatorSkipConfig', () => {
  const entries = parseLinkCheckSkipEntries('https://a.example/');

  it('builds a config of its own when the project has none', () => {
    expect(mergeLinkinatorSkipConfig(undefined, entries)).toEqual({ skip: [String.raw`^https://a\.example/`] });
  });

  it.each([
    [{ recurse: true, skip: 'x' }, { recurse: true, skip: ['x', String.raw`^https://a\.example/`] }],
    [{ skip: ['x', 'y'] }, { skip: ['x', 'y', String.raw`^https://a\.example/`] }]
  ])('keeps the project config %j', (projectConfig, expected) => {
    expect(mergeLinkinatorSkipConfig(projectConfig, entries)).toEqual(expected);
  });

  it.each([[[]], ['text']])('refuses a project config that is not an object: %j', (projectConfig) => {
    expect(() => mergeLinkinatorSkipConfig(projectConfig, entries)).toThrow('is not a JSON object');
  });
});
