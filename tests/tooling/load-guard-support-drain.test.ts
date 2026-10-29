// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { runChild, waitForExit } from "../support/loadGuardChild";
import { fixture, guardDir, python, records, until } from "../support/loadGuardFix";

it.skipIf(process.platform !== "darwin")("drains an unchanged verified support child after its runner parent exits on TERM", async () => {
  const h = fixture("backstop-support-drain-");
  const ready = path.join(h.dir, "ready");
  const inventory = path.join(h.dir, "processes");
  const packageName = fs.readdirSync("node_modules/.pnpm").find((name) => name.startsWith("@esbuild+darwin-arm64@"))!;
  const support = fs.realpathSync(path.resolve("node_modules/.pnpm", packageName, "node_modules/@esbuild/darwin-arm64/bin/esbuild"));
  const worker = path.join(h.dir, "worker.py");
  fs.writeFileSync(worker, "import signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nwhile True:time.sleep(.02)\n");
  const child = spawn("python3", ["-c", `import os,json,pathlib,subprocess,signal,time,sys
p=pathlib.Path(sys.argv[1]); w=subprocess.Popen([sys.executable,str(p/'worker.py')])
rows=[dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgrp(),uid=os.getuid(),cwd=${JSON.stringify(process.cwd())},executable=${JSON.stringify(process.execPath)},command='node (vitest)'),dict(pid=w.pid,ppid=os.getpid(),pgid=os.getpgrp(),uid=os.getuid(),cwd=${JSON.stringify(process.cwd())},executable=${JSON.stringify(support)},command=${JSON.stringify(support + " --service=0.27.2 --ping")})]
def term(*_):
 (p/'term').touch()
 rows[1]['ppid']=1
 (p/'processes').write_text(json.dumps(rows[1:]))
 sys.exit(0)
signal.signal(signal.SIGTERM,term)
time.sleep(.1)
(p/'processes').write_text(json.dumps(rows));(p/'ready').write_text(str(w.pid))
while True:time.sleep(.02)
`, h.dir], { detached: true, stdio: "ignore" });
  const done = waitForExit(child);
  let workerPid = 0;
  try {
    await until(() => fs.existsSync(ready));
    workerPid = Number(fs.readFileSync(ready, "utf8"));
    fs.writeFileSync(h.sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
    const env = { ...h.env, MDPRO_LOAD_GUARD_PROCESSES: inventory };
    for (let tick = 0; tick < 2; tick++) expect((await runChild("python3", [path.join(guardDir, "backstop.py"), "--once"], { env })).status).toBe(0);
    expect(fs.existsSync(path.join(h.dir, "term"))).toBe(true);
    await done;
    expect(() => process.kill(workerPid, 0)).toThrow();
    expect(await python(`print(json.dumps([r for r in guard.run('ps','-axo','pid=,pgid=').splitlines() if r.split()[-1]==str(${child.pid})]))`, env)).toEqual([]);
    expect(records(h.dir).filter((r) => r.event === "stop")).toHaveLength(1);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already drained */ }
    await done;
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
}, 10000);
