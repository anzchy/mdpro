// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "d302-lint-imports-"));
const script = path.resolve("scripts/lint/conditional-tests.mjs");
fs.mkdirSync(path.join(root, "scripts/lint"), { recursive: true });
fs.writeFileSync(path.join(root, "scripts/lint/d302-sync-exceptions.json"), "[]");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
function cli(args: string[] = []) {
  return new Promise<{ status: number | null; stderr: string }>(done => {
    execFile(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" }, (error, _stdout, stderr) => {
      done({ status: error ? (typeof error.code === "number" ? error.code : null) : 0, stderr });
    });
  });
}
function write(file: string, text: string) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, text);
  return destination;
}
describe("D302 child-process import and discovery guard", () => {
  it("rejects the non-node import and a default-import call", async () => {
    const first = write("tests/new.test.ts", 'import { spawnSync } from "child_process"; spawnSync("node", []);');
    expect((await cli([first])).status).not.toBe(0);
    const second = write("tests/new.test.ts", 'import child from "node:child_process"; child.spawnSync("node", []);');
    expect((await cli([second])).status).not.toBe(0);
  });
  it("discovers an imported support helper on the default scan", async () => {
    write("tests/new.test.ts", 'import { run } from "./support/helper"; run();');
    write("tests/support/helper.ts", 'import { execFileSync } from "node:child_process"; export const run = () => execFileSync("node", []);');
    const blocked = await cli();
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("tests/support/helper.ts:1");
    write("tests/support/helper.ts", 'import { execFile } from "node:child_process"; export const run = () => new Promise(resolve => execFile("node", [], resolve));');
    expect((await cli()).status).toBe(0);
  });
});
