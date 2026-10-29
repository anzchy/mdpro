/**
 * Purpose: The receipt entry's locks, moved out of red-receipt.mjs (which sat at the
 * 300-line cap): the OS flock launcher that runs the entry holding `.unit-red-<id>.flock`,
 * the bounds it and the guardian call run under, the test barrier, and the per-id
 * operation lock.
 *
 * Key decisions (fix 1, opus-auditor round one H1):
 * - The launcher is a supervisor, not an `execve`: python holds the flock and runs the
 *   entry in its own session, so a stop can reach everything the operation started.
 * - Its bound is derived from what it wraps, never a fixed 660 s: a replay gets three
 *   replay runs (install, base, head) plus 120 s; record, verify and discard get the
 *   guardian bound plus 60 s, the guardian bound being the longest lane timeout plus 60 s
 *   (at least 660 s). MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS overrides it, for tests.
 * - On the bound, SIGINT, SIGTERM or SIGHUP, the death of the calling entry (a SIGKILL
 *   it cannot forward), and whenever the operation has exited, the
 *   launcher sends the session's group SIGTERM, waits MDPRO_UNIT_RED_KILL_GRACE_MS
 *   (default 20 s, above heavy-lock.sh's own 10 s stop), then SIGKILL; then it removes
 *   the replay worktree the entry named in the flock file, if one is still there. The
 *   bound exits 64; a signal is re-raised, so the caller dies by the same signal.
 * @coordinates-with scripts/tdd/red-receipt.mjs (the only caller), scripts/tdd/replay-worktree.mjs (writes the worktree marker)
 * @coordinates-with tests/tooling/red-receipt-race.test.ts, tests/tooling/red-receipt-flock.test.ts, tests/tooling/adr0149e-launcher-bound.test.ts
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { usageError } from "./unit-red-lane.mjs";
import { replayRunTimeoutMs } from "./replay-worktree.mjs";
const FLOCK_LAUNCH = `import fcntl, os, shutil, signal, subprocess, sys, time
fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
end = time.monotonic() + float(os.environ.get("MDPRO_UNIT_RED_FLOCK_WAIT_MS", "20000")) / 1000
while True:
 try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
 except BlockingIOError:
  if time.monotonic() >= end:
   sys.stderr.write("[red-receipt] OS receipt lock is still held.\\n"); sys.exit(64)
  time.sleep(.025)
os.set_inheritable(fd, True)
caught = []
for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP): signal.signal(sig, lambda number, frame: caught.append(number))
bound_ms = int(os.environ["MDPRO_UNIT_RED_LAUNCH_BOUND_MS"])
grace = float(os.environ.get("MDPRO_UNIT_RED_KILL_GRACE_MS", "20000")) / 1000
env = dict(os.environ, MDPRO_UNIT_RED_FLOCK_FD=str(fd))
env.pop("MDPRO_UNIT_RED_LAUNCH_BOUND_MS")
child = subprocess.Popen(sys.argv[2:], env=env, pass_fds=(fd,), start_new_session=True)
deadline = time.monotonic() + bound_ms / 1000
caller = os.getppid()
while child.poll() is None and not caught and os.getppid() == caller and time.monotonic() < deadline: time.sleep(.05)
orphaned = os.getppid() != caller
at_bound = child.poll() is None and not caught and not orphaned
def alive():
 child.poll()
 try: os.killpg(child.pid, 0); return True
 except ProcessLookupError: return False
 except PermissionError: return True
def signal_group(number):
 try: os.killpg(child.pid, number)
 except (ProcessLookupError, PermissionError): pass
if alive():
 signal_group(signal.SIGTERM)
 stop = time.monotonic() + grace
 while alive() and time.monotonic() < stop: time.sleep(.05)
 signal_group(signal.SIGKILL)
 stop = time.monotonic() + 5
 while alive() and time.monotonic() < stop: time.sleep(.05)
os.lseek(fd, 0, os.SEEK_SET)
marker = os.read(fd, 65536).decode("utf8", "replace").strip()
if marker:
 subprocess.run(["git", "worktree", "remove", "--force", marker], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
 if os.path.isdir(marker) and "-replay-" in os.path.basename(marker): shutil.rmtree(marker, ignore_errors=True)
 os.ftruncate(fd, 0)
status = child.returncode
if caught:
 sys.stderr.write("[red-receipt] stopped by %s; the operation's process group was stopped and its replay worktree removed.\\n" % signal.Signals(caught[0]).name)
 signal.signal(caught[0], signal.SIG_DFL); os.kill(os.getpid(), caught[0])
if orphaned and status is not None and status < 0:
 sys.stderr.write("[red-receipt] stopped: its caller exited; the operation's process group was stopped.\\n"); sys.exit(64)
if at_bound:
 sys.stderr.write("[red-receipt] stopped at the launcher bound (%d ms); the operation's process group was stopped and its replay worktree removed.\\n" % bound_ms); sys.exit(64)
if status < 0: signal.signal(-status, signal.SIG_DFL); os.kill(os.getpid(), -status)
sys.exit(status)`;
const DEFAULT_GUARDIAN_BOUND_MS = 660_000;
const BOUND_MARGIN_MS = 60_000;
const REPLAY_OVERHEAD_MS = 120_000;
/** The longest `timeoutMs` among the receipt lanes (`unit-red`, `rust`) in the tdd-guardian config. */
export function laneTimeoutMs(cwd) {
  try {
    const lanes = JSON.parse(readFileSync(join(cwd, ".claude/tdd-guardian/config.json"), "utf8")).lanes ?? [];
    return Math.max(0, ...lanes.filter((lane) => lane.name === "unit-red" || lane.name === "rust").map((lane) => Number(lane.timeoutMs) || 0));
  } catch { return 0; }
}
/** The guardian call's bound: above the lane's own timeout, never below the old 660 s. */
export const guardianBoundMs = (laneTimeout) => Math.max(DEFAULT_GUARDIAN_BOUND_MS, laneTimeout + BOUND_MARGIN_MS);
/** The OS-lock launcher's bound for `action`, above every bound the operation runs under. */
export function launcherBoundMs(action, env, laneTimeout) {
  if (env.MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS) return Number(env.MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS);
  if (action === "replay") return 3 * replayRunTimeoutMs(env) + REPLAY_OVERHEAD_MS;
  return guardianBoundMs(laneTimeout) + BOUND_MARGIN_MS;
}
const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"];
/** Run this entry again under the OS flock, supervised; resolves to its exit status. */
export function withOsLock(args, entryFile) {
  const lock = join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`);
  mkdirSync(dirname(lock), { recursive: true });
  const bound = launcherBoundMs(args.action, process.env, laneTimeoutMs(args.cwd));
  return new Promise((resolve, reject) => {
    const launcher = spawn("python3", ["-c", FLOCK_LAUNCH, lock, process.execPath, entryFile, ...process.argv.slice(2)], {
      cwd: args.cwd, env: { ...process.env, MDPRO_UNIT_RED_LAUNCH_BOUND_MS: String(bound) }, stdio: "inherit", detached: true,
    });
    const forward = (signal) => { try { launcher.kill(signal); } catch {} };
    for (const signal of FORWARDED) process.on(signal, forward);
    const done = () => { for (const signal of FORWARDED) process.off(signal, forward); };
    launcher.once("error", () => { done(); reject(usageError("OS receipt lock launcher failed.")); });
    launcher.once("exit", (code, signal) => {
      done();
      if (signal) process.kill(process.pid, signal);
      else resolve(code ?? 64);
    });
  });
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
