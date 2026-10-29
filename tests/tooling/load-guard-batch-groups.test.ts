// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("stops every eligible group in either inventory order and preserves protected members", async () => {
  for (const reversed of [false, true]) {
    const h = fixture("guard-batch-groups-");
    const first = sleeper(), second = sleeper(), protectedChild = sleeper();
    try {
      const row = (pid: number) => ({ pid, ppid: process.pid, pgid: pid, uid: process.getuid!(), cwd: h.dir,
        command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` });
      const eligible = [row(first.pid!), row(second.pid!)];
      if (reversed) eligible.reverse();
      const processes = path.join(h.dir, "processes");
      fs.writeFileSync(processes, JSON.stringify([...eligible, { ...row(protectedChild.pid!), command: "/usr/bin/codesign --sign identity" }]));
      fs.writeFileSync(h.sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
      const env = { ...h.env, MDPRO_LOAD_GUARD_PROCESSES: processes };
      for (let tick = 0; tick < 2; tick++) expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
      await Promise.all([waitForExit(first), waitForExit(second)]);
      expect(() => process.kill(first.pid!, 0)).toThrow();
      expect(() => process.kill(second.pid!, 0)).toThrow();
      expect(() => process.kill(protectedChild.pid!, 0)).not.toThrow();
      expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(2);
    } finally { await Promise.all([cleanup(first), cleanup(second), cleanup(protectedChild)]); fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
}, 15000);
