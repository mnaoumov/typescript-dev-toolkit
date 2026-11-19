import { RuleTester } from '@typescript-eslint/rule-tester';
import { Linter } from 'eslint';
import {
  parser,
  plugin
} from 'typescript-eslint';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import { noUnsafeClassInstanceAssignment } from './no-unsafe-class-instance-assignment.ts';
import { toRuleTesterModule } from './rule-tester-helper.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const languageOptions = {
  parser,
  parserOptions: {
    projectService: { allowDefaultProject: ['*.ts'], defaultProject: 'tsconfig.eslint-test.json' }
  }
} satisfies Linter.Config['languageOptions'];

const MIXIN_PRELUDE = `
type Constructor<T = object> = abstract new (...args: any[]) => T;
class Base { public base = 1; }
function mixin<TBase extends Constructor>(baseClass: TBase) {
  abstract class Mixed extends baseClass { public mixed = 2; }
  return Mixed;
}
interface Extra { extra(): void; }
declare function mixinDeclared(): <TBase extends Constructor>(baseClass: TBase) => Constructor<Extra> & TBase;
class ViaInferredMixin extends mixin(Base) {}
class ViaDeclaredMixin extends mixinDeclared()(Base) {}
function takeBase(value: Base): Base { return value; }
`;

const MIXIN_CASES = [
  `${MIXIN_PRELUDE} export class Derived extends ViaInferredMixin { public run(): Base { return takeBase(this); } }`,
  `${MIXIN_PRELUDE} export class Derived extends ViaDeclaredMixin { public run(): Base { return takeBase(this); } }`,
  `${MIXIN_PRELUDE} export class Derived extends ViaInferredMixin {} export const value: Base = new Derived();`,
  `${MIXIN_PRELUDE} export class Derived extends ViaDeclaredMixin {} export const value: Base = new Derived();`
];

new RuleTester({ languageOptions }).run(
  'no-unsafe-class-instance-assignment',
  toRuleTesterModule(noUnsafeClassInstanceAssignment),
  {
    invalid: [
      {
        code: `${MIXIN_PRELUDE} export const value: Base = { base: 1 };`,
        errors: [{ data: { type: 'Base' }, messageId: 'objectLiteral' }]
      },
      {
        code: `${MIXIN_PRELUDE} declare const plain: { base: number }; export const value: Base = plain;`,
        errors: [{ data: { type: 'Base' }, messageId: 'nonInstance' }]
      },
      {
        code: `${MIXIN_PRELUDE} class Other { public base = 1; } export const value: ViaInferredMixin = takeOther(); declare function takeOther(): Other & { mixed: number };`,
        errors: [{ messageId: 'nonInstance' }]
      }
    ],
    valid: [
      ...MIXIN_CASES,
      'class Plain { public x = 1; } export const value: Plain = new Plain();'
    ]
  }
);

describe('no-unsafe-class-instance-assignment', () => {
  it('reports the mixin shapes under the upstream rule, which the wrapper exists to fix', () => {
    const linter = new Linter();
    const config = {
      files: ['**/*.ts'],
      languageOptions,
      plugins: { '@typescript-eslint': plugin },
      rules: { '@typescript-eslint/no-unsafe-class-instance-assignment': 'error' }
    } as Linter.Config;
    const ruleIds = MIXIN_CASES.map((code) => linter.verify(code, config, { filename: 'mixin.ts' }).map((message) => message.ruleId));
    expect(ruleIds).toEqual(MIXIN_CASES.map(() => ['@typescript-eslint/no-unsafe-class-instance-assignment']));
  });

  it('fails like the upstream rule without type information', () => {
    const linter = new Linter();
    const config = {
      files: ['**/*.ts'],
      languageOptions: { parser },
      plugins: { toolkit: { rules: { 'no-unsafe-class-instance-assignment': noUnsafeClassInstanceAssignment } } },
      rules: { 'toolkit/no-unsafe-class-instance-assignment': 'error' }
    } satisfies Linter.Config;
    expect(() => linter.verify('export const value = 1;', config, { filename: 'plain.ts' })).toThrow(/requires type information/);
  });
});
