// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-ci-"));
const script = path.resolve("scripts/ci/compare-report.mjs");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const id = (file: string, title: string) => [file, "suite", title];
const entry = (file: string, title: string, status: string) => ({
  name: path.join(root, file), status: "passed", assertionResults: [{ ancestorTitles: ["suite"], title, status }],
});
function run(results: unknown, inventory: unknown, profile = "ubuntu") {
  const report = path.join(root, "report.json"), list = path.join(root, "inventory.json");
  if (results === null) fs.rmSync(report, { force: true });
  else fs.writeFileSync(report, typeof results === "string" ? results : JSON.stringify(results));
  fs.writeFileSync(list, JSON.stringify(inventory));
  return spawnSync(process.execPath, [script, "ci", report, list, profile, root], { encoding: "utf8" });
}
const report = (items: ReturnType<typeof entry>[]) => ({ success: true, testResults: items });
const inventory = (tests: unknown[] = [], exclusions: unknown[] = []) => ({ schemaVersion: 1, tests, exclusions });
describe("ADR128 CI test comparator", () => {
  it("accepts a macOS case skipped on Ubuntu and passed on macOS", () => {
    const list = inventory([{ id: id("tests/a.test.ts", "Mac"), prerequisite: "macos" }]);
    expect(run(report([entry("tests/a.test.ts", "Mac", "skipped")]), list).status).toBe(0);
    expect(run(report([entry("tests/a.test.ts", "Mac", "passed")]), list, "macos").status).toBe(0);
  });
  it("rejects an unexplained static or runtime skip in a partially passing file", () => {
    const list = inventory();
    for (const status of ["skipped", "pending"]) expect(run(report([
      { ...entry("tests/a.test.ts", "one", "passed"), assertionResults: [
        entry("tests/a.test.ts", "one", "passed").assertionResults[0],
        entry("tests/a.test.ts", "two", status).assertionResults[0],
      ] },
    ]), list).status).not.toBe(0);
  });
  it("rejects stale, missing and duplicate inventory identities", () => {
    const item = { id: id("tests/a.test.ts", "Mac"), prerequisite: "macos" };
    expect(run(report([entry("tests/a.test.ts", "Mac", "passed")]), inventory([item])).status).not.toBe(0);
    expect(run(report([]), inventory([item])).status).not.toBe(0);
    expect(run(report([entry("tests/a.test.ts", "Mac", "skipped")]), inventory([item, item])).status).not.toBe(0);
  });
  it("preserves array identity across joined-name collisions", () => {
    const a = { id: ["tests/a.test.ts", "a b", "c"], prerequisite: "macos" };
    const b = { id: ["tests/a.test.ts", "a", "b c"], prerequisite: "macos" };
    const mixed = { success: true, testResults: [{ name: path.join(root, "tests/a.test.ts"), status: "passed", assertionResults: [
      { ancestorTitles: ["a b"], title: "c", status: "skipped" },
      { ancestorTitles: ["a"], title: "b c", status: "skipped" },
    ] }] };
    expect(run(mixed, inventory([a, b])).status).toBe(0);
  });
  it("fails closed on missing or malformed reports and inventory entries", () => {
    expect(run(null, inventory()).status).not.toBe(0);
    expect(run("{", inventory()).status).not.toBe(0);
    expect(run({ success: true }, inventory()).status).not.toBe(0);
    expect(run(report([]), inventory([{ id: id("tests/a.test.ts", "x"), prerequisite: "unknown" }])).status).not.toBe(0);
    expect(run(report([]), inventory([], [{ id: id("tests/a.test.ts", "x") }])).status).not.toBe(0);
  });
});
