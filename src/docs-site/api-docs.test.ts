import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join
} from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ApiDocSettings } from './api-doc-settings.ts';

import { generateApiDocs } from './api-docs.ts';

const FIXTURE_FILES: Readonly<Partial<Record<string, string>>> = {
  'node_modules/@mnaoumov/obsidian-lib/dist/lib/esm/app.d.mts': [
    'export declare class RemoteApp {',
    '  name: string;',
    '}',
    'export declare function makeRemote(): RemoteApp;'
  ].join('\n'),
  'node_modules/@mnaoumov/obsidian-lib/package.json': JSON.stringify({
    exports: { './*': { types: './dist/lib/esm/*.d.mts' } },
    name: '@mnaoumov/obsidian-lib',
    type: 'module'
  }),
  'node_modules/typedoc-plugin-mdn-links/data/web-api.json': JSON.stringify({
    AbortSignal: 'https://developer.mozilla.org/docs/Web/API/AbortSignal',
    Blob: { url: 'https://developer.mozilla.org/docs/Web/API/Blob' },
    Broken: 1
  }),
  'src/@types/ignored.d.ts': 'export interface Ignored { value: string; }',
  'src/alpha.ts': [
    '/**',
    ' * @file',
    ' *',
    ' * The alpha module, with a {@link Base}.',
    ' *',
    ' * ```ts',
    ' * const x = 1;',
    ' * ```',
    ' */',
    '',
    'import { makeRemote, RemoteApp } from \'@mnaoumov/obsidian-lib/app\';',
    'import { missing } from \'./missing.ts\';',
    '',
    '/**',
    ' * A base class.',
    ' *',
    ' * @remarks Base remarks.',
    ' *',
    ' * @example',
    ' * ```ts',
    ' * new Base();',
    ' * ```',
    ' */',
    'export class Base<Instance> {',
    '  /** The shared value. */',
    '  public shared?: Instance;',
    '  /** A static counter. */',
    '  public static counter = 0;',
    '  private hidden = 1;',
    '',
    '  /**',
    '   * Creates it.',
    '   *',
    '   * @param seed - The seed.',
    '   */',
    '  public constructor(seed?: number) {',
    '    void seed;',
    '  }',
    '',
    '  /**',
    '   * Listens for a change.',
    '   *',
    '   * @param name - The event.',
    '   * @param callback - The callback.',
    '   * @returns Nothing.',
    '   * @since 1.0.0',
    '   */',
    '  public on(name: \'changed\', callback: () => void): void;',
    '  public on(name: string, callback: () => void): void {',
    '    void name;',
    '    void callback;',
    '  }',
    '',
    '  /** Gets the remote. @example getRemote() */',
    '  public getRemote(): RemoteApp {',
    '    return makeRemote();',
    '  }',
    '',
    '  /** Gets this. */',
    '  public self(): this {',
    '    return this;',
    '  }',
    '',
    '  /** A member named index. */',
    '  public index(): void {',
    '    void this.hidden;',
    '  }',
    '',
    '  /** A static method. */',
    '  public static create(): Base<string> {',
    '    return new Base<string>();',
    '  }',
    '}',
    '',
    '/** A derived class. Uses {@link Base.on | the on method} and {@link Base<string>}. */',
    'export class Derived extends Base<string> implements Shape {',
    '  /** The area. */',
    '  public area = 0;',
    '}',
    '',
    '/** A shape. */',
    'export interface Shape {',
    '  /** The area. */',
    '  area: number;',
    '  /** A method. */',
    '  measure?(unit: string): number;',
    '  /** Listens. */',
    '  on(name: \'changed\', callback: () => void): void;',
    '}',
    '',
    '/** An extended shape. */',
    'export interface Square extends Shape {',
    '  /** The side. */',
    '  side: number;',
    '}',
    '',
    '/** A color. */',
    'export enum Color {',
    '  /** Red. */',
    '  Red = \'red\',',
    '  Green',
    '}',
    '',
    '/** An empty enum. */',
    'export enum Empty {}',
    '',
    '/** A pair. */',
    'export type Pair<T extends string> = [T, T];',
    '',
    '/**',
    ' * Adds numbers.',
    ' *',
    ' * @param left - The left one.',
    ' * @param right - The right one, a {@link Shape}.',
    ' * @returns The sum.',
    ' * @example add(1, 2)',
    ' */',
    'export function add(left: number, right: number): number {',
    '  return left + right + Number(missing);',
    '}',
    '',
    '/** Makes a remote. */',
    'export function remote() {',
    '  return makeRemote();',
    '}',
    '',
    '/** Takes nothing. */',
    'export function nothing(): AbortSignal | Blob | Promise<void> | Partial<Shape> | undefined {',
    '  return undefined;',
    '}',
    '',
    '/** A constant. */',
    'export const ANSWER = 42;',
    '',
    'export let mutable: string | undefined;',
    'function internal(): void {}',
    'void internal;'
  ].join('\n'),
  'src/gamma.ts': [
    'import { makeRemote as mk } from \'@mnaoumov/obsidian-lib/app\';',
    '',
    'type Hidden = string;',
    'void (0 as unknown as Hidden);',
    'enum HiddenEnum { A }',
    'interface HiddenInterface { a: string; }',
    'class HiddenClass {}',
    'const hiddenConst = 1;',
    'void hiddenConst;',
    '',
    '/** A collision: the variable below shares the name. */',
    'export interface Same { a: string; }',
    'export const Same = 1;',
    '',
    '/** A generic box. */',
    'export interface Box<T> {',
    '  /** Measures. */',
    '  measure(value: string): number;',
    '  /** Measures. */',
    '  measure(value: number): number;',
    '}',
    '',
    '/**',
    ' * A worker.',
    ' *',
    ' * @remarks',
    ' * First paragraph.',
    ' *',
    ' * Second paragraph.',
    ' */',
    'export class Worker extends Error {',
    '  public constructor(undocumented?: string) {',
    '    super(undocumented);',
    '  }',
    '',
    '  /**',
    '   * Runs.',
    '   *',
    '   * @remarks Run remarks.',
    '   * @since 2.0.0',
    '   * @param optional',
    '   * @returns The result.',
    '   */',
    '  public run(optional?: string) {',
    '    return optional;',
    '  }',
    '',
    '  /** A static. */',
    '  public static zeta(): void {}',
    '  /** A static. */',
    '  public static alpha(): void {}',
    '  /** Instance. */',
    '  public beta(): void {}',
    '}',
    '',
    '/** Only methods. */',
    'export class OnlyMethods {',
    '  /**',
    '   * @param',
    '   * @example',
    '   * @remarks',
    '   * @returns',
    '   * @since',
    '   */',
    '  public empty(): void {}',
    '}',
    '',
    '/** Has a documented property. */',
    'export interface Documented {',
    '  /**',
    '   * A property.',
    '   *',
    '   * @remarks Property remarks.',
    '   * @since 3.0.0',
    '   * @example',
    '   * documented.value',
    '   */',
    '  value: string;',
    '  undocumentedProperty: number;',
    '  /** The maker. */',
    '  maker: typeof mk;',
    '  /** Another. */',
    '  other: typeof Same;',
    '}',
    '',
    '/** A generic function. */',
    'export function generic<T>(value: T, undocumented: number): T {',
    '  void undocumented;',
    '  return value;',
    '}',
    '',
    'export default function () {}',
    'export default class {}',
    'void HiddenEnum;',
    'void HiddenClass;',
    'export type Twice = 1;',
    'export type Twice = 2;',
    'export enum Merged { A }',
    'export enum Merged { B = 1 }',
    'export interface Joined { a: string; }',
    'export interface Joined { b: string; }',
    'export class Again {}',
    'export class Again {}',
    'export interface Dup { a: string; }',
    'export function Dup(): void {}',
    '/** Holds a shape. */',
    'export class Holder<Shape> {',
    '  public constructor(required: number) { void required; }',
    '  /** Takes. */',
    '  public take(maybe?: Shape): void { void maybe; }',
    '}',
    '/** Accepts. */',
    'export interface Accepts {',
    '  /** Accepts. */',
    '  accept(maybe?: string): void;',
    '}'
  ].join('\n'),
  'src/index.ts': 'export * from \'./alpha.ts\';',
  'src/nested/beta.test.ts': 'export const ignored = 1;',
  'src/nested/beta.ts': [
    '/** Another {@link Base}. */',
    'export interface Base {',
    '  /** A value. */',
    '  value: string;',
    '}',
    '',
    '/** Uses an ambiguous {@link Base}. */',
    'export type UsesBase = Base;'
  ].join('\n'),
  'src/no-docs.ts': 'export const plain = 1;',
  'src/test-helpers/helper.ts': 'export const helper = 1;',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      allowImportingTsExtensions: true,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      noEmit: true,
      strict: true,
      target: 'es2022'
    },
    include: ['src']
  })
};

