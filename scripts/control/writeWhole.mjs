/**
 * Purpose: Create a small control file that is never seen incomplete
 * (D148-WI-3, D170-WI-1). Shared by the launcher's mutex and break files
 * (`lockMutex.mjs`) and the clean marker (`cleanClaim.mjs`).
 *
 * Pipeline: `writeWhole(file, body, mode)` → write all of `body` to a unique
 *   `<file>.<pid>-<hex>.tmp` beside it (`wx`) → `linkSync(temp, file)` (EEXIST
 *   when `file` exists, thrown as-is) → unlink the temp in `finally`.
 *
 * Key decisions:
 * - A link, not a rename: a rename would replace an existing file, while the
 *   callers rely on EEXIST meaning "someone else holds it".
 * - A process killed between the temp write and the link leaves at most a temp,
 *   which nothing reads, so it blocks nothing. Nothing removes such a temp.
 * - A failed temp unlink is swallowed: the target already exists whole, and
 *   throwing would fail a call that has in fact created it.
 *
 * @module scripts/control/writeWhole
 * @coordinates-with scripts/control/lockMutex.mjs (`.lock.mutex`, `.lock.mutex.break`)
 * @coordinates-with scripts/control/cleanClaim.mjs (`.clean.<run>`)
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const TEMP_HEX_BYTES = 8;

/**
 * Create `file` holding all of `body`, or throw EEXIST when it exists.
 * @param {string} file @param {string} body @param {number} mode
 */
export function writeWhole(file, body, mode) {
  const temp = `${file}.${process.pid}-${randomBytes(TEMP_HEX_BYTES).toString("hex")}.tmp`;
  let made = false;
  try {
    fs.writeFileSync(temp, body, { flag: "wx", mode });
    made = true;
    fs.linkSync(temp, file);
  } finally {
    if (made) {
      try {
        fs.unlinkSync(temp);
      } catch {
        // Kept temp: harmless (see Key decisions).
      }
    }
  }
}
