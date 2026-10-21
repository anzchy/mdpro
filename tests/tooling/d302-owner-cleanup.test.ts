// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createOwnerChildRunner } from "./d302Child";

vi.setConfig({ testTimeout: 20_000 });
const repo = path.resolve(import.meta.dirname, "../..");
const folders: string[] = [];
afterAll(() => { for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true }); });
async function nested(mode: "timeout" | "normal", signal: AbortSignal) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "d302-owner-outer-"));
  folders.push(folder);
  const runner = createOwnerChildRunner(signal);
  const run = runner.run("pnpm", ["exec", "vitest", "run", "tests/tooling/unit-red-phase.test.ts", "--testNamePattern=D302 owner cleanup probe"], {
    cwd: repo, timeout: 15_000, env: { ...process.env, D302_OWNER_INNER: mode, D302_PROBE_DIR: folder },
  });
  const waitFor = async (name: string) => {
    const deadline = Date.now() + 8_000;
    while (!fs.existsSync(path.join(folder, name))) {
      if (Date.now() > deadline) throw Error(`nested probe never wrote ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    await waitFor("ready");
    await waitFor("cleanup-alive");
    const cleanupAlive = fs.readFileSync(path.join(folder, "cleanup-alive"), "utf8");
    if (mode === "timeout") fs.writeFileSync(path.join(folder, "release"), "yes");
    const result = await run;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { ...result, output: result.stdout + result.stderr, folder, cleanupAlive, late: fs.existsSync(path.join(folder, "late")) };
  } finally {
    fs.writeFileSync(path.join(folder, "release"), "yes");
    await runner.close();
  }
}
describe("D302 owning-test lifecycle", () => {
  it("reaps a timed-out child before fixture removal and prevents a late write", async (context) => {
    const result = await nested("timeout", context.signal);
    expect(result.output).toContain("Test timed out");
    expect(result.cleanupAlive).toBe("false");
    expect(result.late).toBe(false);
  });
  it("preserves normal child output and intended marker bytes", async (context) => {
    const result = await nested("normal", context.signal);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(result.folder, "normal"), "utf8")).toBe("yes");
    expect(result.cleanupAlive).toBe("false");
  });
});
