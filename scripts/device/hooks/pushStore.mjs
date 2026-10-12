/**
 * Purpose: The files of the dtrack hook push pipeline (D177-WI-2): the `seq`
 * counter with its epoch, spool.jsonl, dead.jsonl, orphan.jsonl and
 * push.log. Callers hold the right lock; nothing here locks.
 *
 * Pipeline: `readSeqState` (missing → new epoch at 0; corrupt → renamed to
 *   `seq.corrupt-<timestamp>`, logged "seq state corrupt", new epoch at 0)
 *   → `writeSeqState` (tmp + rename) | `readSpool` / `writeSpool` /
 *   `appendJsonl` | `deadCount(epoch)` | `orphanCount` | `logLine`.
 *
 * Key decisions:
 * - A stored seq must be a safe integer below `MAX_SEQ`
 *   (`Number.MAX_SAFE_INTEGER - 1`; D177-H-3, audit b92 finding 6): past
 *   2^53 `seq + 1` stops changing and seqs would repeat. At or past it the
 *   file takes the corrupt path, so the natural rollover is a new epoch at
 *   seq 1 (logged "seq state corrupt"); at one hook a second that is about
 *   285 million years away.
 * - Every file is created mode 0600; rewrites go through a tmp file and a
 *   rename, so a reader never sees half a spool.
 * - An unparsable spool line is kept out of the replay: `readSpool` returns
 *   it separately and the caller dead-letters it as "malformed".
 * - push.log takes plain strings from the callers, who pass statuses, seqs
 *   and error names only, never a body, a header or the token.
 *
 * @module scripts/device/hooks/pushStore
 * @coordinates-with scripts/device/hooks/pushCore.mjs
 */
import crypto from "node:crypto";

export const EPOCH_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** A stored seq at or past this is corrupt (D177-H-3): the next one could no longer be exact. */
export const MAX_SEQ = Number.MAX_SAFE_INTEGER - 1;
const FILE_MODE = 0o600;

export const newEpoch = () => crypto.randomBytes(12).toString("base64url");

function readText(fs, file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

export function logLine(ctx, paths, msg) {
  try {
    ctx.fs.appendFileSync(paths.log, `${ctx.now().toISOString()} ${msg}\n`, { mode: FILE_MODE });
  } catch {
    /* logging must never fail the hook */
  }
}

function writeWhole(fs, file, text) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, text, { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

function validSeqState(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof v.epoch === "string" &&
    EPOCH_RE.test(v.epoch) &&
    Number.isSafeInteger(v.seq) &&
    v.seq >= 0 &&
    v.seq < MAX_SEQ
  );
}

/** `{ epoch, seq }` of the last seq handed out; a missing or corrupt file starts a new epoch at 0. */
export function readSeqState(ctx, paths) {
  const text = readText(ctx.fs, paths.seq);
  if (text === null) return { epoch: newEpoch(), seq: 0 };
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (validSeqState(parsed)) return { epoch: parsed.epoch, seq: parsed.seq };
  const stamp = ctx.now().toISOString().replace(/[:.]/g, "");
  let aside = `${paths.seq}.corrupt-${stamp}`;
  if (ctx.fs.existsSync(aside)) aside += `-${crypto.randomBytes(3).toString("hex")}`;
  ctx.fs.renameSync(paths.seq, aside);
  logLine(ctx, paths, `seq state corrupt; moved aside, new epoch`);
  return { epoch: newEpoch(), seq: 0 };
}

export function writeSeqState(ctx, paths, state) {
  writeWhole(ctx.fs, paths.seq, JSON.stringify({ epoch: state.epoch, seq: state.seq }) + "\n");
}

/** Spool entries in file (append) order, plus any lines that do not parse to an object. */
export function readSpool(ctx, paths) {
  const text = readText(ctx.fs, paths.spool) ?? "";
  const entries = [];
  const malformed = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object" && !Array.isArray(v)) entries.push(v);
      else malformed.push(line);
    } catch {
      malformed.push(line);
    }
  }
  return { entries, malformed };
}

export function writeSpool(ctx, paths, entries) {
  writeWhole(ctx.fs, paths.spool, entries.map((e) => JSON.stringify(e) + "\n").join(""));
}

export function appendJsonl(ctx, file, value) {
  ctx.fs.appendFileSync(file, JSON.stringify(value) + "\n", { mode: FILE_MODE });
}

/** Number of dead.jsonl lines (any reason) whose entry belongs to `epoch`. */
export function deadCount(ctx, paths, epoch) {
  const text = readText(ctx.fs, paths.dead) ?? "";
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      if (JSON.parse(line)?.entry?.spool_epoch === epoch) n++;
    } catch {
      /* a torn dead line counts for nothing */
    }
  }
  return n;
}

/** Number of non-empty lines in orphan.jsonl (all epochs: an orphan has none); 0 when absent. */
export function orphanCount(ctx, paths) {
  const text = readText(ctx.fs, paths.orphan) ?? "";
  return text.split("\n").filter((l) => l.trim() !== "").length;
}

/** Reads push.json and the token; null when either is unusable. */
export function readConfig(ctx, paths, sourceRe) {
  try {
    const cfg = JSON.parse(ctx.fs.readFileSync(paths.config, "utf8"));
    const token = ctx.fs.readFileSync(paths.token, "utf8").trim();
    if (typeof cfg?.url !== "string" || !/^https?:\/\//.test(cfg.url)) return null;
    if (typeof cfg.source !== "string" || !sourceRe.test(cfg.source) || token === "") return null;
    return { url: cfg.url, source: cfg.source, token };
  } catch {
    return null;
  }
}
