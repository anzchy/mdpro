// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-parity-"));
const script = path.resolve("scripts/ci/compare-report.mjs");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const id = (title: string) => ["tests/example.test.ts", "suite", title];
const assertion = (title: string, status: string) => ({ ancestorTitles: ["suite"], title, status });
const report = (...results: ReturnType<typeof assertion>[]) => ({ success: true, testResults: [{ name: path.join(root, "tests/example.test.ts"), status: "passed", assertionResults: results }] });
const reportAt = (checkout: string, ...results: ReturnType<typeof assertion>[]) => ({ success: true, testResults: [{ name: path.join(checkout, "tests/example.test.ts"), status: "passed", assertionResults: results }] });
const inventory = { schemaVersion: 1, tests: [{ id: id("plugin case"), prerequisite: "plugin" }], exclusions: [{ id: id("approved skip"), reason: "fixture-only exclusion" }] };
async function run(ci: unknown, local: unknown, ciRoot = root, localRoot = root, ciProfile: string | null = "ubuntu") {
  const ciPath = path.join(root, "ci.json"), localPath = path.join(root, "local.json"), listPath = path.join(root, "inventory.json");
  fs.writeFileSync(ciPath, JSON.stringify(ci));
  fs.writeFileSync(localPath, JSON.stringify(local));
  fs.writeFileSync(listPath, JSON.stringify(inventory));
  return new Promise<{ status: number | null; output: string }>(done => {
    execFile(process.execPath, [script, "parity", ciPath, localPath, listPath, ciRoot, localRoot, ...(ciProfile === null ? [] : [ciProfile])], { encoding: "utf8" }, (error, stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, output: stdout + stderr });
    });
  });
}
describe("ADR128 executed-test parity", () => {
  it("rejects an omitted CI profile with a clear error instead of assuming Ubuntu", async () => {
    const ci = report(assertion("ordinary", "passed"), assertion("plugin case", "skipped"));
    const local = report(assertion("plugin case", "passed"));
    const result = await run(ci, local, root, root, null);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("CI profile required");
    expect(result.output).not.toContain("Stale inventory entry");
  });
  it("accepts an explicit measured CI profile", async () => {
    const ci = report(assertion("ordinary", "passed"), assertion("plugin case", "skipped"));
    const local = report(assertion("plugin case", "passed"));
    const result = await run(ci, local, root, root, "ubuntu+rustfmt");
    expect(result.status).toBe(0);
    expect(result.output).toContain("PARITY PASS (2/2 required IDs executed)");
  });
  it("normalizes raw Ubuntu and macOS report paths from different checkouts", async () => {
    const ubuntu = path.join(root, "ubuntu-checkout"), mac = path.join(root, "mac-checkout");
    const ci = reportAt(ubuntu, assertion("ordinary", "passed"), assertion("plugin case", "skipped"));
    const local = reportAt(mac, assertion("plugin case", "passed"));
    const result = await run(ci, local, ubuntu, mac);
    expect(result.status).toBe(0);
    expect(result.output).toContain("PARITY PASS (2/2 required IDs executed)");
  });
  it("covers every collected required ID across CI and the verifier", async () => {
    const ci = report(assertion("ordinary", "passed"), assertion("plugin case", "skipped"), assertion("approved skip", "skipped"));
    const local = report(assertion("plugin case", "passed"), assertion("approved skip", "skipped"));
    const result = await run(ci, local);
    expect(result.status).toBe(0);
    expect(result.output).toContain("PARITY PASS (2/2 required IDs executed)");
  });
  it("fails when the verifier did not execute a CI-skipped required ID", async () => {
    const ci = report(assertion("ordinary", "passed"), assertion("plugin case", "skipped"));
    const result = await run(ci, report(assertion("ordinary", "passed")));
    expect(result.status).not.toBe(0);
  });
  it("fails on an unexplained CI skip even when another result passed", async () => {
    const ci = report(assertion("ordinary", "passed"), assertion("plugin case", "skipped"), assertion("unlisted", "skipped"));
    const result = await run(ci, report(assertion("plugin case", "passed")));
    expect(result.status).not.toBe(0);
  });
});
