// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, python, records, sleeper, until } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("preserves identity, registration, CPU collector and release Cargo provenance boundaries", async()=>{
  const h=fixture("guard-policy-invariants-");
  const child=sleeper();
  try{
    // Read the real OS collector in addition to the nonzero deterministic rows
    // in C1. Startup CPU decays between real ps reads; allow its rounding drift.
    const cpu = await python(`rows=guard.run('ps','-axo','pgid=,%cpu=').splitlines();expected=sum(float(r.split()[1]) for r in rows if len(r.split())==2 and int(r.split()[0])==${child.pid})/(os.cpu_count() or 1);print(json.dumps([expected,guard.group_cpu(${child.pid})]))`,h.env);
    expect(cpu[1]).toBeCloseTo(cpu[0], 1);
    const base=await python(`print(json.dumps(guard.identity(${child.pid})))`,h.env);
    const shim=path.join(h.dir,"ps");
    for(const [uid,pgid] of [[process.getuid!()+1,child.pid!],[process.getuid!(),child.pid!+1]]){
      fs.writeFileSync(shim,`#!/bin/sh\nif [ "$*" = '-p ${child.pid} -o uid=,lstart=,pgid=' ]; then echo '${uid} ${base.start} ${pgid}'; else exec /bin/ps "$@"; fi\n`,{mode:0o700});
      const env={...h.env,PATH:`${h.dir}:${process.env.PATH}`};
      expect(await python(`print(json.dumps(guard.signal_if_same(${child.pid},${child.pid},${JSON.stringify(base.start)},'CONT')))`,env)).toBe(1);
      expect(()=>process.kill(child.pid!,0)).not.toThrow();
    }
    fs.unlinkSync(shim);
    const ready=path.join(h.dir,"registered-ready"), marker=path.join(h.dir,"registered-term");
    const registering=spawn("python3",["-c",`import os,sys,time,signal,pathlib,json,subprocess
p=pathlib.Path(sys.argv[1]);a=p/'active';a.mkdir(exist_ok=True)
def term(*_):
 fields=subprocess.check_output(['/bin/ps','-p',str(os.getpid()),'-o','uid=,lstart=,pgid='],text=True).split()
 (a/(str(os.getpgrp())+'.json')).write_text(json.dumps(dict(pid=os.getpid(),pgid=os.getpgrp(),uid=os.getuid(),start=' '.join(fields[1:-1]))))
 (p/'registered-term').touch()
signal.signal(signal.SIGTERM,term)
(p/'processes').write_text(json.dumps([dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgrp(),uid=os.getuid(),cwd=str(p),command='/Applications/Xcode.app/Contents/Developer/usr/bin/xctest '+str(p)+'/PicseeAppTests.xctest')]))
(p/'registered-ready').touch()
while True:time.sleep(.02)
`,h.dir],{detached:true,stdio:"ignore"});
    try{
      await until(()=>fs.existsSync(ready));
      fs.writeFileSync(h.sampler,"#!/bin/sh\necho '4 0 16'\n",{mode:0o700});
      const env={...h.env,MDPRO_LOAD_GUARD_PROCESSES:path.join(h.dir,"processes")};
      for(let tick=0;tick<2;tick++)expect((await runChild("python3",[path.join(guardDir,"backstop.py"),"--once"],{env})).status).toBe(0);
      expect(fs.existsSync(marker)).toBe(true);
      expect(()=>process.kill(registering.pid!,0)).not.toThrow();
      expect(records(h.dir).filter(r=>r.event==="stop")).toHaveLength(0);
    }finally{await cleanup(registering);}
    fs.writeFileSync(path.join(h.dir,"Cargo.toml"),'[package]\nname="release_fixture"\nversion="0.0.0"\nedition="2021"\n[lib]\npath="lib.rs"\n');
    const cargoReady=path.join(h.dir,"cargo-ready");
    fs.writeFileSync(path.join(h.dir,"lib.rs"),'#[test] fn holds(){std::fs::write(std::env::var("MDPRO_CARGO_READY").unwrap(),"ready").unwrap();std::thread::sleep(std::time::Duration::from_secs(20));}\n');
    const cargo=spawn("cargo",["test","--release","--manifest-path",path.join(h.dir,"Cargo.toml"),"--target-dir",path.join(h.dir,"target"),"-j","1"],{env:{...h.env,MDPRO_CARGO_READY:cargoReady},detached:true,stdio:"ignore"});
    try{
      await until(()=>fs.existsSync(cargoReady),15000);
      const row=await python(`p=backstop.inventory();r=next(r for r in p if r['pgid']==${cargo.pid} and '/target/release/deps/' in r.get('executable',''));print(json.dumps(r))`,h.env);
      const check=()=>python(`print(json.dumps(backstop.allowlisted(${JSON.stringify(row)})))`,h.env);
      expect(await check()).toBe(true);
      expect(await python(`print(json.dumps(backstop.allowlisted(${JSON.stringify(row)})))`,{...h.env,MDPRO_LOAD_GUARD_TEST_ROOT:path.join(h.dir,"different-root")})).toBe(false);
      const depfile=row.executable+".d";
      fs.renameSync(depfile,depfile+".saved");expect(await check()).toBe(false);fs.renameSync(depfile+".saved",depfile);
      fs.renameSync(path.join(h.dir,"Cargo.toml"),path.join(h.dir,"Cargo.saved"));expect(await check()).toBe(false);
    }finally{await cleanup(cargo);}
  }finally{await cleanup(child);fs.rmSync(h.dir,{recursive:true,force:true});}
},30000);
