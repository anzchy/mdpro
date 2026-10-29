// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { waitForExit } from "../support/loadGuardChild";
import { delay, fixture, python, singleDayPs, until, wrapper } from "../support/loadGuardFix";

it("holds the lock through INT and TERM drain with single-digit start dates", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const h = fixture("single-day-signal-");
    singleDayPs(h.dir);
    const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}` };
    const worker = path.join(h.dir, "worker.py");
    fs.writeFileSync(worker, `import os,signal,pathlib,time\np=pathlib.Path(${JSON.stringify(h.dir)})\nsignal.signal(signal.SIGTERM,lambda *_:(p/'term').touch())\n(p/'pid').write_text(str(os.getpid()))\nwhile True:time.sleep(.02)\n`);
    const child = spawn(wrapper, ["/bin/bash", "-c", `python3 '${worker}' & wait`], { env, stdio: "ignore" });
    const done = waitForExit(child);
    let pid = 0;
    try {
      await until(() => fs.existsSync(path.join(h.dir, "pid")));
      pid = Number(fs.readFileSync(path.join(h.dir, "pid"), "utf8"));
      await until(() => fs.existsSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!) && fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!).length > 0);
      const registration = JSON.parse(fs.readFileSync(path.join(h.env.MDPRO_LOAD_GUARD_ACTIVE!, fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!)[0]), "utf8"));
      child.kill(signal);
      await until(() => fs.existsSync(path.join(h.dir, "term")), 3000);
      await delay(100);
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(true);
      const queuedMarker = path.join(h.dir, "queued");
      const queued = spawn(wrapper, ["/usr/bin/touch", queuedMarker], { env, stdio: "ignore" });
      const queuedDone = waitForExit(queued);
      await delay(100);
      expect(fs.existsSync(queuedMarker)).toBe(false);
      await done;
      expect(child.signalCode).toBe(signal);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(await python(`print(json.dumps([r for r in guard.run('ps','-axo','pid=,pgid=').splitlines() if r.split()[-1]==str(${registration.pgid})]))`, env)).toEqual([]);
      expect(await queuedDone).toBe(0);
      expect(fs.existsSync(queuedMarker)).toBe(true);
    } finally {
      child.kill("SIGTERM");
      if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      await done;
      fs.rmSync(h.dir, { recursive: true, force: true });
    }
  }
}, 25000);
