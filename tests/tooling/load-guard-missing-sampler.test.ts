// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("reports unreadable when an OS sampler executable is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-missing-command-"));
  fs.writeFileSync(path.join(dir, "sysctl"), "#!/bin/sh\necho 1\n", { mode: 0o700 });
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn("/usr/bin/python3", [path.resolve("scripts/load-guard/guard.py"), "sample"], {
        env: { ...process.env, PATH: dir }, stdio: ["ignore", "pipe", "ignore"],
      });
      let output = "";
      child.stdout.on("data", (part: Buffer) => { output += part.toString(); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe("unreadable unreadable unreadable 1");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
