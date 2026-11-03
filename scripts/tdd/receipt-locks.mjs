/**
 * Purpose: The receipt entry's locks, moved out of red-receipt.mjs (which sat at the
 * 300-line cap): the OS flock launcher that runs the entry holding `.unit-red-<id>.flock`,
 * the bounds it and the guardian call run under, the test barrier, the per-id
 * operation lock, and the guard on the engine's receipts.json view and its stamp (RC5-S5).
 *
 * Key decisions (fix 1, opus-auditor round one H1):
 * - The launcher is a supervisor, not an `execve`: python holds the flock and runs the
 *   entry in its own session, so a stop can reach everything the operation started.
 * - Its bound is derived from what it wraps, never a fixed 660 s: a replay gets three
 *   replay runs (install, base, head), each with heavy-lock's admission wait, plus 120 s; verify and discard get the
 *   guardian bound plus 60 s, the guardian bound being the longest lane timeout plus 60 s
 *   (at least 660 s). record gets two guardian bounds plus 60 s (R-g): it may wait on the
 *   store lock for one other record's whole engine call before its own.
 *   MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS overrides it, for tests; MDPRO_UNIT_RED_GUARDIAN_FLOOR_MS and
 *   MDPRO_UNIT_RED_BOUND_MARGIN_MS may only lower the floor and the margin (D357 ruling 1); the
 *   floor also lowers record's store-lock wait, which is one guardian bound.
 * - On the bound, SIGINT, SIGTERM or SIGHUP, the death of the calling entry (a SIGKILL
 *   it cannot forward), and whenever the operation has exited, the
 *   launcher sends the session's group SIGTERM, waits MDPRO_UNIT_RED_KILL_GRACE_MS
 *   (default 20 s, above heavy-lock.sh's own 10 s stop), then SIGKILL; then it removes
 *   the replay worktree the entry named in the flock file, if one is still there and its
 *   basename holds `-replay-`. The bound exits 64; a signal is re-raised, so the caller
 *   dies by the same signal.
 * - The launcher empties the flock file as soon as it holds the lock (fix 2, opus-auditor
 *   N5): a marker left by an earlier launcher that was itself SIGKILLed names a worktree
 *   this operation never added, so it is dropped, never acted on. That worktree is left
 *   for a person to remove.
 * - The view is the entry's alone (RC5-S5). record stamps it in `.receipts.view`
 *   ({sha256, phase, pid, token}): phase `engine` from the rebuild through the engine call,
 *   then `idle` with the bytes' sha256. A view with no stamp, or one whose bytes no longer
 *   match an idle stamp, is refused before any lane; an `engine` stamp whose pid is dead is
 *   a crashed call and is rebuilt over. A record of another id added, changed or deleted in
 *   the view during the engine call is a foreign change: the view is left as found, and only
 *   the stamp moves, to the bytes the entry would have written, so the next record refuses it.
 * - Test barriers (MDPRO_UNIT_RED_BARRIER_DIR) come in three modes: the older ones always pause
 *   until `<name>.go`; `pause` false only marks `<name>.ready`; the D357 kill points
 *   (record-view-written, record-rebuilt, record-item-temp, verify-item-temp,
 *   discard-between-removals) are "hold": they pause only when a test writes `<name>.hold`, so
 *   an unarmed one adds no wait (D357 ruling 1). With no barrier dir, none does anything.
 * @coordinates-with scripts/tdd/red-receipt.mjs (the only caller), scripts/tdd/replay-worktree.mjs (writes the worktree marker)
 * @coordinates-with tests/tooling/red-receipt-race.test.ts, tests/tooling/red-receipt-flock.test.ts, tests/tooling/adr0149e-launcher-bound.test.ts, tests/tooling/rc5-receipt-lifecycle.test.ts
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { TMP, VIEW, buildView, canonical } from "./receipt-store.mjs";
import { usageError } from "./unit-red-lane.mjs";
import { replaySpawnTimeoutMs } from "./replay-worktree.mjs";
const FLOCK_LAUNCH = `import fcntl, os, shutil, signal, subprocess, sys, time
fd = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600)
end = time.monotonic() + float(os.environ.get("MDPRO_UNIT_RED_FLOCK_WAIT_MS", "20000")) / 1000
while True:
 try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
 except BlockingIOError:
  if time.monotonic() >= end:
   sys.stderr.write("[red-receipt] OS receipt lock is still held.\\n"); sys.exit(64)
  time.sleep(.025)
os.ftruncate(fd, 0)
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
if marker and "-replay-" in os.path.basename(marker):
 subprocess.run(["git", "worktree", "remove", "--force", marker], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
 if os.path.isdir(marker): shutil.rmtree(marker, ignore_errors=True)
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
/** record's guardian calls under its launcher bound: its own, plus one other record's it may wait out on the store lock (R-g). */
const RECORD_GUARDIAN_CALLS = 2;
/** The longest `timeoutMs` among the receipt lanes (`unit-red`, `rust`) in the tdd-guardian config. */
export function laneTimeoutMs(cwd) {
  try {
    const lanes = JSON.parse(readFileSync(join(cwd, ".claude/tdd-guardian/config.json"), "utf8")).lanes ?? [];
    return Math.max(0, ...lanes.filter((lane) => lane.name === "unit-red" || lane.name === "rust").map((lane) => Number(lane.timeoutMs) || 0));
  } catch { return 0; }
}
/**
 * Test-only overrides, read here (D357 ruling 1): MDPRO_UNIT_RED_GUARDIAN_FLOOR_MS and MDPRO_UNIT_RED_BOUND_MARGIN_MS
 * can only lower the 660 s floor and the 60 s margin, so a lane test can reach the bounds in seconds. A value that is
 * not plain digits, is not positive, or is above the default is ignored, and the default applies.
 */
