// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { scopeInventory } from "../support/loadGuardFix";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, python, records, until } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("drains a real suspended esbuild after Vitest exits using production inventory", async () => {
  const h = fixture("guard-real-orphan-");
  const ready=path.join(h.dir,"ready"), config=path.join(h.dir,"vitest.config.mjs");
  fs.writeFileSync(config,`export default {test:{include:[${JSON.stringify(path.resolve("tests/fixtures/load-guard/runner.ts"))}],environment:'node',pool:'forks',maxWorkers:1}};`);
  const env={...h.env,MDPRO_FIX_RUNNER_READY:ready};
  const child=spawn(process.execPath,[path.resolve("node_modules/vitest/vitest.mjs"),"run","--config",config],{env,detached:true,stdio:"ignore"});
  try {
    await scopeInventory(h.dir, env, child.pid!);
    await until(()=>fs.existsSync(ready));
    const group=await python(`p=backstop.inventory();print(json.dumps([r for r in p if r['pgid']==${child.pid}]))`,env);
    const helper=group.find((r: any)=>r.command.includes("--service=")&&r.command.includes("esbuild"));
    expect(helper).toBeDefined();
    process.kill(helper.pid,"SIGSTOP");
    fs.writeFileSync(h.sampler,"#!/bin/sh\necho '4 0 16'\n",{mode:0o700});
    for(let tick=0;tick<2;tick++) expect((await runChild("python3",[path.join(guardDir,"backstop.py"),"--once"],{env})).status).toBe(0);
    await waitForExit(child);
    expect(await python(`print(json.dumps([r for r in guard.run('ps','-axo','pid=,pgid=').splitlines() if r.split()[-1]==str(${child.pid})]))`,env)).toEqual([]);
    expect(records(h.dir).filter(r=>r.event==="stop")).toHaveLength(1);
  } finally { await cleanup(child);fs.rmSync(h.dir,{recursive:true,force:true}); }
},15000);
