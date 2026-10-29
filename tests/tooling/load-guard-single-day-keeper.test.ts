// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { fixture, python, singleDayPs, until, wrapper } from "../support/loadGuardFix";

it("round-trips keeper ownership and reaps its child on single-digit days", async () => {
  const h = fixture("single-day-keeper-");
  singleDayPs(h.dir);
  const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}` };
  const pids: number[] = [];
  try {
    for (let round = 0; round < 2; round++) {
      const id = randomUUID();
      expect((await runChild(wrapper, ["--hold", id], { env })).status).toBe(0);
      const owner = fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK!, "owner"), "utf8");
      const pid = Number(owner.match(/^pid=(\d+)/m)![1]);
      pids.push(pid);
      expect(await python(`info=guard.identity(${pid}); variants=[(' '*n).join(info['start'].split()) for n in range(1,12)];print(json.dumps([guard.signal_pid_if_same(${pid},value,'CONT') for value in variants]+[guard.signal_pid_if_same(${pid},info['start'].replace('2026','1999'),'CONT')]))`, env)).toEqual([...Array(11).fill(0), 1]);
      const descendants: number[] = await python(`print(json.dumps([int(r.split()[0]) for r in guard.run('ps','-axo','pid=,ppid=').splitlines() if r.split()[-1]==str(${pid})]))`, env);
      expect(descendants.length).toBeGreaterThan(0);
      expect((await runChild(wrapper, ["--release", randomUUID()], { env })).status).toBe(1);
      expect(fs.readFileSync(path.join(h.env.MDPRO_HEAVY_LOCK!, "owner"), "utf8")).toBe(owner);
      expect((await runChild(wrapper, ["--release", id], { env })).status).toBe(0);
      await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
      for (const descendant of descendants) expect(() => process.kill(descendant, 0)).toThrow();
      expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(false);
    }
  } finally {
    for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
}, 20000);
