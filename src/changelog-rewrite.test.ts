import dedent from 'dedent';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  ChangelogRewriteSource,
  RewrittenChangelogSection
} from './changelog-rewrite.ts';

import {
  rewriteChangelog,
  rewriteReleaseNotes
} from './changelog-rewrite.ts';

function section(overrides: Partial<RewrittenChangelogSection> = {}): RewrittenChangelogSection {
  return { matchedCount: 0, newBody: 'This release has 1 fix.\n\n### Fixed\n\n- one', oldBody: '- fix: one', tag: '1.0.0', version: '1.0.0', ...overrides };
}

function source(tags: readonly string[], commits: Record<string, readonly string[]> = {}): ChangelogRewriteSource {
  return {
    getCommitMessages: vi.fn((fromTag: string | undefined, toTag: string) => Promise.resolve(commits[`${fromTag ?? ''}..${toTag}`] ?? [])),
    tags
  };
}

describe('rewriteChangelog', () => {
  it('should regroup a flat section, recovering issue titles and breaking footers from its tag range', async () => {
    const changelog = dedent`
      # CHANGELOG\r
      \r
      ## 2.0.0\r
      \r
      - test: cover it\r
      - feat: re #99\r
      - fix: drop the cache\r
      - feat: re #99\r
      - docs: explain it (#7)\r
      - fix: hand-edited bullet\r
      \r
      ## 1.0.0\r
      \r
      - feat: first\r\n
    `;
    const repo = source(['1.0.0', '2.0.0'], {
      '..1.0.0': ['feat: first\n'],
      '1.0.0..2.0.0': [
        'chore: release 2.0.0\n',
        'test: cover it\n',
        'feat: re #99\n\nKeep original names\n',
        'fix: drop the cache\n\nBREAKING CHANGE: the cache is gone\n',
        'feat: re #99\n\nKeep original names\n',
        'docs: explain it\n\nRefs #7\n'
      ]
    });

    const result = await rewriteChangelog(changelog, repo);

    expect(result.content).toBe(dedent`
      # CHANGELOG

      ## 2.0.0

      This release has 1 breaking change, 1 new feature, 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

      ### Breaking changes

      - drop the cache

      ### New

      - Keep original names (#99)

      ### Fixed

      - hand-edited bullet

      ### Documentation

      - explain it (#7)

      ## 1.0.0

      This release has 1 new feature.

      ### New

      - first\n
    `);
    expect(result.rewritten.map(({ matchedCount, tag, version }) => ({ matchedCount, tag, version }))).toEqual([
      { matchedCount: 5, tag: '2.0.0', version: '2.0.0' },
      { matchedCount: 1, tag: '1.0.0', version: '1.0.0' }
    ]);
    expect(result.rewritten[1]?.oldBody).toBe('- feat: first');
    expect(result.kept).toEqual([]);
    expect(repo.getCommitMessages).toHaveBeenCalledWith(undefined, '1.0.0');
  });

  it('should match a bullet an older toolkit wrote without its references', async () => {
    const result = await rewriteChangelog('# CHANGELOG\n\n## 1.0.0\n\n- feat: add it\n', source(['1.0.0'], { '..1.0.0': ['feat: add it\n\nRefs #3\n'] }));

    expect(result.content).toBe('# CHANGELOG\n\n## 1.0.0\n\nThis release has 1 new feature.\n\n### New\n\n- add it (#3)\n');
    expect(result.rewritten[0]?.matchedCount).toBe(1);
  });

  it('should keep empty and hand-written sections verbatim, and keep every heading', async () => {
    const changelog = dedent`
      # CHANGELOG

      ## 3.0.0 (2026-01-02)

      A summary a person wrote.

      - feat: something

      ## 2.0.0

      ## 1.0.0

      - fix: one
    `;

    const result = await rewriteChangelog(changelog, source(['v1.0.0', 'v3.0.0']));

    expect(result.kept).toEqual([
      { reason: 'the section is not a plain bullet list, so a person wrote or edited it', version: '3.0.0' },
      { reason: 'the section is empty', version: '2.0.0' }
    ]);
    expect(result.rewritten.map(({ tag, version }) => ({ tag, version }))).toEqual([{ tag: 'v1.0.0', version: '1.0.0' }]);
    expect(result.content).toBe(dedent`
      # CHANGELOG

      ## 3.0.0 (2026-01-02)

      A summary a person wrote.

      - feat: something

      ## 2.0.0

      ## 1.0.0

      This release has 1 fix.

      ### Fixed

      - one\n
    `);
  });

  it('should keep a section whose bullets match no commit and are all prose', async () => {
    const changelog = '# CHANGELOG\n\n## 2.0.0\n\n- Reworded by hand\n- fix: two\n\n## 1.0.0\n\n- Initial release as a standalone repository\n';
    const repo = source(['1.0.0', '2.0.0'], { '..1.0.0': ['chore: initial commit\n'] });

    const result = await rewriteChangelog(changelog, repo);

    expect(result.kept).toEqual([
      { reason: 'no bullet matched a commit or is a Conventional Commits subject, so a person wrote it', version: '1.0.0' }
    ]);
    expect(result.rewritten.map(({ matchedCount, version }) => ({ matchedCount, version }))).toEqual([{ matchedCount: 0, version: '2.0.0' }]);
    expect(result.content).toBe(dedent`
      # CHANGELOG

      ## 2.0.0

      This release has 1 fix and 1 other change.

      ### Fixed

      - two

      ### Other changes

      - Reworded by hand

      ## 1.0.0

      - Initial release as a standalone repository\n
    `);
  });

  it('should group from the bullets alone when the tag range is unknown', async () => {
    const repo = source(['2.0.0']);

    const result = await rewriteChangelog('## 3.0.0\n\n- fix: three\n\n## 2.0.0\n\n- fix: two\n\n## 1.0.0\n\n- fix: one\n', repo);

    expect(result.rewritten.map(({ tag, version }) => ({ tag, version }))).toEqual([
      { tag: undefined, version: '3.0.0' },
      { tag: '2.0.0', version: '2.0.0' },
      { tag: undefined, version: '1.0.0' }
    ]);
    expect(repo.getCommitMessages).not.toHaveBeenCalled();
    expect(result.content.startsWith('## 3.0.0\n\nThis release has 1 fix.')).toBe(true);
  });

  it('should leave a changelog with no section as it is', async () => {
    const result = await rewriteChangelog('# CHANGELOG\n\n', source([]));

    expect(result).toEqual({ content: '# CHANGELOG\n', kept: [], rewritten: [] });
  });
});

