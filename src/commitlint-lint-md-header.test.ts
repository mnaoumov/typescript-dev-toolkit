import type { PackageJson } from 'type-fest';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { LintMarkdownContentParams } from './linters/markdownlint-content.ts';
import type { ResolvePathFromRootSafeParams } from './root.ts';

import {
  LINT_MD_HEADER_RULE_NAME,
  lintMdHeaderPlugin,
  lintMdHeaderRule
} from './commitlint-lint-md-header.ts';

const {
  mockLintMarkdownContent,
  mockReadPackageJson,
  mockResolvePathFromRootSafe
} = vi.hoisted(() => ({
  mockLintMarkdownContent: vi.fn<(params: LintMarkdownContentParams) => Promise<string[]>>(),
  mockReadPackageJson: vi.fn<() => Promise<PackageJson>>(),
  mockResolvePathFromRootSafe: vi.fn<(params: ResolvePathFromRootSafeParams) => string>()
}));

vi.mock('./linters/markdownlint-content.ts', () => ({
  lintMarkdownContent: mockLintMarkdownContent
}));

vi.mock('./npm.ts', () => ({
  readPackageJson: mockReadPackageJson
}));

vi.mock('./root.ts', () => ({
  resolvePathFromRootSafe: mockResolvePathFromRootSafe
}));

vi.mock('./version.ts', () => ({
  autolinkBareUrls: (text: string): string => text.replaceAll('https://example.com', '<https://example.com>')
}));

type Commit = Parameters<typeof lintMdHeaderRule>[0];

function makeCommit(header: null | string): Commit {
  return {
    body: null,
    footer: null,
    header
  } as Commit;
}

describe('lintMdHeaderRule', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolvePathFromRootSafe.mockImplementation(({ path }) => `/repo/${path}`);
    mockReadPackageJson.mockResolvedValue({ scripts: { 'lint:md': 'markdownlint-cli2' }, version: '1.2.3' });
  });

  it('should pass a commit with no header without linting', async () => {
    await expect(lintMdHeaderRule(makeCommit(null))).resolves.toEqual([true]);
    expect(mockLintMarkdownContent).not.toHaveBeenCalled();
  });

  it.each(
    [
      ['no scripts at all', {}],
      ['no lint:md script', { scripts: { build: 'tsc' } }]
    ] as const
  )('should pass without linting in a project with %s', async (_label, packageJson) => {
    mockReadPackageJson.mockResolvedValue(packageJson);
    await expect(lintMdHeaderRule(makeCommit('fix: thing'))).resolves.toEqual([true]);
    expect(mockLintMarkdownContent).not.toHaveBeenCalled();
  });

  it('should lint the header as the changelog section it becomes, bare URLs autolinked', async () => {
    mockLintMarkdownContent.mockResolvedValue([]);
    await expect(lintMdHeaderRule(makeCommit('docs: link https://example.com'))).resolves.toEqual([true]);
    expect(mockLintMarkdownContent).toHaveBeenCalledWith({
      content: '# CHANGELOG\n\n## 1.2.3\n\n- docs: link <https://example.com>\n',
      filePath: '/repo/CHANGELOG.md'
    });
  });

  it('should name a placeholder version when package.json has none', async () => {
    mockReadPackageJson.mockResolvedValue({ scripts: { 'lint:md': 'markdownlint-cli2' } });
    mockLintMarkdownContent.mockResolvedValue([]);
    await lintMdHeaderRule(makeCommit('fix: thing'));
    expect(mockLintMarkdownContent).toHaveBeenCalledWith({
      content: '# CHANGELOG\n\n## 0.0.0\n\n- fix: thing\n',
      filePath: '/repo/CHANGELOG.md'
    });
  });

  it('should refuse a header the section fails on, naming the finding', async () => {
    const finding = '/repo/CHANGELOG.md:5:9 error plugin-name-as-code Plugin name must be code';
    mockLintMarkdownContent.mockResolvedValue([finding]);
    const [isValid, message] = await lintMdHeaderRule(makeCommit('docs: lead with Some Plugin'));
    expect(isValid).toBe(false);
    expect(message).toContain('`lint:md`');
    expect(message).toContain(finding);
  });

  it('should propagate a failing markdownlint', async () => {
    mockLintMarkdownContent.mockRejectedValue(new Error('config broken'));
    await expect(lintMdHeaderRule(makeCommit('fix: thing'))).rejects.toThrow('config broken');
  });
});

describe('lintMdHeaderPlugin', () => {
  it('should register the rule under its name', () => {
    expect(lintMdHeaderPlugin.rules[LINT_MD_HEADER_RULE_NAME]).toBe(lintMdHeaderRule);
  });
});