function lowered(value, fallback) {
  const ms = /^\d+$/.test(value ?? "") ? Number(value) : 0;
  return ms > 0 && ms <= fallback ? ms : fallback;
}
const boundMarginMs = (env) => lowered(env.MDPRO_UNIT_RED_BOUND_MARGIN_MS, BOUND_MARGIN_MS);
/** The guardian call's bound: above the lane's own timeout, never below the 660 s floor. */
export const guardianBoundMs = (laneTimeout, env = process.env) =>
  Math.max(lowered(env.MDPRO_UNIT_RED_GUARDIAN_FLOOR_MS, DEFAULT_GUARDIAN_BOUND_MS), laneTimeout + boundMarginMs(env));
/** The OS-lock launcher's bound for `action`, above every bound the operation runs under. */
export function launcherBoundMs(action, env, laneTimeout) {
  if (env.MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS) return Number(env.MDPRO_UNIT_RED_LAUNCH_TIMEOUT_MS);
  if (action === "replay") return 3 * replaySpawnTimeoutMs(env, true) + REPLAY_OVERHEAD_MS;
  if (action === "record") return RECORD_GUARDIAN_CALLS * guardianBoundMs(laneTimeout, env) + boundMarginMs(env);
  return guardianBoundMs(laneTimeout, env) + boundMarginMs(env);
}
/** How long record waits for the store lock: one other record's engine call. */
export const storeLockWaitMs = (cwd) => Number(process.env.MDPRO_RECEIPT_STORE_LOCK_WAIT_MS) || guardianBoundMs(laneTimeoutMs(cwd));
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
/** A test barrier: writes `<name>.ready`, then pauses until `<name>.go`; `pause` false never pauses, "hold" only when `<name>.hold` exists. */
export function barrier(name, pause = true) {
  const directory = process.env.MDPRO_UNIT_RED_BARRIER_DIR;
  if (!directory) return;
  writeFileSync(join(directory, `${name}.ready`), "ready");
  if (!pause || (pause === "hold" && !existsSync(join(directory, `${name}.hold`)))) return;
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

export const STAMP = ".claude/tdd-guardian/.receipts.view";
export const VIEW_REMEDY = "remove it after checking it holds no id master lacks";
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const stampToken = randomUUID();
function readText(path) {
  try { return readFileSync(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
function writeStamp(cwd, phase, sha) {
  const temp = join(cwd, TMP, `stamp-${process.pid}-${randomUUID()}.json`);
  mkdirSync(dirname(temp), { recursive: true });
  writeFileSync(temp, canonical({ sha256: sha, phase, pid: process.pid, token: stampToken }));
  renameSync(temp, join(cwd, STAMP));
}
/** The view's text, or null when there is none. */
export const viewText = (cwd) => readText(join(cwd, VIEW));
/** Refuse a view this entry did not leave (V1, ruling 1 opus M1(a)); a dead entry's engine-phase stamp is rebuilt over (L3′). */
export function checkView(cwd) {
  const view = viewText(cwd);
  if (view === null) return;
  const text = readText(join(cwd, STAMP));
  if (text === null) throw usageError(`${VIEW} has no stamp (${STAMP}), so this entry did not write it: ${VIEW_REMEDY}.`);
  let stamp;
  try { stamp = JSON.parse(text); } catch { throw usageError(`${STAMP} is unreadable, so ${VIEW} cannot be trusted: ${VIEW_REMEDY}, then remove the stamp.`); }
  if (stamp?.phase === "engine") {
    if (!alive(stamp.pid)) return;
    throw usageError(`${VIEW} is in another entry's engine call (pid ${stamp.pid}); nothing was written.`);
  }
  if (stamp?.phase !== "idle" || stamp.sha256 !== sha256(view)) throw usageError(`${VIEW} was changed outside the entry since its last record: ${VIEW_REMEDY}.`);
}
/** Each record of a view text by id, in canonical bytes; throws when the text is not a view. */
function recordsOf(text) {
  const records = new Map();
  for (const receipt of JSON.parse(text).receipts) records.set(receipt.id, canonical(receipt));
  return records;
}
/** Rebuild the view from `receipts` (id → receipt) through the engine's `update`, stamped `engine`; returns its records. */
export function rebuildView(cwd, receipts, update) {
  writeStamp(cwd, "engine", sha256(buildView(receipts)));
  barrier("record-view-written", "hold"); // D357 L5: a kill here leaves a dead `engine` stamp, rebuilt over
  update(cwd, () => JSON.parse(buildView(receipts)));
  return recordsOf(viewText(cwd));
}
/** Other records the engine call did not leave as they were (V3, V3b), as `<id> (added|changed|deleted)`. */
export function foreignChanges(before, afterText, id) {
  let after;
  try { after = recordsOf(afterText); } catch { return [`${VIEW} (unreadable)`]; }
  const changes = [];
  for (const [other, bytes] of after) {
    if (other === id) continue;
    if (!before.has(other)) changes.push(`${other} (added)`);
    else if (before.get(other) !== bytes) changes.push(`${other} (changed)`);
  }
  for (const other of before.keys()) if (other !== id && !after.has(other)) changes.push(`${other} (deleted)`);
  return changes.sort();
}
/** After the engine call: the view sorted from `receipts` and stamped idle; on a foreign change, only the stamp. */
export function settleView(cwd, receipts, update, foreign) {
  if (foreign.length) { writeStamp(cwd, "idle", sha256(buildView(receipts))); return; }
  update(cwd, () => JSON.parse(buildView(receipts)));
  barrier("record-rebuilt", "hold"); // D357 L5: the stamp is still `engine` until the line below
  writeStamp(cwd, "idle", sha256(viewText(cwd)));
}
