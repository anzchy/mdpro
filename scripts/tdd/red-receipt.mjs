/**
 * Purpose: The repo's receipt entry (ADR-0125, ADR-0145 as amended by ADR-0149): record,
 * verify and discard tdd-guardian RED receipts on the `unit-red` and `rust` lanes, check a
 * branch's receipts on every lane, and replay a broken one against the PR base.
 * Pipeline: parse → OS flock (receipt-locks) → per-id lock → action.
 * Key decisions: the plugin's receipts.json never gains a field; the entry's evidence
 * lives in the sidecar (receipt-evidence) and the pinned test tree (receipt-tree), written
 * only after the plugin's record succeeded (receipt-capture).
 * @coordinates-with scripts/tdd/unit-red-lane.mjs, scripts/cargo-test-lane.mjs, .claude/agents/mdpro-landing-verifier.md
 */
import { existsSync, fstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { usageError, validateFiles, validateId } from "./unit-red-lane.mjs";
const require = createRequire(import.meta.url);
const RECEIPTS = ".claude/tdd-guardian/receipts.json";
import { barrier, withOperationLock, withOsLock } from "./receipt-locks.mjs";
import { validateRustFiles, requireRustfmtClean } from "./receipt-rust.mjs";
import { capture, prepare } from "./receipt-capture.mjs";
import { entryFor, readEvidence, removeEntry, updateEntry, withEvidenceLock } from "./receipt-evidence.mjs";
import { replay } from "./receipt-replay.mjs";
const LANES = new Set(["unit-red", "rust"]);
const GENUINE = new Set(["assertion-failure", "opaque-failure"]);
const redOk = (lane, kind) => (lane === "unit-red" ? kind === "assertion-failure" : GENUINE.has(kind));
const pluginVersion = () => dirname(guardianPath()).split("/").at(-3);
const validateFor = (lane, cwd, files) => (lane === "rust" ? validateRustFiles(cwd, files) : validateFiles(cwd, files));
function guardianPath() {
  const cache = join(homedir(), ".claude/plugins/cache/xiaolai/tdd-guardian");
  const versions = readdirSync(cache).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const version = versions.find((name) => existsSync(join(cache, name, "scripts/tdd-guardian/receipt.js")));
  if (!version) throw usageError("The installed tdd-guardian receipt.js was not found.");
  return join(cache, version, "scripts/tdd-guardian/receipt.js");
}
function parse(argv) {
  const [action, ...tail] = argv;
  if (!["record", "verify", "discard", "check-pending", "replay"].includes(action)) throw usageError("Use record, verify, discard, check-pending or replay.");
  const args = { action, cwd: process.cwd(), tests: [] };
  const single = { "--id": "id", "--lane": "lane", "--base": "base", "--expect-digest": "expectDigest" };
  for (let index = 0; index < tail.length; index++) {
    const flag = tail[index];
    if (![...Object.keys(single), "--test", "--cwd"].includes(flag)) throw usageError(`Unknown option: ${flag}.`);
    const value = tail[++index];
    if (!value || value.startsWith("--")) throw usageError(`Missing value for ${flag}.`);
    if (flag === "--test") args.tests.push(value);
    else if (flag === "--cwd") {
      if (args.cwd !== process.cwd()) throw usageError("--cwd may appear only once.");
      args.cwd = resolve(value);
    } else {
      if (args[single[flag]] !== undefined) throw usageError(`${flag} may appear only once.`);
      args[single[flag]] = value;
    }
  }
  if (action !== "check-pending") validateId(args.id);
  else if (args.id || args.tests.length) throw usageError("check-pending takes no id or test selector.");
  if (["discard", "replay"].includes(action) && args.tests.length) throw usageError(`${action} takes no test selector.`);
  if (args.lane !== undefined && (!LANES.has(args.lane) || !["record", "verify", "discard"].includes(action))) throw usageError("--lane is unit-red or rust, for record, verify or discard.");
  if ((args.base !== undefined || args.expectDigest !== undefined) && action !== "replay") throw usageError("--base and --expect-digest are for replay.");
  args.cwd = resolve(args.cwd);
  if (action === "record") args.tests = validateFor(args.lane ?? "unit-red", args.cwd, args.tests);
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
  const logPointer = `${marker}.log`, reasonPointer = `${marker}.reason`;
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
    for (const [pointer, stream, label] of [[logPointer, process.stdout, "log: "], [reasonPointer, process.stderr, ""]]) if (existsSync(pointer)) stream.write(`[red-receipt] ${label}${readFileSync(pointer, "utf8")}\n`);
    return result;
  } finally {
    for (const pointer of [logPointer, reasonPointer]) if (existsSync(pointer)) unlinkSync(pointer);
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
function laneConfig(cwd, name) {
  const config = require(join(dirname(guardianPath()), "lib/config.js")).load(cwd);
  if (config.errors.length || !config.config) throw usageError("The tdd-guardian lane config is invalid.");
  const lane = config.config.lanes.find((item) => item.name === name);
  if (!lane) throw usageError(`The ${name} lane is missing.`);
  return lane;
}
function runGuardedVerification(cwd, env, name = "unit-red") {
  const lane = laneConfig(cwd, name);
  const lanes = require(join(dirname(guardianPath()), "lib/lanes.js"));
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
  const lane = args.lane ?? "unit-red";
  const before = currentStore(args.cwd);
  const master = masterReceipts(args.cwd);
  if (master.some((receipt) => receipt.id === args.id)) throw usageError("Receipt id is already on master.");
  const existing = find(before, args.id);
  if (existing?.verdict || existing?.red?.kind === "assertion-failure") {
    throw usageError("Receipt id already has valid or settled evidence.");
  }
  if (lane === "rust") requireRustfmtClean(args.cwd, args.tests);
  const prepared = prepare(args.cwd, args.id, args.tests);
  const started = Date.now();
  barrier("record-preflight");
  const pluginArgs = ["record", "--id", args.id, "--lane", lane, "--files", args.tests.join(",")];
  let status;
  try {
    status = lane === "unit-red"
      ? withSelection(args.cwd, args.tests, (env) => callGuardian(args.cwd, pluginArgs, { ...env, MDPRO_RED_EVIDENCE_DIR: prepared.dir }))
      : callGuardian(args.cwd, pluginArgs, { ...process.env, MDPRO_RED_EVIDENCE_DIR: prepared.dir });
  } catch (error) { rmSync(prepared.dir, { recursive: true, force: true }); throw error; }
  const receipt = find(currentStore(args.cwd), args.id);
  if (status !== 0 || !receipt || receipt.lane !== lane ||
      JSON.stringify(Object.keys(receipt.test_files)) !== JSON.stringify(args.tests) ||
      Date.parse(receipt.recorded_at) < started || !redOk(lane, receipt.red?.kind)) {
    rmSync(prepared.dir, { recursive: true, force: true });
    throw usageError(`Record refused: ${receipt?.red?.kind || "missing"} is not a counted RED for this selection. Use discard for stale evidence.`);
  }
  const failures = capture(args.cwd, { receipt, laneCommand: laneConfig(args.cwd, lane).command, pluginVersion: pluginVersion(), prepared, specFiles: args.tests });
  process.stdout.write(`Recorded ${args.id}: ${receipt.red.kind} in ${args.tests.join(", ")}; ${failures.length} failing id(s) in the evidence\n`);
}
function specBlobs(cwd, files) {
  return Object.fromEntries(files.map((file) => [file, git(cwd, ["hash-object", "--", file]).stdout.trim()]));
}
function verify(args) {
  const receipt = find(currentStore(args.cwd), args.id);
  const lane = args.lane ?? receipt?.lane;
  if (!receipt || !LANES.has(receipt.lane) || lane !== receipt.lane) throw usageError(`No ${args.lane ?? "unit-red or rust"} receipt has that id.`);
  if (receipt.verdict) throw usageError("Receipt is already settled.");
  if (!redOk(lane, receipt.red?.kind)) throw usageError(`RED kind ${receipt.red?.kind || "missing"} is not a counted RED; verify refused before plugin invocation.`);
  const files = validateFor(lane, args.cwd, Object.keys(receipt.test_files));
  if (args.tests.length && JSON.stringify(validateFor(lane, args.cwd, args.tests)) !== JSON.stringify(files)) {
    throw usageError("Verify selector differs from the recorded selection.");
  }
  const entry = entryFor(withEvidenceLock(args.cwd, () => readEvidence(args.cwd)), receipt, pluginVersion());
  const current = specBlobs(args.cwd, files);
  const changed = entry ? JSON.stringify(current) !== JSON.stringify(entry.spec_blobs) : false;
  const identity = JSON.stringify(receipt);
  barrier("verify-preflight");
  const result = lane === "unit-red" ? withSelection(args.cwd, files, (env) => runGuardedVerification(args.cwd, env), receipt) : runGuardedVerification(args.cwd, process.env, lane);
  if (!result.ok) throw usageError(`Verification lane is ${result.status}; receipt stays open.`);
  const verification = require(join(dirname(guardianPath()), "lib/verification.js"));
  const judged = verification.verifyAll({ schemaVersion: 2, receipts: [receipt] }, args.cwd, {
    greenLanes: new Set([lane]),
  }).store.receipts[0];
  verification.updateReceipts(args.cwd, (fresh) => {
    if (fresh.error || fresh.problems.length) throw usageError("Receipt store changed or is malformed.");
    const target = find(fresh.store, args.id);
    if (!target || JSON.stringify(target) !== identity) throw usageError("Receipt incarnation changed during verification.");
    return verification.upsertReceipt(fresh.store, judged);
  });
  if (entry) withEvidenceLock(args.cwd, () => updateEntry(args.cwd, args.id, changed ? { settled_blobs: current, evidence_required: true } : { settled_blobs: current }));
  const after = find(currentStore(args.cwd), args.id);
  if (!after || after.verdict !== "SEPARATION-HELD") {
    throw usageError(`Verification did not hold: ${after.verdict || "PENDING"}. Run red-receipt.mjs replay --id ${args.id} for the evidence.`);
  }
  if (changed) throw usageError(`${args.id}: the plugin says SEPARATION-HELD, but the spec bytes changed since RED (ADR-0145 d5); evidence required. Run red-receipt.mjs replay --id ${args.id}.`);
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
  if (!receipt || !LANES.has(receipt.lane) || (args.lane && args.lane !== receipt.lane) || receipt.verdict) throw usageError("Discard requires an unsettled branch unit-red or rust receipt.");
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
    if (!target || JSON.stringify(target) !== identity || target.verdict || target.lane !== receipt.lane) throw usageError("Receipt changed before discard.");
    if (target.red?.kind === "assertion-failure") {
      const now = verification.fingerprintFiles(Object.keys(target.test_files), args.cwd);
      const diff = verification.diffFingerprints(target.test_files, now);
      if (diff.modified.length || diff.removed.length || diff.unknown.length) throw usageError("Recorded test lines changed; discard refused.");
    }
    return { ...fresh.store, receipts: fresh.store.receipts.filter((item) => item.id !== args.id) };
  });
  // The pin ref stays for the 30-day sweep (brief: no ref is deleted by hand).
  withEvidenceLock(args.cwd, () => removeEntry(args.cwd, args.id));
  process.stdout.write(`Discarded ${args.id} (${receipt.lane}, unsettled).\n`);
}
function checkPending(args) {
  const master = new Set(masterReceipts(args.cwd).map((receipt) => receipt.id));
  const evidence = withEvidenceLock(args.cwd, () => readEvidence(args.cwd));
  const version = pluginVersion();
  const problems = [];
  for (const receipt of currentStore(args.cwd).receipts.filter((item) => !master.has(item.id))) {
    const reasons = [];
    if (!redOk(receipt.lane, receipt.red?.kind)) reasons.push(`RED kind ${receipt.red?.kind || "missing"}`);
    if (receipt.verdict !== "SEPARATION-HELD") reasons.push(`verdict ${receipt.verdict || "unsettled"}`);
    const entry = entryFor(evidence, receipt, version);
    if (!entry) reasons.push("no evidence");
    else if (entry.evidence_required) reasons.push("evidence required (spec bytes changed since RED)");
    else if (receipt.verdict === "SEPARATION-HELD") {
      const files = Object.keys(receipt.test_files);
      const now = Object.fromEntries(files.map((file) => [file, existsSync(join(args.cwd, file)) ? git(args.cwd, ["hash-object", "--", file]).stdout.trim() : null]));
      if (!entry.settled_blobs) reasons.push("not settled through the entry");
      else if (JSON.stringify(now) !== JSON.stringify(entry.settled_blobs)) reasons.push("spec changed after settlement");
    }
    if (reasons.length) problems.push(`${receipt.id} (${receipt.lane}): ${reasons.join("; ")}`);
  }
  if (problems.length) {
    process.stderr.write(`Branch receipts need review:\n${problems.map((line) => `  ${line}`).join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("No unsettled, invalid or unevidenced branch receipts.\n");
}
try {
  const args = parse(process.argv.slice(2));
  if (args.action !== "check-pending" && !process.env.MDPRO_UNIT_RED_FLOCK_FD) process.exitCode = withOsLock(args, fileURLToPath(import.meta.url));
  else if (args.action !== "check-pending" && fstatSync(Number(process.env.MDPRO_UNIT_RED_FLOCK_FD)).ino !== statSync(join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`)).ino) throw usageError("OS receipt lock descriptor is invalid.");
  else if (args.action === "record") withOperationLock(args.cwd, args.id, () => record(args));
  else if (args.action === "verify") withOperationLock(args.cwd, args.id, () => verify(args));
  else if (args.action === "discard") withOperationLock(args.cwd, args.id, () => discard(args));
  else if (args.action === "replay") withOperationLock(args.cwd, args.id, () => { process.exitCode = replay({ ...args, receipt: find(currentStore(args.cwd), args.id), pluginVersion: pluginVersion(), laneConfig: (name) => laneConfig(args.cwd, name) }); });
  else checkPending(args);
} catch (error) {
  process.stderr.write(`[red-receipt] ${error.message}\n`);
  process.exitCode = 64;
}
