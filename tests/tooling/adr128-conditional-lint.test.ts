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
});
