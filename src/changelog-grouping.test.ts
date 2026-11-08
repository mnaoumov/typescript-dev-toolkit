import {
  describe,
  expect,
  it
} from 'vitest';

import type { ChangelogCommitEntry } from './changelog-grouping.ts';

import {
  escapeLinkBrackets,
  renderGroupedChangelogSection
} from './changelog-grouping.ts';

function entry(text: string, overrides: Partial<ChangelogCommitEntry> = {}): ChangelogCommitEntry {
  return { detailLines: [], entry: text, hasBreakingFooter: false, references: [], ...overrides };
}

describe('renderGroupedChangelogSection', () => {
  it('should say so when there is nothing at all', () => {
    expect(renderGroupedChangelogSection([])).toBe('This release has no changes.');
  });

  it('should count maintenance commits and list nothing when they are all there is', () => {
    expect(renderGroupedChangelogSection([entry('test: cover it'), entry('ci: cache'), entry('refactor: split')])).toBe(
      'This release has maintenance changes only. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.'
    );
  });

  it('should render every section in order, with plural counts', () => {
    expect(renderGroupedChangelogSection([
      entry('Initial commit'),
      entry('docs: explain it'),
      entry('docs(readme): explain more'),
      entry('perf: faster'),
      entry('fix: one'),
      entry('fix: two'),
      entry('feat: new'),
      entry('revert: undo'),
      entry('chore: tidy', { hasBreakingFooter: true }),
      entry('Plain subject', { hasBreakingFooter: true })
    ])).toBe([
      'This release has 2 breaking changes, 1 new feature, 2 fixes, 1 improvement, 2 documentation changes and 2 other changes.',
      '### Breaking changes',
      '- tidy\n- Plain subject',
      '### New',
      '- new',
      '### Fixed',
      '- one\n- two',
      '### Improved',
      '- faster',
      '### Documentation',
      '- explain it\n- **readme:** explain more',
      '### Other changes',
      '- Initial commit\n- undo'
    ].join('\n\n'));
  });

  it('should merge identical entries and union their references', () => {
    expect(renderGroupedChangelogSection([
      entry('docs(readme): link the changelog', { references: ['#1'] }),
      entry('docs(readme): link the changelog', { references: ['#1', '#2'] }),
      entry('docs(readme): link the changelog')
    ])).toBe('This release has 1 documentation change.\n\n### Documentation\n\n- **readme:** link the changelog (#1, #2)');
  });

  it('should keep an issue-only subject when the body carries no title', () => {
    expect(renderGroupedChangelogSection([entry('fix: re #4', { references: ['#40'] })])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- re #4 (#40)'
    );
  });

  it('should take the issue title from the body of an issue-only subject', () => {
    expect(renderGroupedChangelogSection([entry('feat(ui): re #4', { detailLines: ['Add a toggle'], references: ['#40'] })])).toBe(
      'This release has 1 new feature.\n\n### New\n\n- **ui:** Add a toggle (#4, #40)'
    );
  });

  it('should escape the brackets of an issue title so they are not read as a reference link', () => {
    expect(renderGroupedChangelogSection([entry('fix: re #10', { detailLines: ['Image [links] in the Canvas break on renaming'] })])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- Image \\[links\\] in the Canvas break on renaming (#10)'
    );
  });

  it.each([
    ['[BUG] Links break', 'Links break'],
    ['[FR] Add a toggle', 'Add a toggle'],
    ['[fr]Add a toggle', 'Add a toggle'],
    ['[BUG]', '\\[BUG\\]'],
    ['Links [BUG] break', 'Links \\[BUG\\] break'],
    ['[Docs] Add a page', '\\[Docs\\] Add a page']
  ])('should strip only a leading issue-form prefix from %s', (title, expected) => {
    expect(renderGroupedChangelogSection([entry('fix: re #10', { detailLines: [title] })])).toBe(`This release has 1 fix.\n\n### Fixed\n\n- ${expected} (#10)`);
  });

  it('should not strip the prefix from a subject the author wrote', () => {
    expect(renderGroupedChangelogSection([entry('fix: [BUG] marker in the parser')])).toBe('This release has 1 fix.\n\n### Fixed\n\n- [BUG] marker in the parser');
  });

  it('should list an issue once, in the earliest section, with every reference', () => {
    expect(renderGroupedChangelogSection([
      entry('fix: re #99', { detailLines: ['[FR] Configurable folder'], references: ['#7'] }),
      entry('feat: re #99', { detailLines: ['[FR] Configurable folder'], references: ['#8'] }),
      entry('fix: re #102', { detailLines: ['[BUG] Sync warnings'] })
    ])).toBe('This release has 1 new feature and 1 fix.\n\n### New\n\n- Configurable folder (#99, #8, #7)\n\n### Fixed\n\n- Sync warnings (#102)');
  });

  it('should list an issue once when two commits in one section give it different scopes', () => {
    expect(renderGroupedChangelogSection([
      entry('fix(a): re #5', { detailLines: ['Title'] }),
      entry('fix(b): re #5', { detailLines: ['Title'] })
    ])).toBe('This release has 1 fix.\n\n### Fixed\n\n- **a:** Title (#5)');
  });

  it('should keep a differently worded entry that merely references a listed issue', () => {
    expect(renderGroupedChangelogSection([
      entry('feat: re #5', { detailLines: ['Title'] }),
      entry('fix: tidy the parser', { references: ['#5'] })
    ])).toBe('This release has 1 new feature and 1 fix.\n\n### New\n\n- Title (#5)\n\n### Fixed\n\n- tidy the parser (#5)');
  });

  it('should keep an issue-only subject with no title apart from the same issue with one', () => {
    expect(renderGroupedChangelogSection([
      entry('feat: re #5', { detailLines: ['Title'] }),
      entry('fix: re #5')
    ])).toBe('This release has 1 new feature and 1 fix.\n\n### New\n\n- Title (#5)\n\n### Fixed\n\n- re #5');
  });

  it.each([
    'clear the glob cancellation advisory',
    'raise solid-js past two advisories',
    'clear dependency audit findings',
    'patch vulnerable transitive dependencies',
    'override glob to clear GHSA-3g3m-2fjr-6pw4',
    'bump a package past CVE-2026-1234'
  ])('should count a deps commit that only clears an advisory: %s', (description) => {
    expect(renderGroupedChangelogSection([entry(`fix(deps): ${description}`), entry('fix: real')])).toBe(
      'This release has 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.\n\n### Fixed\n\n- real'
    );
  });

  it('should list a deps commit a user notices', () => {
    expect(renderGroupedChangelogSection([entry('fix(deps): load at Obsidian startup again')])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- **deps:** load at Obsidian startup again'
    );
  });

  it('should list an advisory fix outside the deps scope', () => {
    expect(renderGroupedChangelogSection([entry('fix(parser): handle the advisory block')])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- **parser:** handle the advisory block'
    );
  });

  it('should list a breaking deps commit even when it clears an advisory', () => {
    expect(renderGroupedChangelogSection([entry('fix(deps)!: clear the advisory by raising the Node floor')])).toBe(
      'This release has 1 breaking change.\n\n### Breaking changes\n\n- **deps:** clear the advisory by raising the Node floor'
    );
  });

  it('should list an issue-closing deps commit, whose subject names no advisory', () => {
    expect(renderGroupedChangelogSection([entry('fix(deps): re #3', { detailLines: ['Security advisory in a package'] })])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- **deps:** Security advisory in a package (#3)'
    );
  });

  it('should gather api changes under For developers, in order', () => {
    expect(renderGroupedChangelogSection([
      entry('docs: guide'),
      entry('feat(api): publish moveMany'),
      entry('fix(API-Contract): report the vendor'),
      entry('fix: other')
    ])).toBe([
      'This release has 1 fix, 2 developer changes and 1 documentation change.',
      '### Fixed',
      '- other',
      '### For developers',
      '- **api:** publish moveMany\n- **API-Contract:** report the vendor',
      '### Documentation',
      '- guide'
    ].join('\n\n'));
  });

  it('should count one api change in the singular', () => {
    expect(renderGroupedChangelogSection([entry('feat(api): one')])).toBe('This release has 1 developer change.\n\n### For developers\n\n- **api:** one');
  });

  it('should keep a breaking api change under breaking changes and count an api refactor as maintenance', () => {
    expect(renderGroupedChangelogSection([entry('feat(api)!: drop a member'), entry('refactor(api): split')])).toBe(
      'This release has 1 breaking change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.\n\n### Breaking changes\n\n- **api:** drop a member'
    );
  });

  it('should not escape the brackets of a subject the author wrote', () => {
    expect(renderGroupedChangelogSection([entry('fix: handle [x] items')])).toBe('This release has 1 fix.\n\n### Fixed\n\n- handle [x] items');
  });
});

describe('escapeLinkBrackets', () => {
  it('should escape every unescaped bracket', () => {
    expect(escapeLinkBrackets('[FR] Add [a] toggle]')).toBe('\\[FR\\] Add \\[a\\] toggle\\]');
  });

  it('should leave a bracket that is already escaped', () => {
    expect(escapeLinkBrackets('\\[BUG\\] and \\\\[x]')).toBe('\\[BUG\\] and \\\\\\[x\\]');
  });

  it('should leave the brackets inside code spans', () => {
    expect(escapeLinkBrackets('[BUG] `a[0]` and ``b[`1`]`` [c]')).toBe('\\[BUG\\] `a[0]` and ``b[`1`]`` \\[c\\]');
  });

  it('should escape after an unmatched backtick', () => {
    expect(escapeLinkBrackets('a ` [b]')).toBe('a ` \\[b\\]');
  });

  it('should return a title without brackets unchanged', () => {
    expect(escapeLinkBrackets('Plain title')).toBe('Plain title');
  });
});
