/**
 * Purpose: The launcher's own JSONL log, `<RUN>/launcher.jsonl` (ADR-0047
 * WI-003; the WI-9 module, landed early with only what `launch` needs).
 *
 * Pipeline: `appendLog(file, { event, ...fields }, { secrets })` →
 *   `JSON.stringify` → `redact` → one appended line (file mode 0600).
 *
 * Key decisions:
 * - The caller passes the path from `layout(...).launcherLog`; this module
 *   never derives a location. No `os.homedir()`, `os.tmpdir()` or cwd
 *   fallback: with no run dir there is nothing to append to, and the append
 *   fails with ENOENT, which is swallowed (stdout still carries the verdict).
 * - Only the file is created, never a directory.
 * - Every `event` starts with `launcher.`; anything else is a caller bug and
 *   is not written.
 * - Logging never throws: a log failure must not change a launch outcome.
 *
 * @module scripts/control/launcherLog
 * @coordinates-with scripts/control/launcherFormat.mjs (redact)
 * @coordinates-with scripts/control/runDir.mjs (layout().launcherLog)
 */
import fs from "node:fs";
import { redact } from "./launcherFormat.mjs";

const FILE_MODE = 0o600;
const EVENT_PREFIX = "launcher.";

/**
 * Append one redacted JSON line.
 * @param {string} file `<RUN>/launcher.jsonl`
 * @param {{ event: string } & Record<string, unknown>} record
 * @param {{ secrets?: unknown[], now?: () => number }} [opts]
 * @returns {boolean} whether the line was written
 */
export function appendLog(file, record, { secrets = [], now = Date.now } = {}) {
  if (typeof record?.event !== "string" || !record.event.startsWith(EVENT_PREFIX)) return false;
  try {
    const line = redact(JSON.stringify({ t: now(), ...record }), { secrets });
    fs.appendFileSync(file, `${line}\n`, { mode: FILE_MODE });
    return true;
  } catch {
    return false;
  }
}
