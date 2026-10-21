/**
 * @file
 *
 * The API documentation generator: walks a package's `src`, extracts every documentable exported declaration via
 * ts-morph, and writes Starlight-compatible MDX pages plus a sidebar JSON. The output tree mirrors the package's
 * module structure: a type's namespace is its source path relative to `src`, which is also its import subpath.
 */

import {
  existsSync,
  readFileSync
} from 'node:fs';
import {
  mkdir,
  rm,
  writeFile
} from 'node:fs/promises';
import {
  dirname,
  join,
  normalize
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';

import type { ApiDocSettings } from './api-doc-settings.ts';
import type {
  PageContent,
  TypeInfo
} from './api-doc-types.ts';

import { extractFileOverview } from './api-doc-jsdoc.ts';
import {
  loadExternalTypeMaps,
  registerMemberPages,
  registerRouteSegments
} from './api-doc-link-rendering.ts';
import { clearPackageDeclarations } from './api-doc-package-sites.ts';
import {
  appendBacklinksAndWrite,
  generateMemberPages,
  generateNamespaceIndexPages,
  generateOverviewPage,
  generateSidebarJson
} from './api-doc-page-generation.ts';
import { configureApiDocs } from './api-doc-settings.ts';
import {
  collectFunctions,
  collectPackageDeclarations,
  collectVariables,
  computeCacheHash,
  computeNamespace,
  findEntryFiles,
  processSourceFile,
  registerGenericTypeParams
} from './api-doc-source-processing.ts';
import { resolveInheritedMembers } from './api-doc-type-merging.ts';

/**
 * Options for {@link generateApiDocs}.
 */
export interface GenerateApiDocsParams {
  /**
   * The repository root: the folder holding `tsconfig.json` and `node_modules`.
   */
  readonly rootDirectory: string;

  /**
   * The settings every page and link is rendered with.
   */
  readonly settings: ApiDocSettings;

  /**
   * The folder whose modules are documented, normally `<root>/src`.
   */
  readonly sourceDirectory: string;
}

const CACHE_FILE_NAME = '.cache-hash';

/**
 * Generates the API reference pages and the sidebar.
 *
 * Skips the work when neither the sources, the settings nor the generator changed since the last run.
 *
 * @param options - The options.
 */
export async function generateApiDocs(options: GenerateApiDocsParams): Promise<void> {
  const { rootDirectory, settings, sourceDirectory } = options;
  configureApiDocs(settings);
  loadExternalTypeMaps(rootDirectory);

  const entryFiles = findEntryFiles(sourceDirectory, settings.excludedDirectories);
  console.warn(`Found ${String(entryFiles.length)} entry source files`);

  const cacheFile = join(settings.outputDirectory, CACHE_FILE_NAME);
  const currentHash = computeCacheHash(entryFiles, dirname(fileURLToPath(import.meta.url)));
  if (existsSync(cacheFile) && existsSync(settings.sidebarFile) && readFileSync(cacheFile, 'utf-8').trim() === currentHash) {
    console.warn('Source files and generator unchanged — skipping generation.');
    return;
  }

  // Load via the repo's tsconfig so inferred types resolve.
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: join(rootDirectory, 'tsconfig.json')
  });
  const sourceFiles = project.addSourceFilesAtPaths(entryFiles);

  const types = new Map<string, TypeInfo>();
  const moduleOverviews = new Map<string, string>();
  clearPackageDeclarations();

  for (const src of sourceFiles) {
    const namespace = computeNamespace(sourceDirectory, normalize(src.getFilePath()));
    const overview = extractFileOverview(src);
    if (overview) {
      moduleOverviews.set(namespace, overview);
    }
    collectPackageDeclarations(src);
    processSourceFile(src, types, namespace);
    collectFunctions(src, types, namespace);
    collectVariables(src, types, namespace);
  }

  resolveInheritedMembers(types);

  for (const info of types.values()) {
    info.properties.sort((a, b) => a.name.localeCompare(b.name));
    info.methods.sort((a, b) => a.name.localeCompare(b.name));
  }

  registerGenericTypeParams(types);
  registerRouteSegments(types);
  registerMemberPages(types);

  await rm(settings.outputDirectory, { force: true, recursive: true });
  await mkdir(settings.outputDirectory, { recursive: true });

  await generateNamespaceIndexPages(types, types, moduleOverviews);

  // Pass 1: generate all pages without backlinks, collect content (keyed by qualified id)
  const pageContents = new Map<string, PageContent>();
  for (const [key, info] of types) {
    pageContents.set(key, await generateOverviewPage(info.name, info, types));
    if (info.kind === 'class' || info.kind === 'interface') {
      await generateMemberPages(info.name, info, types);
    }
  }

  // Pass 2: scan content for links, append backlinks, write files
  await appendBacklinksAndWrite(pageContents, types);

  await generateSidebarJson(types);
  await writeFile(cacheFile, currentHash, 'utf-8');

  console.warn(`Generated docs for ${String(types.size)} types across ${String(moduleOverviews.size)} documented modules`);
}
