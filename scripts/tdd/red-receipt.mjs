import { existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { usageError, validateFiles, validateId } from "./unit-red-lane.mjs";
const require = createRequire(import.meta.url);
const RECEIPTS = ".claude/tdd-guardian/receipts.json";
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
function withOsLock(args) {
  const lock = join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`);
  mkdirSync(dirname(lock), { recursive: true });
  const result = spawnSync("python3", ["-c", FLOCK_LAUNCH, lock, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { cwd: args.cwd, env: process.env, encoding: "utf8", timeout: 660_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal) throw usageError("OS receipt lock launcher failed.");
  return result.status ?? 64;
}
function barrier(name, pause = true) {
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
function withOperationLock(cwd, id, operation) {
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
function guardianPath() {
  const cache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
  const versions = readdirSync(cache).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const version = versions.find((name) => existsSync(join(cache, name, "scripts/tdd-guardian/receipt.js")));
  if (!version) throw usageError("The installed tdd-guardian receipt.js was not found.");
  return join(cache, version, "scripts/tdd-guardian/receipt.js");
}
function parse(argv) {
  const [action, ...tail] = argv;
  if (!["record", "verify", "discard", "check-pending"].includes(action)) throw usageError("Use record, verify, discard or check-pending.");
  const args = { action, cwd: process.cwd(), tests: [] };
  for (let index = 0; index < tail.length; index++) {
    const flag = tail[index];
    if (!["--id", "--test", "--cwd"].includes(flag)) throw usageError(`Unknown option: ${flag}.`);
    const value = tail[++index];
    if (!value || value.startsWith("--")) throw usageError(`Missing value for ${flag}.`);
    if (flag === "--test") args.tests.push(value);
    else if (flag === "--id") {
      if (args.id !== undefined) throw usageError("--id may appear only once.");
      args.id = value;
    } else {
      if (args.cwd !== process.cwd()) throw usageError("--cwd may appear only once.");
      args.cwd = resolve(value);
    }
  }
  if (action !== "check-pending") validateId(args.id);
  else if (args.id || args.tests.length) throw usageError("check-pending takes no id or test selector.");
  if (["discard"].includes(action) && args.tests.length) throw usageError("discard takes no test selector.");
  args.cwd = resolve(args.cwd);
  if (action === "record") args.tests = validateFiles(args.cwd, args.tests);
  return args;
}
function git(cwd, args) { return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024 * 1024 }); }
function masterReceipts(cwd) {
  if (git(cwd, ["rev-parse", "--verify", "refs/heads/master^{commit}"]).status !== 0) {
    throw usageError("master ref is missing; receipt ownership cannot be checked.");
  }
  const listing = git(cwd, ["ls-tree", "-r", "--name-only", "master", "--", RECEIPTS]);
  if (listing.status !== 0) throw usageError("Cannot inspect master receipts.");
  if (!listing.stdout.trim()) return [];
  const shown = git(cwd, ["show", `master:${RECEIPTS}`]);
  if (shown.status !== 0) throw usageError("Cannot read master receipts.");
  return parseStore(shown.stdout).receipts;
}
function parseStore(raw) {
  let store;
  try { store = JSON.parse(raw); }
  catch { throw usageError("receipts.json is not valid JSON."); }
  if (store?.schemaVersion !== 2 || !Array.isArray(store.receipts) ||
      store.receipts.some((receipt) => !receipt || typeof receipt.id !== "string" || !receipt.lane || !receipt.red || !receipt.test_files) ||
      new Set(store.receipts.map((receipt) => receipt.id)).size !== store.receipts.length) {
    throw usageError("receipts.json contains malformed or duplicate records.");
  }
  return store;
}
function currentStore(cwd) {
  const file = join(cwd, RECEIPTS);
  return existsSync(file) ? parseStore(readFileSync(file, "utf8")) : { schemaVersion: 2, receipts: [] };
}
function find(store, id) { return store.receipts.find((receipt) => receipt.id === id); }
function withSelection(cwd, files, callback, expectedReceipt = null) {
  const folder = mkdtempSync(join(tmpdir(), "mdpro-unit-red-marker-"));
  const marker = join(folder, "selection.json");
  const logPointer = `${marker}.log`;
  const nonce = randomUUID();
  const receipt = expectedReceipt ? {
    id: expectedReceipt.id,
    lane: expectedReceipt.lane,
    redKind: expectedReceipt.red?.kind,
    test_files: expectedReceipt.test_files,
  } : null;
  writeFileSync(marker, JSON.stringify({ nonce, files, receipt }), { mode: 0o600 });
  try {
    const result = callback({
      ...process.env,
      MDPRO_UNIT_RED_FILES: JSON.stringify(files),
      MDPRO_UNIT_RED_MARKER: marker,
      MDPRO_UNIT_RED_NONCE: nonce,
    });
    if (existsSync(logPointer)) process.stdout.write(`[red-receipt] log: ${readFileSync(logPointer, "utf8")}\n`);
    return result;
  } finally {
    if (existsSync(logPointer)) unlinkSync(logPointer);
    unlinkSync(marker);
    rmdirSync(folder);
  }
}
function callGuardian(cwd, args, env) {
  const result = spawnSync(process.execPath, [guardianPath(), ...args, "--cwd", cwd], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 660_000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe", Number(process.env.MDPRO_UNIT_RED_FLOCK_FD)],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal) throw usageError("tdd-guardian did not finish.");
  return result.status;
}
function runGuardedVerification(cwd, env) {
  const library = dirname(guardianPath());
  const config = require(join(library, "lib/config.js")).load(cwd);
  if (config.errors.length || !config.config) throw usageError("The unit-red lane config is invalid.");
  const lane = config.config.lanes.find((item) => item.name === "unit-red");
  if (!lane) throw usageError("The unit-red lane is missing.");
  const lanes = require(join(library, "lib/lanes.js"));
  const keys = ["MDPRO_UNIT_RED_FILES", "MDPRO_UNIT_RED_MARKER", "MDPRO_UNIT_RED_NONCE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = env[key];
    return lanes.runLane(lane, cwd);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
function record(args) {
  const before = currentStore(args.cwd);
  const master = masterReceipts(args.cwd);
  if (master.some((receipt) => receipt.id === args.id)) throw usageError("Receipt id is already on master.");
  const existing = find(before, args.id);
  if (existing?.verdict || existing?.red?.kind === "assertion-failure") {
    throw usageError("Receipt id already has valid or settled evidence.");
  }
  const started = Date.now();
  barrier("record-preflight");
  const status = withSelection(args.cwd, args.tests, (env) =>
    callGuardian(args.cwd, ["record", "--id", args.id, "--lane", "unit-red", "--files", args.tests.join(",")], env));
  const receipt = find(currentStore(args.cwd), args.id);
  if (status !== 0 || !receipt || receipt.lane !== "unit-red" ||
      JSON.stringify(Object.keys(receipt.test_files)) !== JSON.stringify(args.tests) ||
      Date.parse(receipt.recorded_at) < started || receipt.red?.kind !== "assertion-failure") {
    throw usageError(`Record refused: ${receipt?.red?.kind || "missing"} is not a counted assertion RED for this selection. Use discard for stale evidence.`);
  }
  process.stdout.write(`Recorded ${args.id}: assertion-failure in ${args.tests.join(", ")}\n`);
}
function verify(args) {
  const receipt = find(currentStore(args.cwd), args.id);
  if (!receipt || receipt.lane !== "unit-red") throw usageError("No unit-red receipt has that id.");
  if (receipt.verdict) throw usageError("Receipt is already settled.");
  if (receipt.red?.kind !== "assertion-failure") throw usageError(`RED kind ${receipt.red?.kind || "missing"} is not assertion-failure; verify refused before plugin invocation.`);
  const files = validateFiles(args.cwd, Object.keys(receipt.test_files));
  if (args.tests.length && JSON.stringify(validateFiles(args.cwd, args.tests)) !== JSON.stringify(files)) {
    throw usageError("Verify selector differs from the recorded selection.");
  }
  const identity = JSON.stringify(receipt);
  barrier("verify-preflight");
  const lane = withSelection(args.cwd, files, (env) => runGuardedVerification(args.cwd, env), receipt);
  if (!lane.ok) throw usageError(`Verification lane is ${lane.status}; receipt stays open.`);
  const verification = require(join(dirname(guardianPath()), "lib/verification.js"));
  const judged = verification.verifyAll({ schemaVersion: 2, receipts: [receipt] }, args.cwd, {
    greenLanes: new Set(["unit-red"]),
  }).store.receipts[0];
  verification.updateReceipts(args.cwd, (fresh) => {
    if (fresh.error || fresh.problems.length) throw usageError("Receipt store changed or is malformed.");
    const target = find(fresh.store, args.id);
    if (!target || JSON.stringify(target) !== identity) throw usageError("Receipt incarnation changed during verification.");
    return verification.upsertReceipt(fresh.store, judged);
  });
  const after = find(currentStore(args.cwd), args.id);
  if (!after || after.verdict !== "SEPARATION-HELD") {
    throw usageError(`Verification did not hold: ${after.verdict || "PENDING"}.`);
  }
  process.stdout.write(`${args.id}: SEPARATION-HELD\n`);
}
function discard(args) {
  const branch = git(args.cwd, ["branch", "--show-current"]);
  if (branch.status !== 0 || !branch.stdout.trim() || branch.stdout.trim() === "master") {
    throw usageError("Discard requires a current non-master branch.");
  }
  if (masterReceipts(args.cwd).some((receipt) => receipt.id === args.id)) throw usageError("Cannot discard a receipt inherited from master.");
  const verification = require(join(dirname(guardianPath()), "lib/verification.js"));
  const loaded = verification.loadReceipts(args.cwd);
  if (loaded.error || loaded.problems.length) throw usageError("Receipt store is malformed; discard refused.");
  const receipt = find(loaded.store, args.id);
  if (!receipt || receipt.lane !== "unit-red" || receipt.verdict) throw usageError("Discard requires an unsettled branch unit-red receipt.");
  if (receipt.red?.kind === "assertion-failure") {
    const now = verification.fingerprintFiles(Object.keys(receipt.test_files), args.cwd);
    const diff = verification.diffFingerprints(receipt.test_files, now);
    if (diff.modified.length || diff.removed.length || diff.unknown.length) {
      throw usageError("Recorded test lines changed; discard refused.");
    }
  }
  const identity = JSON.stringify(receipt);
  barrier("discard-preflight");
  barrier("discard-lock-entry", false);
  verification.updateReceipts(args.cwd, (fresh) => {
    if (fresh.error || fresh.problems.length) throw usageError("Receipt store changed or is malformed.");
    const target = find(fresh.store, args.id);
    if (!target || JSON.stringify(target) !== identity || target.verdict || target.lane !== "unit-red") throw usageError("Receipt changed before discard.");
    if (target.red?.kind === "assertion-failure") {
      const now = verification.fingerprintFiles(Object.keys(target.test_files), args.cwd);
      const diff = verification.diffFingerprints(target.test_files, now);
      if (diff.modified.length || diff.removed.length || diff.unknown.length) throw usageError("Recorded test lines changed; discard refused.");
    }
    return { ...fresh.store, receipts: fresh.store.receipts.filter((item) => item.id !== args.id) };
  });
  process.stdout.write(`Discarded ${args.id} (unit-red, unsettled).\n`);
}
function checkPending(args) {
  const master = new Set(masterReceipts(args.cwd).map((receipt) => receipt.id));
  const branch = currentStore(args.cwd).receipts.filter((receipt) => receipt.lane === "unit-red" && !master.has(receipt.id));
  const bad = branch.filter((receipt) => receipt.red?.kind !== "assertion-failure" || receipt.verdict !== "SEPARATION-HELD");
  if (bad.length) {
    process.stderr.write(`Branch unit-red receipts need review: ${bad.map((receipt) => receipt.id).join(", ")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("No unsettled or invalid branch unit-red receipts.\n");
}
try {
  const args = parse(process.argv.slice(2));
  if (args.action !== "check-pending" && !process.env.MDPRO_UNIT_RED_FLOCK_FD) process.exitCode = withOsLock(args);
  else if (args.action !== "check-pending" && fstatSync(Number(process.env.MDPRO_UNIT_RED_FLOCK_FD)).ino !== statSync(join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`)).ino) throw usageError("OS receipt lock descriptor is invalid.");
  else if (args.action === "record") withOperationLock(args.cwd, args.id, () => record(args));
  else if (args.action === "verify") withOperationLock(args.cwd, args.id, () => verify(args));
  else if (args.action === "discard") withOperationLock(args.cwd, args.id, () => discard(args));
  else checkPending(args);
} catch (error) {
  process.stderr.write(`[red-receipt] ${error.message}\n`);
  process.exitCode = error.code === 64 ? 64 : 64;
}
