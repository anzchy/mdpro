/**
 * Purpose: The delivery proof for `launch --into <run> <file>` (ADR-0047
 * WI-003 WI-R3): a second process that exits 0 has only handed off; the file
 * reached the run when R's own app log says so.
 *
 * Pipeline: `deliveryNames(file)` → `{ file as given, realpath(file) }`;
 *   `awaitDelivery` polls `readFrom(appLog, offset)` / the clock →
 *   `findDelivery(text, names)` → `{ source }` | `null`.
 *
 * Key decisions:
 * - Only bytes appended after the offset taken just before the spawn count,
 *   so a delivery logged by an earlier `--into` never passes this one.
 * - A line counts only when it is complete (newline-terminated), parses as a
 *   JSON object, and has `event:"file.open.external"`, `status:"success"` and
 *   `context.filePath` equal to one of the names. Single-instance logs the
 *   canonical path (`launch_args.rs`); the open-documents (Finder / `open`)
 *   path logs the file URL's path unresolved (`main.rs`).
 * - `success` means the run received the file; on a cold start it may only
 *   be queued as pending. A late line from an earlier, timed-out `--into` of
 *   the same file that lands after this offset also counts: the log carries
 *   no id to tell the two apart.
 * - A missing or unreadable log, a malformed line, a partial trailing line,
 *   another file's line and a `status:"start"` line are all "not yet"; the
 *   poll never throws and ends at the deadline with `null`.
 * - Read-only: nothing here writes, spawns or signals.
 *
 * @module scripts/control/intoDelivery
 * @coordinates-with scripts/control/launchInto.mjs (the caller)
 * @coordinates-with scripts/control/runDir.mjs (layout().appLog)
 * @coordinates-with src-tauri/src/main.rs (the `file.open.external` log lines)
 * @coordinates-with src-tauri/src/launch_args.rs (single-instance path canonicalization)
 */
import fs from "node:fs";
import { POLL_MS } from "./launchCore.mjs";
import { readFrom } from "./launchProcess.mjs";

const EVENT = "file.open.external";
const SUCCESS = "success";
const UNKNOWN = "unknown";

/**
 * The paths a delivery line may name: the file as given, and its realpath
 * when that resolves and differs.
 * @param {string} file @returns {string[]}
 */
export function deliveryNames(file) {
  try {
    const real = fs.realpathSync(file);
    return real === file ? [file] : [file, real];
  } catch {
    return [file];
  }
}

/**
 * The first complete delivery line for one of `names` in `text`.
 * @param {string} text app-log bytes after the offset
 * @param {string[]} names
 * @returns {{ source: string } | null}
 */
export function findDelivery(text, names) {
  const lines = text.split("\n");
  lines.pop(); // the partial trailing line, or "" after the last newline
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const ctx = e !== null && typeof e === "object" ? e.context : undefined;
    if (e?.event !== EVENT || e.status !== SUCCESS || ctx === null || typeof ctx !== "object") continue;
    if (names.includes(ctx.filePath)) return { source: typeof ctx.source === "string" ? ctx.source : UNKNOWN };
  }
  return null;
}

/**
 * Poll R's app log until a delivery line appears or the deadline passes.
 * @param {any} d deps (`now`, `sleep`)
 * @param {{ appLog: string, offset: number, names: string[], start: number, timeoutMs: number }} input
 * @returns {Promise<{ source: string } | null>}
 */
export async function awaitDelivery(d, { appLog, offset, names, start, timeoutMs }) {
  for (;;) {
    const hit = findDelivery(readFrom(appLog, offset), names);
    if (hit) return hit;
    if (d.now() - start >= timeoutMs) return null;
    await d.sleep(POLL_MS);
  }
}
