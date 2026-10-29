// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { fixture, python, records, singleDayPs, wrapper } from "../support/loadGuardFix";

it("stops locked and guard-only jobs early with a padded single-digit start day", async () => {
  for (const mode of [[], ["--guard-only"]]) {
    const h = fixture("single-day-runtime-");
    singleDayPs(h.dir);
    const pidFile = path.join(h.dir, "pid");
    fs.writeFileSync(h.sampler, `#!/bin/sh\nif [ -e '${pidFile}' ]; then echo '4 0 16'; else echo '1 0 16'; fi\n`, { mode: 0o700 });
    const env = { ...h.env, PATH: `${h.dir}:${process.env.PATH}` };
    try {
      const start = Date.now();
      const result = await runChild(wrapper, [...mode, "/bin/sh", "-c", `echo $$ > '${pidFile}'; exec /bin/sleep 12`], { env, timeout: 16000 });
      expect(result.status).toBe(76);
      expect(Date.now() - start).toBeLessThan(7000);
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      expect(await python(`print(json.dumps([p for p in guard.run('ps','-axo','pid=,pgid=').splitlines() if p.split()[-1]==str(${pid})]))`, env)).toEqual([]);
      expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(false);
      expect(fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!)).toEqual([]);
      expect(records(h.dir).filter((r) => r.event === "stop" && r.reason === "memory")).toHaveLength(1);
    } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
}, 35000);
