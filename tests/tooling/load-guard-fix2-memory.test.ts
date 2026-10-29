// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("expires memory evidence on late, backwards and legacy samples and rebuilds a fresh streak", async () => {
  for (const vector of ["gap", "backwards", "legacy", "boundary", "fresh-global-stale-memory"]) {
    const h = fixture("fix2-memory-");
    const child = sleeper();
    try {
      const inventory = path.join(h.dir, "processes");
      fs.writeFileSync(inventory, JSON.stringify([{ pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: h.dir,
        command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` }]));
      fs.writeFileSync(h.sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
      const tick = async (clock: number) => {
        const result = await runChild("python3", ["-c", `import sys,time;sys.path.insert(0,${JSON.stringify(guardDir)});time.time=lambda:${clock};import backstop;sys.exit(backstop.once())`],
          { env: { ...h.env, MDPRO_LOAD_GUARD_PROCESSES: inventory } });
        expect(result.status).toBe(0);
      };
      await tick(100);
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
      if (vector === "legacy" || vector === "fresh-global-stale-memory") {
        const state = JSON.parse(fs.readFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, "utf8"));
        if (vector === "legacy") delete state.memorySampleTime;
        else { state.memorySampleTime = 90; state.sampleTime = 100; }
        fs.writeFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, JSON.stringify(state));
      }
      const now = vector === "gap" ? 107.001 : vector === "backwards" ? 99 : vector === "boundary" ? 107 : 101;
      await tick(now);
      if (vector !== "boundary") {
        expect(() => process.kill(child.pid!, 0)).not.toThrow();
        const state = JSON.parse(fs.readFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, "utf8"));
        expect(state.memory).toBe(1);
        expect(state.memorySampleTime).toBe(now);
        expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(0);
        await tick(now + 1);
      }
      await waitForExit(child);
      expect(() => process.kill(child.pid!, 0)).toThrow();
      expect(records(h.dir).filter((r) => r.event === "stop" && r.reason === "memory")).toHaveLength(1);
    } finally { await cleanup(child); fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
}, 20000);
