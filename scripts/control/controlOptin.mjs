/**
 * Purpose: the control channel's opt-in marker (ADR-0047 WI-009 WI 3, the
 * explicit opt-in of decision 6). `launch --control on|eval` writes it into
 * the new run dir before the app is spawned; the app opens its channel only
 * when it finds the marker (`src-tauri/src/services/control_channel/optin.rs`).
 *
 * Key decisions:
 * - A file in the private run dir, not an env var: it cannot leak into a
 *   process the app spawns, and anything that is not exactly this file keeps
 *   the channel closed (the app refuses a symlink, another uid's file and a
 *   mode wider than 0600).
 * - `wx` and 0600, like `launch.json`; the body is `{"eval": bool}`. `eval`
 *   rides on the same marker, so there is one opt-in, not two.
 *
 * @module scripts/control/controlOptin
 * @coordinates-with scripts/control/launch.mjs (writes it), launcherCli.mjs (`--control`)
 * @coordinates-with src-tauri/src/services/control_channel/optin.rs (reads it)
 */
import fs from "node:fs";
import path from "node:path";

export const OPTIN_FILE = "control-optin.json";
/** The `--control` values and whether each turns `eval` on. */
export const CONTROL_MODES = Object.freeze({ on: false, eval: true });

/** @param {unknown} v @returns {v is "on" | "eval"} */
export const isControlMode = (v) => typeof v === "string" && Object.hasOwn(CONTROL_MODES, v);

/**
 * Write the marker into `runDir`; throws if it already exists.
 * @param {string} runDir @param {"on" | "eval"} mode
 */
export function writeOptin(runDir, mode) {
  const body = JSON.stringify({ eval: CONTROL_MODES[mode] });
  fs.writeFileSync(path.join(runDir, OPTIN_FILE), body, { flag: "wx", mode: 0o600 });
}
