// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { scopeInventory } from "../support/loadGuardFix";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { cleanup, fixture, guardDir, python, records, until } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("stops real Vitest and Cargo test groups and preserves a protected real member", async () => {
  const h = fixture("guard-real-groups-");
  try {
    for (const protectedMember of [false, true]) {
      const ready = path.join(h.dir, `ready-${protectedMember}`);
      const config = path.join(h.dir, "vitest.config.mjs");
      fs.writeFileSync(config, `export default {test:{include:[${JSON.stringify(path.resolve("tests/fixtures/load-guard/runner.ts"))}],environment:'node',pool:'forks',maxWorkers:1,poolOptions:{forks:{execArgv:['--max-old-space-size=1024']}}}};`);
      const env = { ...h.env, MDPRO_FIX_RUNNER_READY: ready, MDPRO_FIX_PROTECTED: protectedMember ? "1" : "0" };
      const child = spawn(process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run", "--config", config], { env, detached: true, stdio: "ignore" });
      try {
        await scopeInventory(h.dir, env, child.pid!);
        await until(() => fs.existsSync(ready));
        const observed = await python(`p=backstop.inventory();g=[r for r in p if r['pgid']==${child.pid}];print(json.dumps({'commands':[r['command'] for r in g],'candidate':${child.pid} in backstop.candidate_groups(p)}))`, env);
        expect(observed.commands.some((s: string) => s.includes("esbuild") && s.includes("--service"))).toBe(true);
        expect(observed.candidate).toBe(!protectedMember);
        fs.writeFileSync(h.sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
        for (let tick = 0; tick < 2; tick++) expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
        if (protectedMember) {
          expect(() => process.kill(child.pid!, 0)).not.toThrow();
          expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(1);
        } else {
          await waitForExit(child);
          expect(await python(`print(json.dumps([r for r in guard.run('ps','-axo','pid=,pgid=').splitlines() if r.split()[-1]==str(${child.pid})]))`, env)).toEqual([]);
        }
        fs.unlinkSync(h.env.MDPRO_LOAD_GUARD_STATE!);
      } finally { await cleanup(child); }
    }
    fs.writeFileSync(path.join(h.dir, "Cargo.toml"), '[package]\nname="guard_fixture"\nversion="0.0.0"\nedition="2021"\n[lib]\npath="lib.rs"\n');
    const cargoReady = path.join(h.dir, "cargo-ready");
    fs.writeFileSync(path.join(h.dir, "lib.rs"), '#[test] fn holds(){std::fs::write(std::env::var("MDPRO_CARGO_READY").unwrap(),"ready").unwrap();std::thread::sleep(std::time::Duration::from_secs(20));}\n');
    const child = spawn("cargo", ["test", "--manifest-path", path.join(h.dir, "Cargo.toml"), "--target-dir", path.join(h.dir, "target"), "-j", "1", "--", "--nocapture"], {
      env: { ...h.env, MDPRO_CARGO_READY: cargoReady }, detached: true, stdio: "ignore",
    });
    try {
      await scopeInventory(h.dir, h.env, child.pid!);
      await until(() => fs.existsSync(cargoReady), 15000);
      const observed = await python(`p=backstop.inventory();g=[r for r in p if r['pgid']==${child.pid}];print(json.dumps({'commands':[r['command'] for r in g],'candidate':${child.pid} in backstop.candidate_groups(p)}))`, h.env);
      expect(observed.commands.some((s: string) => s.includes("/deps/guard_fixture-"))).toBe(true);
      expect(observed.commands.some((s: string) => s.includes("cargo test"))).toBe(true);
      expect(observed.candidate).toBe(true);
      for (let tick = 0; tick < 2; tick++) expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env: h.env })).status).toBe(0);
      await waitForExit(child);
      expect(await python(`print(json.dumps([r for r in guard.run('ps','-axo','pid=,pgid=').splitlines() if r.split()[-1]==str(${child.pid})]))`, h.env)).toEqual([]);
      expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(2);
    } finally { await cleanup(child); }
  } finally { fs.rmSync(h.dir, { recursive: true, force: true }); }
}, 60000);
