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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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


/** Resolve `rev` to a commit; a usage error naming it otherwise. */
function commitOf(cwd, rev) {
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (result.status !== 0) throw usageError(`Cannot resolve revision ${rev}.`);
  return result.stdout.trim();
}
/** The receipt paths in `rev`'s tree, read with their blob contents in one `cat-file --batch`. */
function snapshot(cwd, rev) {
  const listing = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", rev, "--", `${BASE}/`], { cwd, maxBuffer: 64 * 1024 * 1024 });
  if (listing.status !== 0) throw usageError(`Cannot list the tree of ${rev}.`);
  const rows = listing.stdout.toString("utf8").split("\0").filter(Boolean).map((row) => {
    const [meta, path] = row.split("\t"), [mode, type, blob] = meta.split(" ");
    return { mode, type, blob, path };
  }).filter((row) => row.path === VIEW || row.path === LEGACY_EVIDENCE || row.path.startsWith(`${RECEIPTS_DIR}/`) || row.path.startsWith(`${EVIDENCE_DIR}/`));
  const wanted = rows.filter((row) => row.type === "blob");
  const batch = spawnSync("git", ["cat-file", "--batch"], { cwd, input: wanted.map((row) => `${row.blob}\n`).join(""), maxBuffer: 512 * 1024 * 1024 });
  if (batch.status !== 0) throw usageError(`Cannot read the receipt blobs of ${rev}.`);
  let at = 0;
  for (const row of wanted) {
    const end = batch.stdout.indexOf(10, at), size = Number(batch.stdout.subarray(at, end).toString().split(" ")[2]);
    row.text = batch.stdout.subarray(end + 1, end + 1 + size).toString("utf8");
    at = end + 2 + size;
  }
  const byPath = new Map(rows.map((row) => [row.path, row]));
  return { rows, byPath, legacy: byPath.has(VIEW) || byPath.has(LEGACY_EVIDENCE), items: rows.some((row) => row.path !== VIEW && row.path !== LEGACY_EVIDENCE) };
}
function legacyStore(side, where) {
  const parse = (path, empty) => { const row = side.byPath.get(path); if (!row) return empty; try { return JSON.parse(row.text); } catch { throw usageError(`${path} at ${where} is not valid JSON.`); } };
  const receipts = parse(VIEW, { receipts: [] }).receipts, entries = parse(LEGACY_EVIDENCE, { entries: {} }).entries;
  if (!Array.isArray(receipts) || !isObject(entries)) throw usageError(`The legacy store at ${where} is malformed.`);
  return { receipts: new Map(receipts.map((receipt) => [receipt.id, canonical(receipt)])), evidence: new Map(Object.entries(entries).map(([id, value]) => [id, canonical(value)])) };
}
/** The head's item files, as id → text, with a problem line for each that is not a well-formed item. */
function headItems(head, lines) {
  const out = { receipt: new Map(), evidence: new Map() };
  for (const row of head.rows) {
    if (row.path === VIEW || row.path === LEGACY_EVIDENCE) continue;
    const kind = row.path.startsWith(`${RECEIPTS_DIR}/`) ? "receipt" : "evidence", prefix = kind === "receipt" ? "" : "evidence ";
    const name = row.path.slice(DIRS[kind].length + 1), id = name.slice(0, -".json".length);
    if (name.includes("/") || row.type !== "blob" || row.mode === "120000") { lines.push(`unexpected path: ${row.path}`); continue; }
    try { if (!name.endsWith(".json")) throw usageError("name"); checkId(id); } catch { lines.push(`${prefix}misnamed: ${name}`); continue; }
    out[kind].set(id, row.text);
    let value;
    try { value = JSON.parse(row.text); } catch { lines.push(`${prefix}malformed: ${id}`); continue; }
    if ((kind === "receipt" ? receiptProblem(value) : evidenceProblem(value))) lines.push(`${prefix}malformed: ${id}`);
    else if (value.id !== id) lines.push(`${prefix}misnamed: ${name}`);
    else if (canonical(value) !== row.text) lines.push(`${prefix}non-canonical: ${id}`);
  }
  for (const pair of caseCollisions([...out.receipt.keys()])) lines.push(`case-insensitive duplicate: ${pair.join(", ")}`);
  for (const id of out.evidence.keys()) if (!out.receipt.has(id)) lines.push(`orphan evidence: ${id}`);
  return out;
}

/**
 * The verifier's check that `head` keeps every receipt and evidence record of `parent`
 * (RC5 AC-5), reading both trees only. A parent on the item layout is compared by blob; a
 * legacy parent record by its canonical bytes, against the head's item file or, when both
 * sides are legacy (R-c), the head's record. A tracked legacy store at the head fails unless
 * both sides are legacy and the head tracks no item file (R-f).
 */
export function keepCheck(cwd, parentRev, headRev) {
  const parent = snapshot(cwd, commitOf(cwd, parentRev)), head = snapshot(cwd, commitOf(cwd, headRev));
  const lines = [], legacyToLegacy = parent.legacy && head.legacy && !head.items;
  if (head.legacy && !legacyToLegacy) lines.push("legacy store tracked at head");
  const items = legacyToLegacy ? legacyStore(head, headRev) : headItems(head, lines);
  const headText = { receipt: legacyToLegacy ? items.receipts : items.receipt, evidence: items.evidence };
  const expected = { receipt: new Map(), evidence: new Map() };
  for (const row of parent.rows) {
    if (row.path === VIEW || row.path === LEGACY_EVIDENCE) continue;
    const kind = row.path.startsWith(`${RECEIPTS_DIR}/`) ? "receipt" : "evidence";
    expected[kind].set(row.path.slice(DIRS[kind].length + 1).replace(/\.json$/, ""), row.text);
  }
  if (parent.legacy) {
    const old = legacyStore(parent, parentRev);
    for (const [id, text] of old.receipts) expected.receipt.set(id, text);
    for (const [id, text] of old.evidence) expected.evidence.set(id, text);
  }
  let kept = 0;
  for (const kind of ["receipt", "evidence"]) {
    const prefix = kind === "receipt" ? "" : "evidence ";
    for (const [id, text] of expected[kind]) {
      const now = headText[kind].get(id);
      if (now === undefined) lines.push(`${prefix}deleted: ${id}`);
      else if (now !== text) lines.push(`${prefix}changed: ${id}`);
      else if (kind === "receipt") kept++;
    }
  }
  const added = [...headText.receipt.keys()].filter((id) => !expected.receipt.has(id)).length;
  return { lines, kept, total: expected.receipt.size, added };
}

function cli(argv) {
  const [action, ...tail] = argv, args = {};
  for (let index = 0; index < tail.length; index += 2) {
    if (!["--parent", "--head", "--import"].includes(tail[index]) || !tail[index + 1] || tail[index + 1].startsWith("--")) throw usageError(`Unknown option or missing value: ${tail[index]}.`);
    args[tail[index].slice(2)] = tail[index + 1];
  }
  if (action === "keep-check") {
    if (!args.parent || !args.head) throw usageError("keep-check needs --parent <rev> and --head <rev>.");
    const result = keepCheck(process.cwd(), args.parent, args.head);
    process.stdout.write(`${result.lines.map((line) => `${line}\n`).join("")}kept ${result.kept} of ${result.total}; added ${result.added}\n`);
    return result.lines.length ? 1 : 0;
  }
  throw usageError("Use keep-check --parent <rev> --head <rev>.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`[receipt-store] ${error.message}\n`); process.exitCode = 64; }
}
