/**
 * @file
 *
 * The type half of the pack smoke: inside the smoke project, where the tarball is installed as a consumer gets it,
 * TypeScript resolves an import of every exported subpath through the `exports` map, under `node16` resolution from an
 * ES module file and from a CommonJS file, and under `bundler` resolution. A subpath whose types do not resolve, whose
 * import the compiler refuses, or whose types are in a different module format from the file Node loads at run time
 * (the "masquerading as ESM" and "masquerading as CJS" findings of `@arethetypeswrong/cli`, whose checks this follows;
 * no code of it is adapted) is a problem.
 *
 * `node10` resolution is not checked: it ignores `exports`, so without `typesVersions` no subpath resolves there, and
 * the packages this serves support only resolutions that read `exports`.
 */

import type { CompilerOptions } from 'typescript';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { writeFile } from 'node:fs/promises';
import {
  basename,
  join
} from 'node:path';
import {
  createProgram,
  Extension,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  ModuleKind,
  ModuleResolutionKind,
  resolveModuleName,
  ScriptTarget,
  sys
} from 'typescript';

/**
 * One exported module as the runtime half of the smoke loaded it.
 */
export interface PackSmokeTypedModule {
  /**
   * The file Node loads for the specifier in the module's format.
   */
  readonly runtimeFile: string;

  /**
   * The bare specifier a consumer imports.
   */
  readonly specifier: string;
}

/**
 * The outcome of {@link typeCheckPackSmokeImports}.
 */
export interface PackSmokeTypesResult {
  /**
   * Whether the package ships no type declarations at all, in which case nothing was checked.
   */
  readonly isUntyped: boolean;

  /**
   * One line per problem found.
   */
  readonly problems: readonly string[];

  /**
   * How many imports were checked, by resolution mode name.
   */
  readonly summary: string;
}

/**
 * Params for {@link typeCheckPackSmokeImports}.
 */
export interface TypeCheckPackSmokeImportsParams {
  /**
   * The modules a CommonJS consumer requires.
   */
  readonly cjsModules: readonly PackSmokeTypedModule[];

  /**
   * The modules an ES module consumer imports.
   */
  readonly esmModules: readonly PackSmokeTypedModule[];

  /**
   * The installed package's `type` field, which decides the format of a `.js` or `.d.ts` file.
   */
  readonly packageType: string | undefined;

  /**
   * The smoke project folder, whose `node_modules` holds the installed package.
   */
  readonly smokeFolder: string;
}

type ModuleFormat = 'cjs' | 'esm';

interface ResolutionMode {
  readonly compilerOptions: CompilerOptions;
  readonly consumerFormat: ModuleFormat;
  readonly fileName: string;
  readonly isFormatChecked: boolean;
  readonly label: string;
}

const DECLARATION_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  Extension.Cts,
  Extension.Dcts,
  Extension.Dmts,
  Extension.Dts,
  Extension.Mts,
  Extension.Ts,
  Extension.Tsx
]);

const COMMON_COMPILER_OPTIONS: CompilerOptions = {
  // Only the generated import files are checked, so the default library is not needed and costs most of the time.
  noEmit: true,
  noLib: true,
  skipLibCheck: true,
  strict: true,
  target: ScriptTarget.ES2022,
  types: []
};

const RESOLUTION_MODES: readonly ResolutionMode[] = [
  {
    compilerOptions: { ...COMMON_COMPILER_OPTIONS, module: ModuleKind.Node16, moduleResolution: ModuleResolutionKind.Node16 },
    consumerFormat: 'esm',
    fileName: 'pack-smoke-types-esm.mts',
    isFormatChecked: true,
    label: 'node16 ESM'
  },
  {
    compilerOptions: { ...COMMON_COMPILER_OPTIONS, module: ModuleKind.Node16, moduleResolution: ModuleResolutionKind.Node16 },
    consumerFormat: 'cjs',
    fileName: 'pack-smoke-types-cjs.cts',
    isFormatChecked: true,
    label: 'node16 CJS'
  },
  {
    compilerOptions: { ...COMMON_COMPILER_OPTIONS, module: ModuleKind.ESNext, moduleResolution: ModuleResolutionKind.Bundler },
    consumerFormat: 'esm',
    // A bundler decides the format itself, so only that the types resolve and import is checked.
    fileName: 'pack-smoke-types-bundler.ts',
    isFormatChecked: false,
    label: 'bundler'
  }
];

