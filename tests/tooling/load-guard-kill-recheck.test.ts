// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("preserves a group that becomes protected during the TERM grace", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-kill-recheck-"));
  const inventory = path.join(dir, "inventory");
  const ready = path.join(dir, "ready");
  const transitioned = path.join(dir, "transitioned");
  const protectedBinary = path.join(dir, "xcodebuild");
  fs.copyFileSync("/bin/sleep", protectedBinary);
  fs.chmodSync(protectedBinary, 0o700);
  // macOS rejects a copied system Mach-O with SIGKILL. A launcher retains
  // the protected inventory identity without invoking that platform policy.
  fs.writeFileSync(protectedBinary, '#!/bin/sh\nexec /bin/sleep "$@"\n');
  const child = spawn("python3", ["-c", `import os,signal,json,pathlib,time,sys
inventory,ready,transitioned,binary,root=sys.argv[1:]
def term(*_):
 pathlib.Path(inventory).write_text(json.dumps([dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgrp(),uid=os.getuid(),cwd=root,command=binary+" 60")]))
 pathlib.Path(transitioned).touch()
 os.execv(binary,[binary,"60"])
signal.signal(signal.SIGTERM,term)
pathlib.Path(inventory).write_text(json.dumps([dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgrp(),uid=os.getuid(),cwd=root,command="/Applications/Xcode.app/Contents/Developer/usr/bin/xctest "+root+"/PicseeKitPackageTests.xctest")]))
pathlib.Path(ready).touch()
while True: time.sleep(.05)
`, inventory, ready, transitioned, protectedBinary, dir], { detached: true, stdio: "ignore" });
  const done = new Promise((resolve) => child.on("exit", resolve));
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fs.existsSync(ready)).toBe(true);
    const sampler = path.join(dir, "sampler");
    fs.writeFileSync(sampler, "#!/bin/sh\necho '4 0 16'\n", { mode: 0o700 });
    fs.writeFileSync(path.join(dir, "state"), JSON.stringify({ memory: 1, cpu: 0, lastSnapshot: Date.now() / 1000 }));
    const status = await new Promise<number | null>((resolve, reject) => {
      const backstop = spawn("python3", [path.resolve("scripts/load-guard/backstop.py"), "--once"], {
        env: { ...process.env, MDPRO_GUARD_TEST: "1", MDPRO_LOAD_GUARD_TEST_ROOT: dir,
          MDPRO_LOAD_GUARD_PROCESSES: inventory, MDPRO_LOAD_GUARD_SAMPLER: sampler,
          MDPRO_LOAD_GUARD_STATE: path.join(dir, "state"), MDPRO_LOAD_GUARD_ACTIVE: path.join(dir, "active"),
          MDPRO_LOAD_GUARD_LOG: path.join(dir, "log"), MDPRO_LOAD_GUARD_KILL_GRACE_SECS: "0.4" }, stdio: "ignore",
      });
      backstop.on("error", reject);
      backstop.on("close", resolve);
    });
    expect(status).toBe(0);
    expect(fs.existsSync(transitioned)).toBe(true);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
    await done;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
