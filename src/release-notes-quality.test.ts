import {
  describe,
  expect,
  it
} from 'vitest';

import {
  assertReleaseNotesAreReadable,
  classifyReleaseNotes
} from './release-notes-quality.ts';

describe('classifyReleaseNotes', () => {
  it('should call a blank body empty', () => {
    expect(classifyReleaseNotes('')).toBe('empty');
    expect(classifyReleaseNotes('\n  \r\n')).toBe('empty');
  });

  it('should call a body of headings and bare URLs empty', () => {
    expect(classifyReleaseNotes('### Fixed\n\nhttps://example.com\n<https://example.com/a>\n**npm**: https://www.npmjs.com/package/x')).toBe('empty');
  });

  it('should call a body of only a compare link compare-link-only', () => {
    expect(classifyReleaseNotes('**Full Changelog**: https://github.com/o/r/compare/1.0.0...1.0.1')).toBe('compare-link-only');
    expect(classifyReleaseNotes('## 1.0.1\r\n\r\n**Full Changelog**: https://github.com/o/r/compare/1.0.0...1.0.1')).toBe('compare-link-only');
  });

  it('should call a list of Conventional Commits subjects raw', () => {
    expect(classifyReleaseNotes('- fix: tidy the parser\n- feat(ui)!: add a toggle\n* chore: bump')).toBe('raw-commit-list');
  });

  it('should call bullets prefixed with a commit hash raw', () => {
    expect(classifyReleaseNotes('- abc1234 fix: tidy\n- [abcdef0](https://x/commit/abcdef0) feat: add')).toBe('raw-commit-list');
  });

  it('should call conventional-changelog output with trailing hashes raw', () => {
    expect(classifyReleaseNotes('* **ui:** add a toggle ([abc1234](https://github.com/o/r/commit/abc1234))\n* tidy (abc1234)')).toBe(
      'raw-commit-list'
    );
  });

  it('should call GitHub generated notes raw', () => {
    expect(classifyReleaseNotes(
      '## What\'s Changed\n* Add a toggle by @someone in https://github.com/o/r/pull/12\n\n**Full Changelog**: https://github.com/o/r/compare/a...b'
    )).toBe('raw-commit-list');
  });

  it('should call a body where half the bullets are commit subjects raw', () => {
    expect(classifyReleaseNotes('- fix: tidy\n- Adds a toggle')).toBe('raw-commit-list');
  });

  it('should call a body where most bullets read as prose readable', () => {
    expect(classifyReleaseNotes('- fix: tidy\n- Adds a toggle\n- Fixes the parser')).toBe('readable');
  });

  it('should not call a bold scope prefix raw (the measured deps false positive)', () => {
    expect(classifyReleaseNotes('This release has 1 fix.\n\n### Fixed\n\n- **deps:** load at Obsidian startup again')).toBe('readable');
    expect(classifyReleaseNotes('- **test:** cover the parser\n- **build:** ship the types')).toBe('readable');
  });

  it('should call grouped notes with a compare link readable', () => {
    expect(classifyReleaseNotes(
      'This release has 1 new feature.\n\n### New\n\n- Add a toggle (#4)\n\n**Full Changelog**: https://github.com/o/r/compare/1.0.0...1.1.0'
    )).toBe('readable');
  });

  it('should call prose without bullets readable', () => {
    expect(classifyReleaseNotes('This release has maintenance changes only.')).toBe('readable');
  });
});

describe('assertReleaseNotesAreReadable', () => {
  it('should pass readable notes', () => {
    expect(() => {
      assertReleaseNotesAreReadable('- Adds a toggle', 'The notes', 'Fix it.');
    }).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['**Full Changelog**: https://github.com/o/r/compare/a...b', 'only a compare link'],
    ['- fix: tidy', 'a raw list of commit subjects']
  ])('should refuse %j as %s', (text, description) => {
    expect(() => {
      assertReleaseNotesAreReadable(text, 'The 1.0.0 section', 'Write them by hand.');
    }).toThrow(`The 1.0.0 section is ${description}, so it tells a reader nothing about what changed. Write them by hand.`);
  });
});
