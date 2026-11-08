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

  it('should escape the brackets of a bug-form issue title so it is not read as a reference link', () => {
    expect(renderGroupedChangelogSection([entry('fix: re #10', { detailLines: ['[BUG] Image links in the Canvas break on renaming'] })])).toBe(
      'This release has 1 fix.\n\n### Fixed\n\n- \\[BUG\\] Image links in the Canvas break on renaming (#10)'
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
