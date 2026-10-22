// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-lint-"));
const script = path.resolve("scripts/lint/conditional-tests.mjs");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
function check(source: string) {
  const file = path.join(root, "case.test.ts");
  fs.writeFileSync(file, source);
  return spawnSync(process.execPath, [script, file], { encoding: "utf8" });
}
describe("ADR128 conditional registration lint", () => {
  it.each([
    "if (flag) it('x', () => {});",
    "if (flag) { describe('x', () => {}); }",
    "if (flag) { if (other) test('x', () => {}); }",
    "flag && it('x', () => {});",
    "flag ? it('x', () => {}) : undefined;",
    "it.each(flag ? cases : [])('x', () => {});",
    "describe.each(flag ? cases : [])('x', () => {});",
  ])("rejects disappearing registration: %s", (source) => {
    expect(check(source).status).not.toBe(0);
  });
  it("accepts collected skipIf, runIf and ctx.skip gates", () => {
    expect(check("it.skipIf(!flag)('x', ctx => { ctx.skip(); }); it.runIf(flag)('y', () => {});").status).toBe(0);
  });
  it("accepts conditional behavior inside a registered test", () => {
    expect(check("it('x', () => { if (flag) expect(1).toBe(1); });").status).toBe(0);
  });
  it.each([
    "describe('suite', () => { if (!plugin) return; it('lost', () => {}); });",
    "describe('suite', () => { if (!plugin) { return; } it('lost', () => {}); });",
    "import * as v from 'vitest'; if (plugin) v.it('lost', () => {});",
    "import * as v from 'vitest'; if (plugin) v.describe('lost', () => {});",
    "if (plugin) it.skipIf(false).each([1])('lost', () => {});",
    "if (plugin) describe.each([1]).skipIf(false)('lost', () => {});",
    "const rows = plugin ? [1] : []; it.each(rows)('lost', () => {});",
    "let rows = [1]; if (!plugin) rows = []; it.each(rows)('lost', () => {});",
    "function register() { it('lost', () => {}); } if (plugin) register();",
    "function register() { it('lost', () => {}); } const maybe = register; if (plugin) maybe();",
    "for (const row of rows) it('lost', () => {});",
    "for (let i = 0; i < rows.length; i++) it('lost', () => {});",
    "while (rows.length) it('lost', () => {});",
    "rows.forEach(() => it('lost', () => {}));",
  ])("rejects audit vanishing form: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/conditional|unresolved|loop|registration/);
  });
  it.each([
    "it.skipIf(!plugin)('collected', () => {});",
    "it.runIf(plugin)('collected', () => {});",
    "it('collected', ctx => { if (!plugin) ctx.skip(); });",
    "it.each([1, 2])('collected %s', () => {});",
    "import * as v from 'vitest'; v.it('collected', () => {});",
    "it('collected', () => { if (plugin) expect(1).toBe(1); });",
    "function pure() { return 1; } if (plugin) pure(); it('collected', () => {});",
  ])("keeps collected registration: %s", (source) => {
    expect(check(source).status, source).toBe(0);
  });
  it.each([
    "const rows = getRows(); it.each(rows)('lost', () => {});",
    "const rows = [1]; for (let i = 1; i < rows.length; i++) it('lost', () => {});",
    "function register() { if (!plugin) return; it('lost', () => {}); } register();",
  ])("rejects reviewer collection bypass: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it.each([
    "import { registerCases } from './helper'; if (plugin) registerCases();",
    "const rows = [1]; rows.pop(); for (const row of rows) it('lost', () => {});",
    "const rows = [1]; rows.splice(0); it.each(rows)('lost', () => {});",
  ])("rejects unresolved helper or mutated case data: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it.each([
    "const register = () => { if (!plugin) return; it('lost', () => {}); }; register();",
    "import * as helpers from './missing-helper'; if (plugin) helpers.registerCases();",
    "const rows = [1]; const alias = rows; alias.pop(); it.each(rows)('lost', () => {});",
  ])("rejects second-review registration bypass: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it("rejects a registration helper through a re-export barrel", () => {
    fs.writeFileSync(path.join(root, "registration-helper.ts"), "import { it } from 'vitest'; export function registerCases() { it('lost', () => {}); }");
    fs.writeFileSync(path.join(root, "barrel.ts"), "export { registerCases } from './registration-helper';");
    expect(check("import { registerCases } from './barrel'; if (plugin) registerCases();").status).not.toBe(0);
  });
});
