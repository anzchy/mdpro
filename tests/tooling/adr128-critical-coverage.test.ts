// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = path.resolve("scripts/ci/check-critical-coverage.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-coverage-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const metric = (pct = 100) => ({ total: 100, covered: pct, skipped: 0, pct });
const summary = (files: Record<string, number>) => Object.fromEntries(
  Object.entries(files).map(([file, pct]) => [file, { lines: metric(pct), branches: metric(pct) }]),
);
function run(files: Record<string, number> | string | null, glob = "src/**/*.ts") {
  const config = path.join(root, "config.json");
  const report = path.join(root, "summary.json");
  fs.writeFileSync(config, JSON.stringify({ criticalPaths: [{ glob, thresholds: { lines: 100, branches: 100 } }] }));
  if (files === null) fs.rmSync(report, { force: true });
  else fs.writeFileSync(report, typeof files === "string" ? files : JSON.stringify(summary(files)));
  return spawnSync(process.execPath, [script, report, config], { encoding: "utf8" });
}
describe("ADR128 critical coverage gate", () => {
  it("accepts every matching file exactly at threshold", () => {
    expect(run({ "/repo/src/a.ts": 100, "/repo/src/sub/b.ts": 100 }).status).toBe(0);
  });
  it("fails closed on missing and malformed summaries", () => {
    expect(run(null).status).not.toBe(0);
    expect(run("{").status).not.toBe(0);
    expect(run('{"/repo/src/a.ts":{"lines":{}}}').status).not.toBe(0);
  });
  it("fails when a glob matches no file", () => {
    expect(run({ "/repo/src/a.ts": 100 }, "other/**/*.ts").status).not.toBe(0);
  });
  it("checks lines and branches without rounding", () => {
    expect(run({ "/repo/src/a.ts": 99.99 }).status).not.toBe(0);
  });
  it("checks every matching file regardless of report order", () => {
    for (const entries of [
      { "/repo/src/a.ts": 100, "/repo/src/b.ts": 99 },
      { "/repo/src/b.ts": 99, "/repo/src/a.ts": 100 },
    ]) expect(run(entries).status).not.toBe(0);
  });
});
