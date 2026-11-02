/**
 * Purpose: The repo's receipt entry (ADR-0125, ADR-0145 as amended by ADR-0149): record,
 * verify and discard tdd-guardian RED receipts on the `unit-red` and `rust` lanes, check a
 * branch's receipts on every lane, and replay a broken one against the PR base.
 * Pipeline: parse → OS flock (receipt-locks) → per-id lock → action.
 * Key decisions: receipts and evidence are one file per id (receipt-store, RC5); the
 * engine's receipts.json is a gitignored view the entry builds from the item files, only
 * for record, and reads its own id back from. verify, discard and replay read and write
 * only their own id's files; record and check-pending load the whole store strictly. The
 * engine's receipt never gains a field; the entry's evidence lives in
 * `receipt-evidence/<ID>.json` and the pinned test tree (receipt-tree), written only after
 * the plugin's record succeeded (receipt-capture). The plugin is the vendored engine under
 * vendor/ (#566), never a plugin cache; its version stamps the evidence.
 * @coordinates-with scripts/tdd/unit-red-lane.mjs, scripts/cargo-test-lane.mjs, scripts/tdd/receipt-engine.mjs, .claude/agents/mdpro-landing-verifier.md
 */
import { existsSync, fstatSync, mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { usageError, validateFiles, validateId } from "./unit-red-lane.mjs";
import { VIEW, buildView, checkId, collision, loadStore, masterIds, readItem, removeItem, writeItem } from "./receipt-store.mjs";
import { barrier, guardianBoundMs, laneTimeoutMs, withOperationLock, withOsLock } from "./receipt-locks.mjs";
import { validateRustFiles, requireRustfmtClean } from "./receipt-rust.mjs";
import { capture, prepare } from "./receipt-capture.mjs";
import { entryFor, readEntry, removeEntry, updateEntry, withEvidenceLock } from "./receipt-evidence.mjs";
import { replay } from "./receipt-replay.mjs";
import { loadEngine } from "./receipt-engine.mjs";
const LANES = new Set(["unit-red", "rust"]);
const GENUINE = new Set(["assertion-failure", "opaque-failure"]);
const redOk = (lane, kind) => (lane === "unit-red" ? kind === "assertion-failure" : GENUINE.has(kind));
const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "vendor", "tdd-guardian-0.10.2");
const pluginVersion = () => ENGINE.split("tdd-guardian-").at(-1);
let modules;
const engine = (name) => (modules ??= loadEngine(ENGINE))[name];
const validateFor = (lane, cwd, files) => (lane === "rust" ? validateRustFiles(cwd, files) : validateFiles(cwd, files));
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
  if (action !== "check-pending") checkId(validateId(args.id));
  else if (args.id || args.tests.length) throw usageError("check-pending takes no id or test selector.");
  if (["discard", "replay"].includes(action) && args.tests.length) throw usageError(`${action} takes no test selector.`);
  if (args.lane !== undefined && (!LANES.has(args.lane) || !["record", "verify", "discard"].includes(action))) throw usageError("--lane is unit-red or rust, for record, verify or discard.");
  if ((args.base !== undefined || args.expectDigest !== undefined) && action !== "replay") throw usageError("--base and --expect-digest are for replay.");
  args.cwd = resolve(args.cwd);
  if (action === "record") args.tests = validateFor(args.lane ?? "unit-red", args.cwd, args.tests);
  return args;
}
function git(cwd, args) { return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024 * 1024 }); }
const readReceipt = (cwd, id) => readItem(cwd, "receipt", id);
/** The engine's view: every item receipt, sorted, written through the engine's own lock. */
function writeView(cwd, receipts) {
  engine("verification").updateReceipts(cwd, () => JSON.parse(buildView(receipts)));
}
/** This id's record as the engine left it in the view, or null. */
function viewRecord(cwd, id) {
  try { return JSON.parse(readFileSync(join(cwd, VIEW), "utf8")).receipts.find((receipt) => receipt.id === id) ?? null; }
  catch { return null; }
}
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
  const result = spawnSync(process.execPath, [join(ENGINE, "receipt.js"), ...args, "--cwd", cwd], {
    cwd,
    env,
    encoding: "utf8",
    timeout: guardianBoundMs(laneTimeoutMs(cwd)),
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe", Number(process.env.MDPRO_UNIT_RED_FLOCK_FD)],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.signal) throw usageError("tdd-guardian did not finish.");
  return result.status;
}
function laneConfig(cwd, name) {
  const config = engine("config").load(cwd);
  if (config.errors.length || !config.config) throw usageError("The tdd-guardian lane config is invalid.");
  const lane = config.config.lanes.find((item) => item.name === name);
  if (!lane) throw usageError(`The ${name} lane is missing.`);
  return lane;
}
function runGuardedVerification(cwd, env, name = "unit-red") {
  const lane = laneConfig(cwd, name);
  const lanes = engine("lanes");
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
  const { receipts } = loadStore(args.cwd);
  const variant = collision(args.cwd, args.id);
  if (variant) throw usageError(`--id ${args.id} differs only in case from ${variant}; file names would collide.`);
  if (masterIds(args.cwd).has(args.id)) throw usageError("Receipt id is already on master.");
  const existing = receipts.get(args.id);
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
    writeView(args.cwd, receipts);
    status = lane === "unit-red"
      ? withSelection(args.cwd, args.tests, (env) => callGuardian(args.cwd, pluginArgs, { ...env, MDPRO_RED_EVIDENCE_DIR: prepared.dir }))
      : callGuardian(args.cwd, pluginArgs, { ...process.env, MDPRO_RED_EVIDENCE_DIR: prepared.dir });
  } catch (error) { rmSync(prepared.dir, { recursive: true, force: true }); throw error; }
  // Write back on every engine return: a refused RED stays visible and discardable (R-a).
  const receipt = viewRecord(args.cwd, args.id);
  if (receipt) writeItem(args.cwd, "receipt", args.id, receipt);
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
  const receipt = readReceipt(args.cwd, args.id);
  const lane = args.lane ?? receipt?.lane;
  if (!receipt || !LANES.has(receipt.lane) || lane !== receipt.lane) throw usageError(`No ${args.lane ?? "unit-red or rust"} receipt has that id.`);
  if (receipt.verdict) throw usageError("Receipt is already settled.");
  if (!redOk(lane, receipt.red?.kind)) throw usageError(`RED kind ${receipt.red?.kind || "missing"} is not a counted RED; verify refused before plugin invocation.`);
  const files = validateFor(lane, args.cwd, Object.keys(receipt.test_files));
  if (args.tests.length && JSON.stringify(validateFor(lane, args.cwd, args.tests)) !== JSON.stringify(files)) {
    throw usageError("Verify selector differs from the recorded selection.");
  }
  const entry = entryFor(withEvidenceLock(args.cwd, () => readEntry(args.cwd, args.id)), receipt, pluginVersion());
  const current = specBlobs(args.cwd, files);
  const changed = entry ? JSON.stringify(current) !== JSON.stringify(entry.spec_blobs) : false;
  const identity = JSON.stringify(receipt);
  barrier("verify-preflight");
  const result = lane === "unit-red" ? withSelection(args.cwd, files, (env) => runGuardedVerification(args.cwd, env), receipt) : runGuardedVerification(args.cwd, process.env, lane);
  if (!result.ok) throw usageError(`Verification lane is ${result.status}; receipt stays open.`);
  const verification = engine("verification");
  const judged = verification.verifyAll({ schemaVersion: 2, receipts: [receipt] }, args.cwd, {
    greenLanes: new Set([lane]),
  }).store.receipts[0];
  const target = readReceipt(args.cwd, args.id);
  if (!target || JSON.stringify(target) !== identity) throw usageError("Receipt incarnation changed during verification.");
  writeItem(args.cwd, "receipt", args.id, judged);
  if (entry) withEvidenceLock(args.cwd, () => updateEntry(args.cwd, args.id, changed ? { settled_blobs: current, evidence_required: true } : { settled_blobs: current }));
  const after = readReceipt(args.cwd, args.id);
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
  if (masterIds(args.cwd).has(args.id)) throw usageError("Cannot discard a receipt inherited from master.");
  const verification = engine("verification");
  const receipt = readReceipt(args.cwd, args.id);
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
  const target = readReceipt(args.cwd, args.id);
  if (!target || JSON.stringify(target) !== identity || target.verdict || target.lane !== receipt.lane) throw usageError("Receipt changed before discard.");
  if (target.red?.kind === "assertion-failure") {
    const now = verification.fingerprintFiles(Object.keys(target.test_files), args.cwd);
    const diff = verification.diffFingerprints(target.test_files, now);
    if (diff.modified.length || diff.removed.length || diff.unknown.length) throw usageError("Recorded test lines changed; discard refused.");
  }
  // Evidence first, so a stop between the two never leaves evidence without its receipt.
  // The pin ref stays for the 30-day sweep (brief: no ref is deleted by hand).
  withEvidenceLock(args.cwd, () => removeEntry(args.cwd, args.id));
  removeItem(args.cwd, "receipt", args.id);
  process.stdout.write(`Discarded ${args.id} (${receipt.lane}, unsettled).\n`);
}
function checkPending(args) {
  const master = masterIds(args.cwd);
  const { receipts, evidence } = withEvidenceLock(args.cwd, () => loadStore(args.cwd));
  const problems = [];
  for (const receipt of [...receipts.values()].filter((item) => !master.has(item.id))) {
    const reasons = [];
    if (!redOk(receipt.lane, receipt.red?.kind)) reasons.push(`RED kind ${receipt.red?.kind || "missing"}`);
    if (receipt.verdict !== "SEPARATION-HELD") reasons.push(`verdict ${receipt.verdict || "unsettled"}`);
    const entry = entryFor(evidence.get(receipt.id) ?? null, receipt, pluginVersion());
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
  engine("config"); // fail closed before any lock or lane when the vendored engine is incomplete
  if (args.action !== "check-pending" && !process.env.MDPRO_UNIT_RED_FLOCK_FD) process.exitCode = await withOsLock(args, fileURLToPath(import.meta.url));
  else if (args.action !== "check-pending" && fstatSync(Number(process.env.MDPRO_UNIT_RED_FLOCK_FD)).ino !== statSync(join(args.cwd, ".claude/tdd-guardian", `.unit-red-${args.id}.flock`)).ino) throw usageError("OS receipt lock descriptor is invalid.");
  else if (args.action === "record") withOperationLock(args.cwd, args.id, () => record(args));
  else if (args.action === "verify") withOperationLock(args.cwd, args.id, () => verify(args));
  else if (args.action === "discard") withOperationLock(args.cwd, args.id, () => discard(args));
  else if (args.action === "replay") withOperationLock(args.cwd, args.id, () => { process.exitCode = replay({ ...args, receipt: readReceipt(args.cwd, args.id), pluginVersion: pluginVersion(), laneConfig: (name) => laneConfig(args.cwd, name) }); });
  else checkPending(args);
} catch (error) {
  process.stderr.write(`[red-receipt] ${error.message}\n`);
  process.exitCode = 64;
}
