/**
 * Purpose: the judgements of the release clean check (ADR-0047 WI-009 plan
 * item 10; ADR-0034 decision 4 plus ADR-0047 decision 6). Each takes what one
 * layer read and returns null when that layer is clean, or the reason it is
 * not. `releaseClean.mjs` does the reading.
 *
 * Key decisions:
 * - Unreadable or empty input is never clean: a check that saw nothing
 *   proved nothing.
 * - Layer 1 reads `tauri-app`'s own features, not a driver crate: candidate B
 *   adds no crate (plan item 16), so the feature gate is what keeps the
 *   channel out of a default build.
 * - The markers are strings only the channel's code carries: the page slot
 *   `__mdproCtl`, the opt-in file name and the plugin name.
 * - Layer 4 must see the single-instance socket the caller waited for: a
 *   listing without it proves lsof saw nothing, not that nothing listens
 *   (Codex round-1 M2 on PR #500).
 *
 * @module scripts/control/releaseCleanChecks
 * @coordinates-with scripts/control/releaseClean.mjs (reads each layer, calls these)
 * @coordinates-with src-tauri/src/services/control_channel/ (where the markers live)
 */

/** The release single-instance socket: `/tmp/<identifier, . → _>_si.sock`, as `runDir.mjs`'s verify one. */
export const SI_SOCK_RELEASE = "/tmp/com_mdpro_app_si.sock";

const CHANNEL_FEATURES = ["control-channel", "verify-run"];
const DIST_MARKERS = ["__mdproCtl", "control-optin.json", "mdpro-control"];
const BINARY_MARKERS = ["control.listen", "control-optin.json", "mdpro-control"];
const HANDOFF_FILES = ["control.json", "ctl.sock"];
const LOOPBACK = ["127.0.0.1:", "[::1]:"];

/**
 * Layer 1: `cargo tree -e features` on the default build.
 * @param {string} tree its stdout
 * @returns {string | null}
 */
export function featureGraphFinding(tree) {
  if (!/\btauri-app\b/.test(tree)) return "layer 1: cargo tree printed no tauri-app";
  for (const f of CHANNEL_FEATURES) {
    if (tree.includes(`tauri-app feature "${f}"`)) return `layer 1: the default build enables ${f}`;
  }
  return null;
}

/**
 * Layer 2: the release `dist`.
 * @param {{ path: string, text: string }[]} files every file, path relative to dist
 * @returns {string | null}
 */
export function distFinding(files) {
  if (files.length === 0) return "layer 2: dist has no files";
  for (const { path, text } of files) {
    const m = DIST_MARKERS.find((marker) => text.includes(marker));
    if (m !== undefined) return `layer 2: ${path} contains ${m}`;
  }
  return null;
}

/**
 * Layer 3: the release main binary.
 * @param {Buffer} bytes its contents
 * @returns {string | null}
 */
export function binaryFinding(bytes) {
  if (bytes.length === 0) return "layer 3: the binary is empty";
  const m = BINARY_MARKERS.find((marker) => bytes.includes(marker));
  return m === undefined ? null : `layer 3: the binary contains ${m}`;
}

/** The `n` fields of `lsof -F n` output. @param {string} out */
const names = (out) =>
  out
    .split("\n")
    .filter((l) => l.startsWith("n"))
    .map((l) => l.slice(1));

/** Whether `lsof -F` output names a process at all. @param {string} out */
const hasProcess = (out) => out.split("\n").some((l) => /^p\d+$/.test(l));

/** The single-instance socket under either spelling of /tmp. */
const isSiSock = (/** @type {string} */ n) => n === SI_SOCK_RELEASE || n === `/private${SI_SOCK_RELEASE}`;

/** An unnamed peer end (`->0x…`), or the single-instance socket. */
const allowedUnix = (/** @type {string} */ n) => n === "" || n.startsWith("->") || isSiSock(n);

/**
 * The stdout of one lsof run. Exit 1 with nothing on stderr is lsof's "no
 * matching files"; any other non-zero exit, or exit 1 with stderr, is a
 * failure of the read, never an empty listing.
 * @param {{ status: number | null, stdout: string, stderr: string }} r
 * @returns {string}
 */
export function lsofOutput(r) {
  if (r.status === 0) return r.stdout;
  if (r.status === 1 && r.stderr.trim() === "") return r.stdout;
  const err = r.stderr.trim();
  throw new Error(`lsof exited ${r.status}${err === "" ? "" : `: ${err}`}`);
}

/**
 * Layer 4: the release app's listeners with the opt-in placed.
 * @param {string} tcpOut `lsof -nP -a -p <pid> -iTCP -sTCP:LISTEN -F n`
 * @param {string} unixOut `lsof -nP -a -p <pid> -U -F n`
 * @returns {string | null}
 */
export function listenerFinding(tcpOut, unixOut) {
  if (!hasProcess(tcpOut) && !hasProcess(unixOut)) return "layer 4: lsof printed nothing for the process";
  const tcp = names(tcpOut);
  if (tcp.length > 1) return `layer 4: ${tcp.length} TCP listeners, expected at most 1 (MCP)`;
  const offLoopback = tcp.find((n) => !LOOPBACK.some((p) => n.startsWith(p)));
  if (offLoopback !== undefined) return `layer 4: TCP listener ${offLoopback} is not on loopback`;
  const unix = names(unixOut);
  const unexpected = unix.find((n) => !allowedUnix(n));
  if (unexpected !== undefined) return `layer 4: unexpected socket ${unexpected}`;
  return unix.some(isSiSock) ? null : `layer 4: lsof did not list ${SI_SOCK_RELEASE}`;
}

/**
 * Layer 4: what the release app left in its temp home.
 * @param {string[]} paths every entry, relative to the home
 * @returns {string | null}
 */
export function homeFinding(paths) {
  const p = paths.find((rel) => HANDOFF_FILES.includes(rel.split("/").pop() ?? ""));
  return p === undefined ? null : `layer 4: the app wrote ${p}`;
}
