// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-verify-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const file = "tests/a.test.ts";
const id = [file, "suite", "case"];
const inventory = (tag = "plugin") => ({ schemaVersion: 1, tests: [{ id, prerequisite: tag }], exclusions: [] });
const report = (status = "passed") => ({ success: true, testResults: [{ name: path.join(root, file), status: "passed", assertionResults: [{ ancestorTitles: ["suite"], title: "case", status }] }] });
function setup() { fs.mkdirSync(path.join(root, "tests"), { recursive: true }); fs.writeFileSync(path.join(root, file), "it('case', () => {});"); }
async function call(options: Record<string, unknown>) {
  // @ts-expect-error -- plain ESM script has no declaration file
  const mod = await import("../../scripts/ci/verify-inventory.mjs").catch(() => null);
  expect(typeof mod?.verifyInventory).toBe("function");
  return mod!.verifyInventory({ root, inventory: inventory(), prerequisites: () => true, execute: (_files: string[], reportPath: string) => {
    fs.writeFileSync(reportPath, JSON.stringify(report()));
    return { status: 0 };
  }, ...options });
}
describe("ADR128 local inventory verifier", () => {
  it("passes only when every inventory test runs and passes", async () => {
    setup();
    expect((await call({})).ok).toBe(true);
  });
  it("fails before launching when a prerequisite is absent", async () => {
    setup(); let launched = false;
    const result = await call({ prerequisites: () => false, execute: () => { launched = true; return { status: 0 }; } });
    expect(result.ok).toBe(false);
    expect(launched).toBe(false);
  });
  it("fails on a deleted inventory file", async () => {
    setup(); fs.rmSync(path.join(root, file));
    expect((await call({})).ok).toBe(false);
  });
  it.each(["skipped", "failed", "pending"])("fails when an inventory case is %s", async (status) => {
    setup();
    const result = await call({ execute: (_files: string[], reportPath: string) => { fs.writeFileSync(reportPath, JSON.stringify(report(status))); return { status: 0 }; } });
    expect(result.ok).toBe(false);
  });
  it("fails on absent and malformed reports", async () => {
    setup();
    expect((await call({ execute: () => ({ status: 0 }) })).ok).toBe(false);
    expect((await call({ execute: (_files: string[], reportPath: string) => { fs.writeFileSync(reportPath, "{"); return { status: 0 }; } })).ok).toBe(false);
  });
  it("never promotes a failed or terminated child because its JSON says passed", async () => {
    setup();
    for (const status of [1, null]) {
      const result = await call({ execute: (_files: string[], reportPath: string) => { fs.writeFileSync(reportPath, JSON.stringify(report())); return { status }; } });
      expect(result.ok).toBe(false);
    }
  });
});
