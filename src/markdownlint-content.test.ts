import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  fixMarkdownContent,
  lintMarkdownContent
} from './linters/markdownlint-content.ts';

/**
 * What the mock hands the output formatter this module passes.
 */
interface MarkdownlintCli2TestFormatterOptions {
  readonly results: unknown[];
}

/**
 * The options override this module passes, as the mock sees it.
 */
interface MarkdownlintCli2TestOptionsOverride {
  readonly outputFormatters: [(options: MarkdownlintCli2TestFormatterOptions) => void][];
}

/**
 * The subset of `markdownlint-cli2`'s parameters this module passes, as the mock sees them.
 */
interface MarkdownlintCli2TestParameters {
  readonly directory: string;
  readonly logError: (message: string) => void;
  readonly logMessage: (message: string) => void;
  readonly noGlobs: boolean;
  readonly nonFileContents: Record<string, string>;
  readonly optionsDefault: unknown;
  readonly optionsOverride?: MarkdownlintCli2TestOptionsOverride;
}

// Hoisted with the mocks that reference it: `vi.mock`'s factory runs before any module-scope `const` of this
// file is initialized, so a plain one here is a `ReferenceError` at import time.
const { mockGetRootFolder, mockMarkdownlintCli2, SHARED_CONFIG } = vi.hoisted(() => ({
  mockGetRootFolder: vi.fn<(cwd?: string) => null | string>(),
  mockMarkdownlintCli2: vi.fn<(parameters: MarkdownlintCli2TestParameters) => Promise<number>>(),
  SHARED_CONFIG: { config: { MD013: false } }
}));

vi.mock('markdownlint-cli2', () => ({
  main: mockMarkdownlintCli2
}));

// The shared configuration is only the base this module passes along, so the real one changes no result here —
// and importing it would pull in the custom rule module without ever running it, which is exactly what makes
// the real `markdownlint-cli2` run an integration test rather than a unit one (see the sibling file).
vi.mock('./linters/markdownlint-cli2-config.ts', () => ({
  obsidianDevUtilsConfig: SHARED_CONFIG
}));