describe('rewriteReleaseNotes', () => {
  it('should rewrite notes that are still the section, keeping the compare link', () => {
    expect(rewriteReleaseNotes('- fix: one\r\n\r\n**Full Changelog**: https://example.com/compare/0.9.0...1.0.0\r\n', section())).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- one\n\n**Full Changelog**: https://example.com/compare/0.9.0...1.0.0'
    );
  });

  it('should rewrite notes with no compare link', () => {
    expect(rewriteReleaseNotes('- fix: one\n', section())).toBe('This release has 1 fix.\n\n### Fixed\n\n- one');
  });

  it('should accept notes from before lint:md:fix wrapped names in backticks and escaped brackets', () => {
    const fixed = section({ oldBody: '- fix: keep `Some Plugin` \\[BUG\\] working' });

    expect(rewriteReleaseNotes('- fix: keep Some Plugin [BUG]  working', fixed)).toBe(fixed.newBody);
  });

  it('should refuse notes edited after publishing', () => {
    expect(rewriteReleaseNotes('- fix: one, explained\n\n**Full Changelog**: https://example.com', section())).toBeNull();
    expect(rewriteReleaseNotes('- fix: one, explained\n\n**Full Changelog**: https://example.com', section(), true)).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- one\n\n**Full Changelog**: https://example.com'
    );
  });
});
