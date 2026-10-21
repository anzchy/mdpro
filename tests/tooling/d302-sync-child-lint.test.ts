// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "d302-sync-lint-"));
const script = path.resolve("scripts/lint/conditional-tests.mjs");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
async function run(file: string, source: string) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
  return new Promise<{ status: number | null; stderr: string }>(done => {
    execFile(process.execPath, [script, destination], { encoding: "utf8" }, (error, _stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stderr });
    });
  });
}
describe("D302 sync child-process guard", () => {
  it("rejects a new test's synchronous call", async () => {
    const result = await run("tests/new.test.ts", 'import { spawnSync as wait } from "node:child_process"; wait("node", []);');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tests/new.test.ts");
  });
  it("rejects the same call after relocation into an imported support helper", async () => {
    fs.rmSync(path.join(root, "tests/new.test.ts"), { force: true });
    const result = await run("tests/support/helper.ts", 'import { execFileSync } from "node:child_process"; export const run = () => execFileSync("node", []);');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tests/support/helper.ts");
  });
  it("accepts awaited async execution and a fixture string mentioning spawnSync", async () => {
    fs.rmSync(path.join(root, "tests/support/helper.ts"), { force: true });
    const result = await run("tests/new.test.ts", 'import { execFile } from "node:child_process"; const fixture = "spawnSync(\\\"node\\\")"; await new Promise(resolve => execFile("node", ["-e", "0"], resolve));');
    expect(result.status).toBe(0);
  });
});
