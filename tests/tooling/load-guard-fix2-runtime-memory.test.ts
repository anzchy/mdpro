// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { fixture, records, wrapper } from "../support/loadGuardFix";

it("expires delayed and backwards runtime memory evidence and rebuilds fresh streaks", async () => {
  const vectors = [
    ...["gap", "backwards"].flatMap((mode) => [
      { name: `${mode} incomplete memory suffix`, mode, gapIndex: 1, values: [{ pressure: 4, cpu: 0 }, { pressure: 4, cpu: 0 }], stop: false, warn: 0 },
      { name: `${mode} rebuilt memory suffix`, mode, gapIndex: 1, values: [{ pressure: 4, cpu: 0 }, { pressure: 4, cpu: 0 }, { pressure: 4, cpu: 0 }], stop: true, warn: 0 },
    ]),
    { name: "continuous memory", mode: "continuous", gapIndex: -1, values: [{ pressure: 4, cpu: 0 }, { pressure: 4, cpu: 0 }], stop: true, warn: 0 },
  ];
  for (const vector of vectors) {
    const h = fixture("fix2-runtime-memory-");
    try {
      const complete = path.join(h.dir, "complete");
      const index = path.join(h.dir, "index");
      const realPython = (await runChild("/usr/bin/which", ["python3"])).stdout.trim();
      const values = [{ pressure: 1, cpu: 0 }, ...vector.values];
      fs.writeFileSync(h.sampler, `#!${realPython}
import json,pathlib,time
p=pathlib.Path(${JSON.stringify(index)})
i=int(p.read_text()) if p.exists() else 0
values=json.loads(${JSON.stringify(JSON.stringify(values))})
if i==${vector.gapIndex + 1} and ${vector.mode === "gap" ? "True" : "False"}: time.sleep(2.25)
p.write_text(str(i+1))
v=values[i] if i<len(values) else {'pressure':1,'cpu':0}
if i==len(values)-1: pathlib.Path(${JSON.stringify(complete)}).touch()
print(str(v['pressure'])+' '+('99' if v['cpu'] else '0')+' 16 '+str(v['cpu']))
`, { mode: 0o700 });
      if (vector.mode === "backwards") {
        fs.writeFileSync(path.join(h.dir, "python3"), `#!${realPython}
import os,sys,pathlib
if len(sys.argv)>2 and sys.argv[2]=='clock':
 p=pathlib.Path(${JSON.stringify(index)})
 n=int(p.read_text()) if p.exists() else 0
 print(100+n if n<=${vector.gapIndex + 1} else 90+n)
else: os.execv(${JSON.stringify(realPython)},[${JSON.stringify(realPython)},*sys.argv[1:]])
`, { mode: 0o700 });
      }
      const result = await runChild(wrapper, ["/bin/sh", "-c", `while [ ! -e '${complete}' ]; do sleep .02; done; sleep .3; exit 7`],
        { env: { ...h.env, PATH: `${h.dir}:${process.env.PATH}` }, timeout: 15000 });
      expect(result.status, vector.name).toBe(vector.stop ? 76 : 7);
      expect(records(h.dir).filter((r) => r.event === "stop" && r.reason === "memory")).toHaveLength(vector.stop ? 1 : 0);
      if (vector.warn) expect(records(h.dir).filter((r) => r.event === "warn" && r.reason === "cpu")).toHaveLength(vector.warn);
      expect(fs.existsSync(h.env.MDPRO_HEAVY_LOCK!)).toBe(false);
      expect(fs.readdirSync(h.env.MDPRO_LOAD_GUARD_ACTIVE!)).toEqual([]);
    } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
  }
}, 30000);
