/**
 * Purpose: The receipt entry's locks, moved out of red-receipt.mjs (which sat at the
 * 300-line cap) without behaviour change: the OS flock launcher that re-executes the
 * entry holding `.unit-red-<id>.flock`, the test barrier, and the per-id operation lock.
 * @coordinates-with scripts/tdd/red-receipt.mjs (the only caller)
 * @coordinates-with tests/tooling/red-receipt-race.test.ts, tests/tooling/red-receipt-flock.test.ts
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { usageError } from "./unit-red-lane.mjs";
const FLOCK_LAUNCH = `import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
end = time.monotonic() + float(os.environ.get("MDPRO_UNIT_RED_FLOCK_WAIT_MS", "20000")) / 1000
while True:
 try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
 except BlockingIOError:
  if time.monotonic() >= end:
   sys.stderr.write("[red-receipt] OS receipt lock is still held.\\n"); sys.exit(64)
  time.sleep(.025)
os.set_inheritable(fd, True)
env = dict(os.environ, MDPRO_UNIT_RED_FLOCK_FD=str(fd))
os.execve(sys.argv[2], [sys.argv[2], sys.argv[3], *sys.argv[4:]], env)`;
export function withOsLock(args, entryFile) {
  const lock = join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`);
  mkdirSync(dirname(lock), { recursive: true });
  const result = spawnSync("python3", ["-c", FLOCK_LAUNCH, lock, process.execPath, entryFile, ...process.argv.slice(2)], { cwd: args.cwd, env: process.env, encoding: "utf8", timeout: 660_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal) throw usageError("OS receipt lock launcher failed.");
  return result.status ?? 64;
}
export function barrier(name, pause = true) {
  const directory = process.env.MDPRO_UNIT_RED_BARRIER_DIR;
  if (!directory) return;
  writeFileSync(join(directory, `${name}.ready`), "ready");
  if (!pause) return;
  const release = join(directory, `${name}.go`), deadline = Date.now() + 10_000;
  while (!existsSync(release)) {
    if (Date.now() > deadline) throw usageError(`Barrier ${name} timed out.`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
export function withOperationLock(cwd, id, operation) {
  const lock = join(cwd, ".claude/tdd-guardian", `.unit-red-${id}.lock`), owner = join(lock, "owner.json");
  const deadline = Date.now() + Number(process.env.MDPRO_UNIT_RED_LOCK_WAIT_MS || 20_000), token = randomUUID();
  for (;;) {
    try {
      mkdirSync(lock); writeFileSync(owner, JSON.stringify({ pid: process.pid, token }), { mode: 0o600 }); break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      barrier("operation-wait", false);
      let stale = false, observedOwner = null, observedInode = null;
      try {
        const stat = statSync(lock), age = Date.now() - stat.mtimeMs;
        observedInode = stat.ino;
        if (age > 1000) {
          try { observedOwner = readFileSync(owner, "utf8"); process.kill(JSON.parse(observedOwner).pid, 0); }
          catch (ownerError) { stale = ownerError.code === "ENOENT" || ownerError.code === "ESRCH" || ownerError instanceof SyntaxError; }
        }
      } catch {}
      if (stale) {
        barrier("stale-observed");
        try {
          const sameInode = statSync(lock).ino === observedInode, sameOwner = observedOwner === null ? !existsSync(owner) : readFileSync(owner, "utf8") === observedOwner;
          if (sameInode && sameOwner) { if (existsSync(owner)) unlinkSync(owner); rmdirSync(lock); }
        } catch {}
        barrier("stale-reap-done", false); continue;
      }
      if (Date.now() > deadline) throw usageError("Same-id receipt operation is still locked.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return operation(); }
  finally { try { if (JSON.parse(readFileSync(owner, "utf8")).token === token) { unlinkSync(owner); rmdirSync(lock); } } catch {} }
}
