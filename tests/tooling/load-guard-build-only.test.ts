// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, records, sleeper } from "../support/loadGuardFix";

it("never stops build-only groups or a runner mixed with xcodebuild", async()=>{
  for(const command of ["/usr/bin/swift build","/usr/bin/xcodebuild build","cargo build","runner-plus-xcodebuild"]){
    const h=fixture("guard-build-only-"), child=sleeper();
    try{
      const file=path.join(h.dir,"processes");
      const base={pid:child.pid,ppid:process.pid,pgid:child.pid,uid:process.getuid!(),cwd:h.dir};
      const rows=command==="runner-plus-xcodebuild" ? [
        {...base,command:`/Applications/Xcode.app/Contents/Developer/usr/bin/xctest ${h.dir}/PicseeAppTests.xctest`},
        {...base,pid:2147483646,ppid:child.pid,command:"/usr/bin/xcodebuild build"},
      ] : [{...base,command}];
      fs.writeFileSync(file,JSON.stringify(rows));
      fs.writeFileSync(h.sampler,"#!/bin/sh\necho '4 0 16'\n",{mode:0o700});
      const env={...h.env,MDPRO_LOAD_GUARD_PROCESSES:file};
      for(let tick=0;tick<3;tick++)expect((await runChild("python3",[path.join(guardDir,"backstop.py"),"--once"],{env})).status).toBe(0);
      expect(()=>process.kill(child.pid!,0)).not.toThrow();
      expect(records(h.dir).filter(r=>r.event==="stop")).toHaveLength(0);
    }finally{await cleanup(child);fs.rmSync(h.dir,{recursive:true,force:true});}
  }
});
