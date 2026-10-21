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
describe("D302 descendant cleanup", () => {
  it("reaps a SIGTERM-resistant grandchild before fixture removal", async (context) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "d302-descendant-"));
    folders.push(folder);
    const runner = createOwnerChildRunner(context.signal);
    const run = runner.run("pnpm", ["exec", "vitest", "run", "tests/tooling/unit-red-phase.test.ts", "--testNamePattern=D302 owner cleanup probe"], {
      cwd: repo, timeout: 15_000, env: { ...process.env, D302_OWNER_INNER: "descendant", D302_PROBE_DIR: folder },
    });
    const waitFor = async (name: string) => {
      const deadline = Date.now() + 8_000;
      while (!fs.existsSync(path.join(folder, name))) {
        if (Date.now() > deadline) throw Error(`nested probe never wrote ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      await waitFor("grand-ready");
      await waitFor("ready");
      await waitFor("cleanup-alive");
      await waitFor("grand-cleanup-alive");
      const cleanupAlive = fs.readFileSync(path.join(folder, "cleanup-alive"), "utf8");
      const grandCleanupAlive = fs.readFileSync(path.join(folder, "grand-cleanup-alive"), "utf8");
      const grandCleanupState = fs.readFileSync(path.join(folder, "grand-cleanup-state"), "utf8");
      fs.writeFileSync(path.join(folder, "release"), "yes");
      const result = await run;
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(result.stdout + result.stderr).toContain("Test timed out");
      expect(cleanupAlive).toBe("false");
      expect(grandCleanupAlive, `grandchild state at cleanup: ${grandCleanupState}`).toBe("false");
      expect(fs.existsSync(path.join(folder, "grand-late"))).toBe(false);
    } finally {
      fs.writeFileSync(path.join(folder, "release"), "yes");
      await runner.close();
      const parentFile = path.join(folder, "pid");
      if (fs.existsSync(parentFile)) { try { process.kill(-Number(fs.readFileSync(parentFile, "utf8")), "SIGKILL"); } catch {} }
      const pidFile = path.join(folder, "grand-pid");
      if (fs.existsSync(pidFile)) { try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {} }
    }
  });
});
