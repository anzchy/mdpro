// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it("refuses to signal a live group when the recorded process start time changed", async () => {
  const child = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
  const exited = waitForExit(child);
  try {
    const result = (await runChild("python3", [path.resolve("scripts/load-guard/guard.py"),
      "signal", String(child.pid), String(child.pid), "old process start time", "TERM"], { encoding: "utf8" }));
    expect(result.status).toBe(1);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
    await exited;
  }
});
