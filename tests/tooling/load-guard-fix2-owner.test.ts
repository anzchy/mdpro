// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { fixture, python, wrapper } from "../support/loadGuardFix";

it("keeps foreign raw and near-safe commands out of every holder diagnostic and rechecks reclaim start", async () => {
  const secret = "AUDIT_SENTINEL_CREDENTIAL_7f3a";
  const commands = [`runner --token=${secret}`, `xcrun xctest --token=${secret} ...`, `xcrun sha256:0123456789abcdef --token=${secret}`];
  commands.push(`xcrun xctest\ncwd=${secret}`);
  for (const phase of ["timeout", "heartbeat", "reclaim", "replacement"]) {
    for (const command of commands) {
      const h = fixture("fix2-owner-");
      try {
        const lock = h.env.MDPRO_HEAVY_LOCK!;
        const owner = path.join(lock, "owner"), marker = path.join(h.dir, "entered"), restored = path.join(h.dir, "restored");
        fs.mkdirSync(lock);
        const live = phase === "timeout" || phase === "heartbeat";
        const info = await python(`print(json.dumps(guard.identity(${process.pid})))`, h.env);
        const original = `pid=${live ? process.pid : 2147483646}\nstarted=2026-10-29T00:00:00Z\nprocess_start=${info.start}\ncwd=${h.dir}\ncmd=${command}\n`;
        fs.writeFileSync(owner, original);
        fs.writeFileSync(path.join(h.dir, "sleep"), "#!/bin/sh\nexec /bin/sleep .005\n", { mode: 0o700 });
        if (phase === "replacement") {
          const realPython = (await runChild("/usr/bin/which", ["python3"])).stdout.trim();
          fs.writeFileSync(path.join(h.dir, "mv"), `#!${realPython}
import os,pathlib,sys
source,dest=sys.argv[1:]
os.rename(source,dest)
p=pathlib.Path(dest)/'owner'
if source==${JSON.stringify(lock)}:
 p.write_text(p.read_text().replace(${JSON.stringify(info.start)},'changed process start'))
else:
 pathlib.Path(${JSON.stringify(restored)}).touch()
 p.write_text(p.read_text().replace('pid=2147483646','pid=${process.pid}'))
`, { mode: 0o700 });
        }
        const result = await runChild(wrapper, ["/bin/sh", "-c", `touch '${marker}'`], { env: { ...h.env, PATH: `${h.dir}:${process.env.PATH}`,
          MDPRO_HEAVY_LOCK_WAIT_SECS: phase === "heartbeat" ? "60" : "0" }, timeout: 8000 });
        expect(result.status, `${phase} ${command}`).toBe(phase === "reclaim" ? 0 : 75);
        expect(result.stderr).not.toContain(secret);
        expect(result.stderr).not.toContain("cmd=");
        expect(result.stderr).toContain(phase === "reclaim" ? "reclaiming" : "waiting for");
        if (phase === "heartbeat") expect(result.stderr).toContain("still waiting");
        if (phase !== "reclaim") expect(result.stderr).toContain("gave up");
        const log = h.env.MDPRO_LOAD_GUARD_LOG!;
        expect(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").not.toContain(secret);
        expect(fs.existsSync(marker)).toBe(phase === "reclaim");
        if (live) expect(fs.readFileSync(owner, "utf8")).toBe(original);
        if (phase === "replacement") {
          expect(fs.existsSync(restored)).toBe(true);
          expect(fs.readFileSync(owner, "utf8")).toContain("process_start=changed process start\n");
        }
      } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
    }
  }
}, 30000);
