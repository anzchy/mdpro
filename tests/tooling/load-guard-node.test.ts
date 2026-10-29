// @vitest-environment node
import { runChild, waitForExit } from "../support/loadGuardChild";
import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")("recognizes a real Vitest process title only with its verified Node executable", async () => {
  const child = spawn(process.execPath, ["-e", "process.title='node (vitest 1)';process.stdout.write('ready');setInterval(()=>{},1000)"], {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "ignore"],
  });
  const done = waitForExit(child);
  try {
    await new Promise((resolve) => child.stdout!.once("data", resolve));
    const program = `import json,sys;sys.path.insert(0,${JSON.stringify(path.resolve("scripts/load-guard"))});import backstop\np=next(p for p in backstop.inventory() if p['pid']==${child.pid})\nprint(json.dumps([backstop.allowlisted(p),backstop.allowlisted({**p,'executable':'/tmp/fake/node'})]))`;
    const result = (await runChild("python3", ["-c", program], { encoding: "utf8", timeout: 15000 }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, false]);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    await done;
  }
}, 20000);
