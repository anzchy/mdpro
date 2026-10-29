// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("expires each CPU history independently and rebuilds only its fresh identity's evidence", async () => {
  for (const vector of ["gap", "backwards", "legacy", "boundary", "fresh-global-stale-group", "stale-memory-fresh-group"]) {
    const h = fixture("fix2-cpu-");
    const child = sleeper();
    try {
      const inventory = path.join(h.dir, "processes");
      fs.writeFileSync(inventory, JSON.stringify([{ pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: h.dir,
        command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` }]));
      fs.writeFileSync(h.sampler, "#!/bin/sh\necho '1 99 16'\n", { mode: 0o700 });
      fs.writeFileSync(path.join(h.dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pgid=,%cpu=' ]; then echo '${child.pid} ${90 * os.cpus().length}'; else exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
      const tick = async (clock: number) => {
        const result = await runChild("python3", ["-c", `import sys,time;sys.path.insert(0,${JSON.stringify(guardDir)});time.time=lambda:${clock};import backstop;sys.exit(backstop.once())`],
          { env: { ...h.env, PATH: `${h.dir}:${process.env.PATH}`, MDPRO_LOAD_GUARD_PROCESSES: inventory } });
        expect(result.status).toBe(0);
      };
      await tick(100); await tick(101);
      if (["legacy", "fresh-global-stale-group", "stale-memory-fresh-group"].includes(vector)) {
        const state = JSON.parse(fs.readFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, "utf8"));
        if (vector === "legacy") delete state.groups[String(child.pid)].sampleTime;
        else if (vector === "fresh-global-stale-group") { state.groups[String(child.pid)].sampleTime = 90; state.memorySampleTime = 101; }
        else state.memorySampleTime = 0;
        fs.writeFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, JSON.stringify(state));
      }
      const now = vector === "gap" ? 108.001 : vector === "backwards" ? 99 : vector === "boundary" ? 108 : 102;
      await tick(now);
      if (vector !== "boundary" && vector !== "stale-memory-fresh-group") {
        expect(() => process.kill(child.pid!, 0)).not.toThrow();
        const state = JSON.parse(fs.readFileSync(h.env.MDPRO_LOAD_GUARD_STATE!, "utf8"));
        expect(state.groups[String(child.pid)].readings).toHaveLength(1);
        expect(state.groups[String(child.pid)].sampleTime).toBe(now);
        await tick(now + 1);
        expect(() => process.kill(child.pid!, 0)).not.toThrow();
        await tick(now + 2);
      }
      await waitForExit(child);
      expect(() => process.kill(child.pid!, 0)).toThrow();
      expect(records(h.dir).filter((r) => r.event === "stop" && r.reason === "cpu")).toHaveLength(1);
    } finally { await cleanup(child); fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
}, 30000);
