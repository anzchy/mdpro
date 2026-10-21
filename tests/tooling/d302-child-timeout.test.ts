// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOwnerChildRunner } from "./d302Child";

describe("D302 nested child deadline", () => {
  it("reports a timeout even when the child traps SIGTERM and exits zero", async (context) => {
    const runner = createOwnerChildRunner(context.signal);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "d302-timeout-armed-"));
    const marker = path.join(folder, "armed");
    try {
      const child = `const fs=require('node:fs');process.on('SIGTERM',()=>process.exit(0));fs.writeFileSync(${JSON.stringify(marker)},'armed');setInterval(()=>{},1000);`;
      const result = await runner.run(process.execPath, ["-e", child], { cwd: process.cwd(), timeout: 1_000 });
      expect(fs.readFileSync(marker, "utf8")).toBe("armed");
      expect(result.status).toBeNull();
    } finally { await runner.close(); fs.rmSync(folder, { recursive: true, force: true }); }
  });
  it("keeps a normal zero exit and stdout", async (context) => {
    const runner = createOwnerChildRunner(context.signal);
    try {
      const result = await runner.run(process.execPath, ["-e", "process.stdout.write('ok')"], { cwd: process.cwd(), timeout: 2_000 });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("ok");
    } finally { await runner.close(); }
  });
});
