// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-profile-"));
const profileScript = path.resolve("scripts/ci/runner-profile.mjs");
const comparator = path.resolve("scripts/ci/compare-report.mjs");
const d187 = ["tests/tooling/d187-receipt-rustfmt-guard.test.ts", "D187 receipt-rustfmt-guard: real rustfmt", "compares bytes with the real binary (skipped: rustfmt not installed)"];
const macId = ["tests/mac.test.ts", "suite", "mac case"];
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function command(script: string, args: string[], env = process.env) {
  try { const { stdout, stderr } = await execute(process.execPath, [script, ...args], { cwd: path.resolve("."), env }); return { status: 0, output: stdout + stderr }; }
  catch (error) { const e = error as { code: number; stdout: string; stderr: string }; return { status: e.code, output: e.stdout + e.stderr }; }
}
function runner(osName: "Linux" | "macOS", mode: "present" | "absent" | "failed" | "cargo") {
  const home = fs.mkdtempSync(path.join(root, "home-"));
  const bin = mode === "cargo" ? path.join(home, ".cargo/bin") : path.join(home, "path-bin");
  fs.mkdirSync(bin, { recursive: true });
  if (mode !== "absent") {
    const exe = path.join(bin, "rustfmt");
    fs.writeFileSync(exe, `#!/bin/sh\necho rustfmt 1.10.0\nexit ${mode === "failed" ? 1 : 0}\n`);
    fs.chmodSync(exe, 0o755);
  }
  return { ...process.env, RUNNER_OS: osName, HOME: home, PATH: mode === "cargo" ? "" : bin };
}
async function profile(env: NodeJS.ProcessEnv) { return command(profileScript, [], env); }
function files(status: "passed" | "skipped", withMac = false) {
  const rust = { name: path.join(root, d187[0]), status: "passed", assertionResults: [{ ancestorTitles: [d187[1]], title: d187[2], status }] };
  const mac = { name: path.join(root, macId[0]), status: "passed", assertionResults: [{ ancestorTitles: [macId[1]], title: macId[2], status: "passed" }] };
  return { success: true, testResults: withMac ? [rust, mac] : [rust] };
}
async function compare(mode: "ci" | "parity", ci: unknown, local: unknown, profileName: string, withMac = false) {
  const folder = fs.mkdtempSync(path.join(root, "reports-"));
  const ciFile = path.join(folder, "ci.json"), localFile = path.join(folder, "local.json"), inventoryFile = path.join(folder, "inventory.json");
  fs.writeFileSync(ciFile, JSON.stringify(ci)); fs.writeFileSync(localFile, JSON.stringify(local));
  fs.writeFileSync(inventoryFile, JSON.stringify({ schemaVersion: 1, tests: [
    { id: d187, prerequisite: "rustfmt" }, ...(withMac ? [{ id: macId, prerequisite: "macos" }] : []),
  ], exclusions: [] }));
  return command(comparator, mode === "ci"
    ? ["ci", ciFile, inventoryFile, profileName, root]
    : ["parity", ciFile, localFile, inventoryFile, root, root, profileName]);
}

describe("ADR128 measured runner prerequisites", () => {
  it.each(["Linux", "macOS"] as const)("reports rustfmt present and absent on %s", async (osName) => {
    const base = osName === "Linux" ? "ubuntu" : "macos";
    expect((await profile(runner(osName, "present"))).output.trim()).toBe(`${base}+rustfmt`);
    expect((await profile(runner(osName, "absent"))).output.trim()).toBe(base);
    expect((await profile(runner(osName, "failed"))).output.trim()).toBe(base);
  });
  it("detects rustfmt in cargo bin and rejects an unknown runner OS", async () => {
    expect((await profile(runner("Linux", "cargo"))).output.trim()).toBe("ubuntu+rustfmt");
    expect((await profile({ ...runner("Linux", "absent"), RUNNER_OS: "Windows" })).status).not.toBe(0);
  });
  it.each(["Linux", "macOS"] as const)("comparator follows the measured %s rustfmt status", async (osName) => {
    for (const mode of ["present", "absent"] as const) {
      const measured = (await profile(runner(osName, mode))).output.trim();
      const good = mode === "present" ? "passed" : "skipped";
      const bad = mode === "present" ? "skipped" : "passed";
      const withMac = osName === "macOS";
      expect((await compare("ci", files(good, withMac), files("passed", withMac), measured, withMac)).status).toBe(0);
      expect((await compare("ci", files(bad, withMac), files("passed", withMac), measured, withMac)).status).not.toBe(0);
    }
  });
  it("keeps macOS availability when rustfmt is added", async () => {
    const measured = (await profile(runner("macOS", "present"))).output.trim();
    expect((await compare("ci", files("passed", true), files("passed", true), measured, true)).status).toBe(0);
    const skippedMac = files("passed", true);
    skippedMac.testResults[1].assertionResults[0].status = "skipped";
    expect((await compare("ci", skippedMac, files("passed", true), measured, true)).status).not.toBe(0);
  });
  it("rejects malformed profile tokens", async () => {
    for (const name of ["", "ubuntu+rustfmt+rustfmt", "macos+plugin", "rustfmt", "ubuntu+macos"]) {
      expect((await compare("ci", files("passed"), files("passed"), name)).status, name).not.toBe(0);
    }
  });
  it("carries the measured rustfmt status into parity", async () => {
    for (const mode of ["present", "absent"] as const) {
      const measured = (await profile(runner("Linux", mode))).output.trim();
      const ci = files(mode === "present" ? "passed" : "skipped");
      const local = files("passed");
      expect((await compare("ci", ci, local, measured)).status).toBe(0);
      const result = await compare("parity", ci, local, measured);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("PARITY PASS (1/1 required IDs executed)");
    }
  });
});
