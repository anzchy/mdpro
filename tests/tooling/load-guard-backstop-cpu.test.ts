// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("attributes three hot samples per candidate identity and resets CPU evidence", async () => {
  const vectors = [
    { busy: [99, 99, 99, 99], cpu: [10, 10, 10, 10], stop: false },
    { busy: [95, 95, 95], cpu: [90, 90, 90], stop: false },
    { busy: [95.01, 95.01, 95.01], cpu: [90, 90, 90], stop: true },
    { busy: [100, 100, 100], cpu: [100, 100, 40], stop: false },
    { busy: [100, 100, 100], cpu: [50, 100, 100], stop: true },
    { busy: [100, 100, 100], cpu: [79.99, 79.99, 79.99], stop: false },
    { busy: [99, 99, 90, 99, 99], cpu: [90, 90, 0, 90, 90], stop: false },
    { busy: [99, 99, "unreadable", 99, 99], cpu: [90, 90, 0, 90, 90], stop: false },
  ];
  for (const vector of vectors) {
    const h = fixture("backstop-attribution-");
    const child = sleeper();
    try {
      const processFile = path.join(h.dir, "processes");
      fs.writeFileSync(processFile, JSON.stringify([{ pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: h.dir,
        command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` }]));
      const cpuFile = path.join(h.dir, "cpu");
      fs.writeFileSync(path.join(h.dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pgid=,%cpu=' ]; then cat '${cpuFile}'; else exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
      const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}`, MDPRO_LOAD_GUARD_PROCESSES: processFile };
      for (let index = 0; index < vector.busy.length; index++) {
        fs.writeFileSync(h.sampler, `#!/bin/sh\necho '1 ${vector.busy[index]} 16'\n`, { mode: 0o700 });
        // Two same-group members sum to the target normalized CPU. An unrelated
        // group is deliberately much busier and must not be charged to it.
        fs.writeFileSync(cpuFile, `${child.pid} ${vector.cpu[index] * os.cpus().length / 2}\n${child.pid} ${vector.cpu[index] * os.cpus().length / 2}\n2147483646 99999\n`);
        expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
        if (!vector.stop || index < vector.busy.length - 1) expect(() => process.kill(child.pid!, 0)).not.toThrow();
      }
      if (vector.stop) { await waitForExit(child); expect(() => process.kill(child.pid!, 0)).toThrow(); }
      expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(vector.stop ? 1 : 0);
      if (vector.busy[0] === 99 && vector.cpu[0] === 10) expect(records(h.dir).filter((r) => r.event === "warn" && r.reason === "cpu")).toHaveLength(1);
    } finally { await cleanup(child); fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
  // A candidate appearing on the third global hot tick needs three of its own
  // observations; a second low-CPU group never borrows its attribution.
  const h = fixture("backstop-late-candidate-");
  const high = sleeper(), low = sleeper();
  try {
    const processFile = path.join(h.dir, "processes");
    fs.writeFileSync(path.join(h.dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pgid=,%cpu=' ]; then echo '${high.pid} ${90 * os.cpus().length}'; echo '${low.pid} ${10 * os.cpus().length}'; else exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
    const row = (pid: number) => ({ pid, ppid: process.pid, pgid: pid, uid: process.getuid!(), cwd: h.dir,
      command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest` });
    const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}`, MDPRO_LOAD_GUARD_PROCESSES: processFile };
    fs.writeFileSync(h.sampler, "#!/bin/sh\necho '1 99 16'\n", { mode: 0o700 });
    for (let tick = 0; tick < 5; tick++) {
      fs.writeFileSync(processFile, JSON.stringify(tick < 2 ? [row(low.pid!)] : [row(low.pid!), row(high.pid!)]));
      expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
      expect(() => process.kill(low.pid!, 0)).not.toThrow();
      if (tick < 4) expect(() => process.kill(high.pid!, 0)).not.toThrow();
    }
    await waitForExit(high);
    expect(() => process.kill(high.pid!, 0)).toThrow();
  } finally { await Promise.all([cleanup(high), cleanup(low)]); fs.rmSync(h.dir, { recursive: true, force: true }); }
  const stale = fixture("backstop-stale-cpu-");
  const replacement = sleeper();
  try {
    const inventory = path.join(stale.dir, "processes");
    fs.writeFileSync(inventory, JSON.stringify([{ pid: replacement.pid, ppid: process.pid, pgid: replacement.pid, uid: process.getuid!(), cwd: stale.dir,
      command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${stale.dir}/PicseeKitPackageTests.xctest` }]));
    fs.writeFileSync(path.join(stale.dir, "ps"), `#!/bin/sh\nif [ "$*" = '-axo pgid=,%cpu=' ]; then echo '${replacement.pid} ${90 * os.cpus().length}'; else exec /bin/ps "$@"; fi\n`, { mode: 0o700 });
    fs.writeFileSync(stale.sampler, "#!/bin/sh\necho '1 99 16'\n", { mode: 0o700 });
    const env = { ...stale.env, PATH: `${stale.dir}:${process.env.PATH}`, MDPRO_LOAD_GUARD_PROCESSES: inventory };
    const tick = () => runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env });
    expect((await tick()).status).toBe(0);
    expect((await tick()).status).toBe(0);
    const state = JSON.parse(fs.readFileSync(stale.env.MDPRO_LOAD_GUARD_STATE!, "utf8"));
    state.groups[String(replacement.pid)].identity.start = "prior occupant of reused pgid";
    fs.writeFileSync(stale.env.MDPRO_LOAD_GUARD_STATE!, JSON.stringify(state));
    for (let i = 0; i < 2; i++) { expect((await tick()).status).toBe(0); expect(() => process.kill(replacement.pid!, 0)).not.toThrow(); }
    expect((await tick()).status).toBe(0);
    await waitForExit(replacement);
    expect(() => process.kill(replacement.pid!, 0)).toThrow();
  } finally { await cleanup(replacement); fs.rmSync(stale.dir, { recursive: true, force: true }); }
}, 30000);
