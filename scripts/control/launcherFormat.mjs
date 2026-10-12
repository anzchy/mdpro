/**
 * Purpose: Redaction and the line formatters for every line the launcher
 * prints or logs (ADR-0047 WI-003 WI-9): `redact(text, { secrets, repoRoot,
 * homeDir })`, and one `format*` per kind of line a verb emits (verdict,
 * ready, driver failure, `open` argv error, quit / clean refusal, doctor
 * lines, a thrown error). Every formatter ends in `redact`.
 *
 * Pipeline: text → each non-empty secret, longest first → `<redacted>`
 *   → `repoRoot` prefix → `.` → a single-quoted word starting with
 *   `homeDir` → `~/'rest'` (or `~`) → any other `homeDir` prefix → `~`.
 *
 * Key decisions:
 * - Longest secret first, so an overlapping shorter secret never leaves a
 *   tail of the longer one behind (`<redacted>def`).
 * - Empty secrets are ignored: splitting on `""` would corrupt every char.
 * - The marker contains no path separator and no hex run, so a second pass
 *   changes nothing (idempotence).
 * - The repo root is replaced before the home, because it usually lies
 *   inside the home.
 * - The home is quote-aware (D179): doctor's `remove: rm '<path>'` is a sh
 *   command, and `~` does not expand inside single quotes, so a quoted
 *   `'<home>/rest'` becomes `~/'rest'` (the quote moves past the tilde) and
 *   the printed command still runs. `~` expands `$HOME`, which is the home
 *   `processIo` redacts (`os.homedir()`), so the command names the same file
 *   in the shell doctor ran from. The repo root gets no such rule: no
 *   quoted command names a path inside the repo.
 * - A formatter takes the redaction options as its last argument and never
 *   builds a line it does not redact; an unknown verdict kind prints as a
 *   driver failure rather than a line the verdict grammar would reject.
 *
 * @module scripts/control/launcherFormat
 * @coordinates-with scripts/control/launcherLog.mjs (redacts every line it writes)
 * @coordinates-with scripts/control/launchCore.mjs (reporter → formatVerdict)
 * @coordinates-with scripts/control/launch.mjs, quit.mjs, clean.mjs, doctor.mjs, launcherCli.mjs
 */

/** What a secret is replaced with. */
export const REDACTED = "<redacted>";

/**
 * @param {string} s @param {string} from @param {string} to
 * @returns {string}
 */
const replaceAll = (s, from, to) => s.split(from).join(to);

/**
 * Strip secrets and absolute repo / home paths from `text`.
 * @param {unknown} text
 * @param {{ secrets?: unknown[], repoRoot?: string, homeDir?: string }} [opts]
 * @returns {string}
 */
export function redact(text, { secrets = [], repoRoot, homeDir } = {}) {
  let out = String(text);
  const live = secrets.filter((s) => typeof s === "string" && s !== "");
  for (const s of [...live].sort((a, b) => b.length - a.length)) out = replaceAll(out, s, REDACTED);
  if (typeof repoRoot === "string" && repoRoot !== "") out = replaceAll(out, repoRoot, ".");
  if (typeof homeDir === "string" && homeDir !== "") out = replaceAll(redactQuotedHome(out, homeDir), homeDir, "~");
  return out;
}

/** @param {string} s @returns {string} `s` as a literal inside a RegExp */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The home inside a single-quoted sh word (D179): `'<home>/rest'` →
 * `~/'rest'` and `'<home>'` → `~`, so the word still expands to the same
 * path (a `~` inside the quotes would not expand). Only a quote that opens a
 * word (start of text or after whitespace) counts, and the home must end at
 * a `/` or at the word's closing quote, so a path that merely shares the
 * home's prefix is left to the plain replacement.
 * @param {string} s @param {string} home @returns {string}
 */
function redactQuotedHome(s, home) {
  const re = new RegExp(`(^|\\s)'${escapeRe(home)}(?:(/)|'(?=\\s|$))`, "g");
  return s.replace(re, (_m, lead, slash) => (slash ? `${lead}~/'` : `${lead}~`));
}

/** @typedef {{ secrets?: unknown[], repoRoot?: string, homeDir?: string }} RedactOpts */

const KINDS = ["pass", "fail", "driver failure", "NOT VERIFIED"];

/**
 * The last line of every verb: `verdict: <kind>[ — <reason>]`.
 * @param {string} kind @param {string | undefined} reason @param {RedactOpts} [opts]
 * @returns {string}
 */
export function formatVerdict(kind, reason, opts) {
  if (!KINDS.includes(kind)) return redact("verdict: driver failure — bad verdict kind", opts);
  return redact(reason ? `verdict: ${kind} — ${reason}` : `verdict: ${kind}`, opts);
}

/** @param {string} reason @param {RedactOpts} [opts] @returns {string} */
export const formatDriverFailure = (reason, opts) => formatVerdict("driver failure", reason, opts);

/** @param {{ run: unknown, pid: unknown }} r @param {RedactOpts} [opts] @returns {string} */
export const formatReady = ({ run, pid }, opts) => redact(`ready: L1 run ${run} pid ${pid}`, opts);

/** The `open` command line a failed `--via open` spawn carried, for the log. @param {unknown[]} argv @param {RedactOpts} [opts] */
export const formatOpenArgvError = (argv, opts) => redact(`open failed: open ${argv.map(String).join(" ")}`, opts);

/** @param {unknown[]} failed @param {RedactOpts} [opts] @returns {string} */
export const formatQuitRefusal = (failed, opts) => formatVerdict("fail", `ownership: ${failed.join(", ")}`, opts);

/** @param {unknown[]} failed @param {RedactOpts} [opts] @returns {string} */
export const formatCleanRefusal = (failed, opts) => formatVerdict("fail", `ownership: ${failed.join(", ")}`, opts);

/** @param {unknown[]} lines @param {RedactOpts} [opts] @returns {string[]} */
export const formatDoctorLines = (lines, opts) => lines.map((l) => redact(l, opts));

/** A thrown error as a driver-failure verdict. @param {unknown} e @param {RedactOpts} [opts] */
export const formatError = (e, opts) => formatDriverFailure(e instanceof Error ? e.message : String(e), opts);
