/**
 * Purpose: The per-item receipt store (RC5; decision log 20261102-receipts-per-item-files).
 * Each receipt is `.claude/tdd-guardian/receipts/<ID>.json` and each evidence entry
 * `.claude/tdd-guardian/receipt-evidence/<ID>.json`, both `JSON.stringify(value, null, 2)` plus a
 * newline. The vendored engine still reads one `receipts.json`; that file is a gitignored view
 * the entry builds from these files (`buildView`), only for `record`.
 *
 * Key decisions:
 * - A filename is its id. The entry's id regex admits only safe names; this module adds the
 *   Windows device stems and the case-insensitive collisions a case-insensitive filesystem
 *   (APFS) would otherwise turn into a silent overwrite.
 * - The full load (`loadStore`, for record and check-pending) refuses anything it cannot read
 *   back exactly: bad JSON, a misnamed or non-canonical file, a record the engine's own
 *   validator would change, a stray file, orphan evidence. A one-id read (`readItem`, for
 *   verify, discard and replay) checks only its own file, and refuses a case variant.
 * - Writes go to `.claude/tdd-guardian/.tmp/` and are renamed in, so a killed write never
 *   leaves a temp name inside the item directories.
 * @coordinates-with scripts/tdd/red-receipt.mjs, scripts/tdd/receipt-evidence.mjs, scripts/tdd/vendor/tdd-guardian-0.10.2/lib/verification.js
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { usageError } from "./unit-red-lane.mjs";
import { loadEngine } from "./receipt-engine.mjs";

const BASE = ".claude/tdd-guardian";
export const RECEIPTS_DIR = `${BASE}/receipts`;
export const EVIDENCE_DIR = `${BASE}/receipt-evidence`;
/** The engine's store path: tracked before the migration, the generated view after it. */
export const VIEW = `${BASE}/receipts.json`;
/** The retired evidence sidecar, read only by `migrate`. */
export const LEGACY_EVIDENCE = `${BASE}/evidence.json`;
export const TMP = `${BASE}/.tmp`;
const DIRS = { receipt: RECEIPTS_DIR, evidence: EVIDENCE_DIR };
const LABEL = { receipt: "receipts/", evidence: "receipt-evidence/" };
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEVICE_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "vendor", "tdd-guardian-0.10.2");
let verification;
const engine = () => (verification ??= loadEngine(ENGINE).verification);