vi.mock('./root.ts', async (importOriginal) => {
  const $module = await importOriginal<typeof import('./root.ts')>();
  return {
    ...$module,
    getRootFolder: mockGetRootFolder
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mockGetRootFolder.mockReturnValue('/root');
  mockMarkdownlintCli2.mockResolvedValue(0);
});

describe('lintMarkdownContent', () => {
  it('should lint the content as the given path, and nothing else', async () => {
    await lintMarkdownContent({
      content: '# CHANGELOG\n',
      // A system path, to pin the POSIX normalization: the key decides which directory's configuration applies,
      // and `markdownlint-cli2` keys its own file map by POSIX paths.
      filePath: String.raw`F:\root\CHANGELOG.md`
    });

    expect(mockMarkdownlintCli2).toHaveBeenCalledOnce();
    const parameters = mockMarkdownlintCli2.mock.calls[0]?.[0];
    expect(parameters?.directory).toBe('/root');
    expect(parameters?.nonFileContents).toEqual({ 'F:/root/CHANGELOG.md': '# CHANGELOG\n' });
    // Without this the configuration's own globs are expanded too, and a check on one document lints the
    // whole repository.
    expect(parameters?.noGlobs).toBe(true);
    // The base a repository's own configuration is merged over — for the repository that has none yet, where
    // markdownlint's stock defaults would otherwise fail an ordinary release note on `MD013/line-length`.
    expect(parameters?.optionsDefault).toBe(SHARED_CONFIG);
  });

  it('should return the findings, and only the findings', async () => {
    mockMarkdownlintCli2.mockImplementation((parameters) => {
      parameters.logMessage('markdownlint-cli2 v0.23.2 (markdownlint v0.41.1)');
      parameters.logMessage('Summary: 2 issues in 1 file');
      parameters.logError('CHANGELOG.md:5 error no-soft-break-in-paragraph Paragraph is hard-wrapped');
      parameters.logError('CHANGELOG.md:7:17 error MD009/no-trailing-spaces Trailing spaces');
      return Promise.resolve(1);
    });

    const findings = await lintMarkdownContent({
      content: '# CHANGELOG\n',
      filePath: '/root/CHANGELOG.md'
    });

    expect(findings).toEqual([
      'CHANGELOG.md:5 error no-soft-break-in-paragraph Paragraph is hard-wrapped',
      'CHANGELOG.md:7:17 error MD009/no-trailing-spaces Trailing spaces'
    ]);
  });

  // A rule configured with `severity: warning` prints through `logError` like any other and still exits `0`.
  // Counting the printed lines would fail a release on something `lint:md` itself passes.
  it('should report nothing for lines the tool did not fail on', async () => {
    mockMarkdownlintCli2.mockImplementation((parameters) => {
      parameters.logError('CHANGELOG.md:5 warning MD013/line-length Line length');
      return Promise.resolve(0);
    });

    const findings = await lintMarkdownContent({
      content: '# CHANGELOG\n',
      filePath: '/root/CHANGELOG.md'
    });

    expect(findings).toEqual([]);
  });

  it('should report nothing when nothing is reported', async () => {
    const findings = await lintMarkdownContent({
      content: '# CHANGELOG\n',
      filePath: '/root/CHANGELOG.md'
    });
    expect(findings).toEqual([]);
  });

  it('should fall back to the working directory when the root folder cannot be found', async () => {
    mockGetRootFolder.mockReturnValue(null);
    await lintMarkdownContent({
      content: '# CHANGELOG\n',
      filePath: '/root/CHANGELOG.md'
    });
    expect(mockMarkdownlintCli2.mock.calls[0]?.[0].directory).toBe(process.cwd());
  });

  it('should resolve the project root from the folder it is given', async () => {
    mockGetRootFolder.mockImplementation((cwd?: string) => cwd === '/workspace/packages/pkg' ? '/workspace' : null);
    await lintMarkdownContent({
      content: '# CHANGELOG\n',
      cwd: '/workspace/packages/pkg',
      filePath: '/workspace/CHANGELOG.md'
    });
    expect(mockMarkdownlintCli2.mock.calls[0]?.[0].directory).toBe('/workspace');
  });

  it('should fall back to the folder it is given when no project root is found above it', async () => {
    mockGetRootFolder.mockReturnValue(null);
    await lintMarkdownContent({
      content: '# CHANGELOG\n',
      cwd: '/loose',
      filePath: '/loose/CHANGELOG.md'
    });
    expect(mockMarkdownlintCli2.mock.calls[0]?.[0].directory).toBe('/loose');
  });
});

describe('fixMarkdownContent', () => {
  it('should apply the fixable findings and count them, leaving the rest', async () => {
    mockMarkdownlintCli2.mockImplementation((parameters) => {
      parameters.logMessage('Summary: 2 issues in 1 file');
      const formatter = parameters.optionsOverride?.outputFormatters[0]?.[0];
      formatter?.({
        results: [
          {
            fileName: 'CHANGELOG.md',
            fixInfo: { deleteCount: 3, editColumn: 26 },
            lineNumber: 5
          },
          {
            fileName: 'CHANGELOG.md',
            fixInfo: null,
            lineNumber: 5
          }
        ]
      });
      return Promise.resolve(1);
    });

    const result = await fixMarkdownContent({
      content: '# CHANGELOG\n\n## 1.0.0\n\n- feat: add a new feature   \n',
      filePath: String.raw`F:\root\CHANGELOG.md`
    });

    expect(result).toEqual({
      content: '# CHANGELOG\n\n## 1.0.0\n\n- feat: add a new feature\n',
      fixCount: 1
    });
    const parameters = mockMarkdownlintCli2.mock.calls[0]?.[0];
    expect(parameters?.nonFileContents).toEqual({ 'F:/root/CHANGELOG.md': '# CHANGELOG\n\n## 1.0.0\n\n- feat: add a new feature   \n' });
    expect(parameters?.noGlobs).toBe(true);
    expect(parameters?.optionsDefault).toBe(SHARED_CONFIG);
  });

  it('should hand the content back unchanged when nothing is fixable', async () => {
    const result = await fixMarkdownContent({
      content: '# CHANGELOG\n',
      cwd: '/loose',
      filePath: '/loose/CHANGELOG.md'
    });
    expect(result).toEqual({
      content: '# CHANGELOG\n',
      fixCount: 0
    });
  });

  it('should fall back to the working directory when the root folder cannot be found', async () => {
    mockGetRootFolder.mockReturnValue(null);
    await fixMarkdownContent({
      content: '# CHANGELOG\n',
      filePath: '/root/CHANGELOG.md'
    });
    expect(mockMarkdownlintCli2.mock.calls[0]?.[0].directory).toBe(process.cwd());
  });

  it('should fall back to the folder it is given when no project root is found above it', async () => {
    mockGetRootFolder.mockReturnValue(null);
    await fixMarkdownContent({
      content: '# CHANGELOG\n',
      cwd: '/loose',
      filePath: '/loose/CHANGELOG.md'
    });
    expect(mockMarkdownlintCli2.mock.calls[0]?.[0].directory).toBe('/loose');
  });
});