interface Fixture {
  readonly root: string;
  readonly settings: ApiDocSettings;
}

const fixtures: string[] = [];

afterAll(() => {
  for (const fixture of fixtures) {
    rmSync(fixture, { force: true, recursive: true });
  }
});

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'api-docs-'));
  fixtures.push(root);
  for (const [path, content] of Object.entries(FIXTURE_FILES)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content ?? '');
  }

  return {
    root,
    settings: {
      basePath: '/typescript-lib',
      externalTypeLinks: new Map([['Promise', 'https://example.com/promise']]),
      outputDirectory: join(root, 'docs/api'),
      packageName: '@mnaoumov/typescript-lib',
      packageSites: new Map([['@mnaoumov/obsidian-lib', 'https://mnaoumov.dev/obsidian-lib/']]),
      sidebarFile: join(root, 'docs/sidebar.json')
    }
  };
}

function readPage(fixture: Fixture, path: string): string {
  return readFileSync(join(fixture.settings.outputDirectory, path), 'utf-8');
}

describe('generateApiDocs', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fixture = createFixture();
    await generateApiDocs({ rootDirectory: fixture.root, settings: fixture.settings, sourceDirectory: join(fixture.root, 'src') });
  }, 60_000);

  it('writes the module index with its overview and tables', () => {
    const page = readPage(fixture, 'alpha/index.mdx');
    expect(page).toContain('title: "alpha"');
    expect(page).toContain('The alpha module');
    expect(page).toContain('## Classes');
    expect(page).toContain('## Interfaces');
    expect(page).toContain('## Functions');
    expect(page).toContain('## Types');
    expect(page).toContain('## Enums');
    expect(page).toContain('## Variables');
  });

  it('writes the root index naming the package', () => {
    const page = readPage(fixture, 'index.mdx');
    expect(page).toContain('`@mnaoumov/typescript-lib`');
    expect(page).toContain('- [alpha](/typescript-lib/api/alpha/)');
    expect(page).toContain('- [nested/beta](/typescript-lib/api/nested/beta/)');
  });

  it('documents a class with its members, constructor and the shared components', () => {
    const page = readPage(fixture, 'alpha/base/index.mdx');
    expect(page).toContain('import TypeSignature from "@mnaoumov/typescript-dev-toolkit/docs-site-components/TypeSignature.astro";');
    expect(page).toContain('<ConstructorBlock signature="new Base(seed?: number | undefined)"');
    expect(page).toContain('<ImportStatement text="import { Base } from \'@mnaoumov/typescript-lib/alpha\';" />');
    expect(page).toContain('> Base remarks.');
    expect(page).toContain('**Example:**');
    expect(page).toContain('<PropertyTable rows={[');
    expect(page).toContain('<MethodTable rows={[');
    expect(page).not.toContain('hidden');
  });

  it('links a type another documented package declares to that package\'s site', () => {
    const page = readPage(fixture, 'alpha/base/getremote.mdx');
    expect(page).toContain('https://mnaoumov.dev/obsidian-lib/api/app/RemoteApp/');
  });

  it('splits event overloads into their own page', () => {
    expect(existsSync(join(fixture.settings.outputDirectory, 'alpha/shape/on-changed.mdx'))).toBe(true);
    expect(existsSync(join(fixture.settings.outputDirectory, 'alpha/base/index-member.mdx'))).toBe(true);
  });

  it('inherits members and links them to the declaring type', () => {
    const page = readPage(fixture, 'alpha/derived/index.mdx');
    expect(page).toContain('**Extends:**');
    expect(page).toContain('**Implements:**');
    expect(page).toContain('inheritedFrom: ');
  });

  it('documents functions, type aliases, enums and variables', () => {
    expect(readPage(fixture, 'alpha/add/index.mdx')).toContain('**Parameters:**');
    expect(readPage(fixture, 'alpha/pair/index.mdx')).toContain('type Pair<T> = [T, T]');
    expect(readPage(fixture, 'alpha/color/index.mdx')).toContain('**Members:**');
    expect(readPage(fixture, 'alpha/empty/index.mdx')).not.toContain('**Members:**');
    expect(readPage(fixture, 'alpha/answer/index.mdx')).toContain('const ANSWER: 42');
    const nothing = readPage(fixture, 'alpha/nothing/index.mdx');
    expect(nothing).toContain('https://developer.mozilla.org/docs/Web/API/AbortSignal');
    expect(nothing).toContain('https://developer.mozilla.org/docs/Web/API/Blob');
    expect(nothing).toContain('https://example.com/promise');
  });

  it('renders the optional parts of members only where they exist', () => {
    const worker = readPage(fixture, 'gamma/worker/index.mdx');
    expect(worker).toContain('> First paragraph.\n>\n> Second paragraph.');
    expect(worker).toContain('<ConstructorBlock signature="new Worker(undocumented?: string | undefined)" />');
    expect(worker.indexOf('signature: "beta()"')).toBeLessThan(worker.indexOf('signature: "static alpha()"'));
    expect(worker.indexOf('signature: "static alpha()"')).toBeLessThan(worker.indexOf('signature: "static zeta()"'));
    const run = readPage(fixture, 'gamma/worker/run.mdx');
    expect(run).toContain('remarks="Run remarks."');
    expect(run).toContain('since="2.0.0"');
    expect(run).toContain('returnDescription="The result."');
    expect(run).toContain('*(Optional)*');
    expect(readPage(fixture, 'gamma/box/measure.mdx').split('\n---\n')).toHaveLength(4);
    expect(readPage(fixture, 'gamma/onlymethods/index.mdx')).not.toContain('<PropertyTable');
    const value = readPage(fixture, 'gamma/documented/value.mdx');
    expect(value).toContain('remarks="Property remarks."');
    expect(value).toContain('since="3.0.0"');
    expect(value).toContain('examples={');
    expect(readPage(fixture, 'gamma/documented/maker.mdx')).toContain('typeof makeRemote');
    expect(existsSync(join(fixture.settings.outputDirectory, 'gamma/same/index.mdx'))).toBe(true);
    expect(readPage(fixture, 'gamma/same/index.mdx')).toContain('kind="interface"');
    expect(readPage(fixture, 'gamma/generic/index.mdx')).toContain('generic<T>');
    expect(readPage(fixture, 'no-docs/index.mdx')).not.toContain('@file');
  });

  it('appends backlinks to referenced types', () => {
    expect(readPage(fixture, 'alpha/shape/index.mdx')).toContain('**Links to this page:**');
  });

  it('skips tests, barrels, declarations and test helpers', () => {
    const sidebar = readFileSync(fixture.settings.sidebarFile, 'utf-8');
    expect(sidebar).not.toContain('helper');
    expect(sidebar).not.toContain('Ignored');
    expect(sidebar).toContain('"label": "API reference"');
  });

  it('skips the generation when nothing changed', async () => {
    const indexPath = join(fixture.settings.outputDirectory, 'index.mdx');
    writeFileSync(indexPath, 'kept');
    await generateApiDocs({ rootDirectory: fixture.root, settings: fixture.settings, sourceDirectory: join(fixture.root, 'src') });
    expect(readFileSync(indexPath, 'utf-8')).toBe('kept');
  });

  it('renders without the Web API links when the data is absent', async () => {
    const other = createFixture();
    rmSync(join(other.root, 'node_modules/typedoc-plugin-mdn-links'), { force: true, recursive: true });
    await generateApiDocs({ rootDirectory: other.root, settings: other.settings, sourceDirectory: join(other.root, 'src') });
    expect(readPage(other, 'alpha/nothing/index.mdx')).not.toContain('Web/API/AbortSignal');
  }, 60_000);
});