export const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function git(cwd, args, input) {
  return spawnSync("git", args, { cwd, encoding: "utf8", input, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
}

/** The id as a filename: the entry's regex, and no Windows device stem (the part before the first dot). */
export function checkId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw usageError("A valid --id is required: letters, digits, dot, dash or underscore, at most 64, not starting with a dot or dash.");
  if (DEVICE_STEM.test(id.split(".")[0])) throw usageError(`--id ${id} is a Windows device name; choose another id.`);
  return id;
}
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Why `value` is not a receipt the engine would keep byte for byte, or null. */
export function receiptProblem(value) {
  if (!isObject(value)) return "is malformed";
  const { receipts, problems } = engine().validateReceipts({ receipts: [value] });
  return problems.length || JSON.stringify(receipts[0]) !== JSON.stringify(value) ? "is malformed" : null;
}
export function evidenceProblem(value) {
  return isObject(value) && ["id", "lane", "recorded_at"].every((key) => typeof value[key] === "string") ? null : "is malformed";
}

/** Parse one item file's text, checking name, bytes and shape; throws a usage error naming the file. */
export function parseItem(kind, name, text) {
  const where = `${LABEL[kind]}${name}`, id = name.slice(0, -".json".length);
  let value;
  try { value = JSON.parse(text); } catch { throw usageError(`${where} is not valid JSON.`); }
  const problem = kind === "receipt" ? receiptProblem(value) : evidenceProblem(value);
  if (problem) throw usageError(`${where} ${problem}.`);
  if (value.id !== id) throw usageError(`${where}: id ${value.id} does not match file name ${id}.`);
  if (canonical(value) !== text) throw usageError(`${where} is not canonical (JSON.stringify(value, null, 2) plus a newline).`);
  return value;
}
function names(cwd, kind) {
  const dir = join(cwd, DIRS[kind]);
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Every pair of ids that are equal ignoring case. */
export function caseCollisions(ids) {
  const seen = new Map(), pairs = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    if (seen.has(key)) pairs.push([seen.get(key), id]); else seen.set(key, id);
  }
  return pairs;
}

/** Strict load of every receipt and evidence file. */
export function loadStore(cwd) {
  const out = {};
  for (const kind of ["receipt", "evidence"]) {
    const items = new Map();
    for (const name of names(cwd, kind)) {
      const path = join(cwd, DIRS[kind], name);
      if (!name.endsWith(".json") || !lstatSync(path).isFile()) throw usageError(`unexpected file in ${LABEL[kind]}: ${name}`);
      checkId(name.slice(0, -".json".length));
      const value = parseItem(kind, name, readFileSync(path, "utf8"));
      items.set(value.id, value);
    }
    const pairs = caseCollisions([...items.keys()]);
    if (pairs.length) throw usageError(`case-insensitive duplicate in ${LABEL[kind]}: ${pairs[0].join(", ")}`);
    out[kind] = items;
  }
  const orphan = [...out.evidence.keys()].find((id) => !out.receipt.has(id));
  if (orphan) throw usageError(`orphan evidence: ${orphan} has no receipt.`);
  return { receipts: out.receipt, evidence: out.evidence };
}

/** One id's item, or null when absent; a file differing only in case is refused. */
export function readItem(cwd, kind, id) {
  const all = names(cwd, kind), name = `${id}.json`;
  if (!all.includes(name)) {
    const variant = all.find((other) => other.toLowerCase() === name.toLowerCase());
    if (variant) throw usageError(`--id ${id} differs only in case from ${variant.slice(0, -".json".length)}; use the exact id.`);
    return null;
  }
  return parseItem(kind, name, readFileSync(join(cwd, DIRS[kind], name), "utf8"));
}

/** Write one item in canonical bytes, by a temp file under `.tmp/` renamed in. */
export function writeItem(cwd, kind, id, value, onTemp = () => {}) {
  const dir = join(cwd, DIRS[kind]), tmp = join(cwd, TMP);
  mkdirSync(dir, { recursive: true }); mkdirSync(tmp, { recursive: true });
  const temp = join(tmp, `${kind}-${process.pid}-${randomUUID()}.json`);
  writeFileSync(temp, canonical(value));
  onTemp();
  renameSync(temp, join(dir, `${id}.json`));
}
export function removeItem(cwd, kind, id) { rmSync(join(cwd, DIRS[kind], `${id}.json`), { force: true }); }

/** Ids on master: its item files, plus a legacy master's receipts.json during the transition. */
export function masterIds(cwd) {
  if (git(cwd, ["rev-parse", "--verify", "refs/heads/master^{commit}"]).status !== 0) throw usageError("master ref is missing; receipt ownership cannot be checked.");
  const listing = git(cwd, ["ls-tree", "-r", "--name-only", "master", "--", `${RECEIPTS_DIR}/`, VIEW]);
  if (listing.status !== 0) throw usageError("Cannot inspect master receipts.");
  const ids = new Set();
  for (const path of listing.stdout.split("\n").filter(Boolean)) {
    if (path === VIEW) {
      const shown = git(cwd, ["show", `master:${VIEW}`]);
      let legacy;
      try { legacy = JSON.parse(shown.stdout); } catch { throw usageError("Cannot read master receipts."); }
      if (shown.status !== 0 || !Array.isArray(legacy?.receipts)) throw usageError("Cannot read master receipts.");
      for (const receipt of legacy.receipts) ids.add(receipt.id);
    } else if (path.endsWith(".json") && dirname(path) === RECEIPTS_DIR) ids.add(path.slice(RECEIPTS_DIR.length + 1, -".json".length));
  }
  return ids;
}

/** A worktree or master receipt whose id equals `id` ignoring case but not exactly, or null. */
export function collision(cwd, id) {
  const ids = [...names(cwd, "receipt").map((name) => name.slice(0, -".json".length)), ...masterIds(cwd)];
  return ids.find((other) => other !== id && other.toLowerCase() === id.toLowerCase()) ?? null;
}

/** The engine view of `receipts` (a Map id → receipt): sorted by id, in the engine's own serialisation. */
export function buildView(receipts) {
  const ids = [...receipts.keys()].sort();
  return canonical({ schemaVersion: 2, receipts: ids.map((id) => receipts.get(id)) });
}
