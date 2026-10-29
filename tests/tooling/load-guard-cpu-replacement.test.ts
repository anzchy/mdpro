// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("refuses CPU evidence when the OS identity changes before TERM", async () => {
  const h = fixture("guard-cpu-replacement-");
  const child = sleeper();
  try {
    const rows = path.join(h.dir, "processes"), arm = path.join(h.dir, "arm"), count = path.join(h.dir, "count");
    fs.writeFileSync(rows, JSON.stringify([{pid: child.pid, ppid: process.pid, pgid: child.pid, uid: process.getuid!(), cwd: h.dir,
      command: `/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeKitPackageTests.xctest`}]));
    fs.writeFileSync(path.join(h.dir, "ps"), `#!/usr/bin/env python3
import subprocess,sys,pathlib,re
args=sys.argv[1:]
if args==['-axo','pgid=,%cpu=']:
 print('${child.pid} ${90 * os.cpus().length}');sys.exit(0)
r=subprocess.run(['/bin/ps',*args],capture_output=True,text=True)
if args==['-p','${child.pid}','-o','uid=,lstart=,pgid='] and pathlib.Path('${arm}').exists():
 p=pathlib.Path('${count}');n=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(n))
 if n>=2:r.stdout=re.sub(r'20[0-9]{2}', '2020',r.stdout)
sys.stdout.write(r.stdout);sys.exit(r.returncode)
`, { mode: 0o700 });
    fs.writeFileSync(h.sampler, "#!/bin/sh\necho '1 99 16'\n", { mode: 0o700 });
    const env = {...h.env, PATH: `${h.dir}:${process.env.PATH}`, MDPRO_LOAD_GUARD_PROCESSES: rows};
    for (let tick=0; tick<3; tick++) {
      if (tick===2) fs.writeFileSync(arm, "ready");
      expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], {env})).status).toBe(0);
    }
    expect(Number(fs.readFileSync(count,"utf8"))).toBeGreaterThanOrEqual(2);
    expect(() => process.kill(child.pid!,0)).not.toThrow();
    expect(records(h.dir).filter(r=>r.event==="stop")).toHaveLength(0);
  } finally { await cleanup(child); fs.rmSync(h.dir,{recursive:true,force:true}); }
});