const FORMAT_NAMES: Readonly<Record<ModuleFormat, string>> = {
  cjs: 'CommonJS',
  esm: 'an ES module'
};

/**
 * Type-checks an import of every exported module from a consumer of the installed package, under `node16` ESM,
 * `node16` CommonJS and `bundler` resolution, with the TypeScript this package depends on.
 *
 * @param params - The installed modules and where the smoke project is.
 * @returns The problems found, or that the package ships no types.
 */
export async function typeCheckPackSmokeImports(params: TypeCheckPackSmokeImportsParams): Promise<PackSmokeTypesResult> {
  const { cjsModules, esmModules, packageType, smokeFolder } = params;
  const problems: string[] = [];
  const counts: string[] = [];
  let resolvedCount = 0;

  for (const mode of RESOLUTION_MODES) {
    const modules = mode.consumerFormat === 'esm' ? esmModules : cjsModules;
    const filePath = join(smokeFolder, mode.fileName);
    await writeFile(filePath, modules.map((exportedModule, index) => `import * as m${String(index)} from '${exportedModule.specifier}';\n`).join(''), 'utf-8');
    counts.push(`${String(modules.length)} under ${mode.label}`);

    // A module with no types gets its finding from the compiler below (TS2307 or, under `strict`, TS7016).
    const resolutionMode = mode.consumerFormat === 'esm' ? ModuleKind.ESNext : ModuleKind.CommonJS;
    for (const exportedModule of modules) {
      const resolved = resolveModuleName(exportedModule.specifier, filePath, mode.compilerOptions, sys, undefined, undefined, resolutionMode).resolvedModule;
      if (resolved === undefined || !DECLARATION_EXTENSIONS.has(resolved.extension)) {
        continue;
      }

      resolvedCount++;
      if (!mode.isFormatChecked) {
        continue;
      }

      const typesFormat = getFormat(resolved.resolvedFileName, packageType);
      const runtimeFormat = getFormat(exportedModule.runtimeFile, packageType);
      if (typesFormat === runtimeFormat) {
        continue;
      }

      const masquerade = typesFormat === 'esm' ? 'ESM' : 'CJS';
      problems.push(
        `types ${mode.label} ${exportedModule.specifier}: the types (${basename(resolved.resolvedFileName)}) are ${FORMAT_NAMES[typesFormat]}, but Node loads ${basename(exportedModule.runtimeFile)}, which is ${FORMAT_NAMES[runtimeFormat]} (masquerading as ${masquerade})`
      );
    }

    const program = createProgram([filePath], mode.compilerOptions);
    const sourceFile = ensureNonNullable(program.getSourceFile(filePath));
    // `noLib` leaves global diagnostics with no file; only the import file's own are findings.
    const diagnostics = getPreEmitDiagnostics(program, sourceFile).filter((diagnostic) => diagnostic.file === sourceFile);
    for (const diagnostic of diagnostics) {
      // One import per line, so the line names the module.
      const { line } = sourceFile.getLineAndCharacterOfPosition(ensureNonNullable(diagnostic.start));
      const specifier = ensureNonNullable(modules[line]).specifier;
      problems.push(`types ${mode.label} ${specifier}: TS${String(diagnostic.code)} ${firstLine(flattenDiagnosticMessageText(diagnostic.messageText, '\n'))}`);
    }
  }

  return resolvedCount === 0 ? { isUntyped: true, problems: [], summary: '' } : { isUntyped: false, problems, summary: counts.join(', ') };
}

function firstLine(text: string): string {
  return text.trim().split('\n', 1).join('').trim();
}

// A `.js`, `.ts` or `.d.ts` file takes the format of its package. Only the package root's `package.json` is read: a
// nested one that sets its own `type` is not looked for.
function getFormat(filePath: string, packageType: string | undefined): ModuleFormat {
  if (/\.m(?:ts|js)$/.test(filePath)) {
    return 'esm';
  }

  if (/\.c(?:ts|js)$/.test(filePath)) {
    return 'cjs';
  }

  return packageType === 'module' ? 'esm' : 'cjs';
}
