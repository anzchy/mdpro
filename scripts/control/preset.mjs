/**
 * Purpose: The launcher's preferences preset (ADR-0047 WI-003 WI-2, hard
 * constraint 4): the per-run `<RUN>/.mdpro/config.json` the app reads at start.
 *
 * Pipeline: `presets/verify-preferences.json` (committed, decision D3) →
 *   `PRESET_TEMPLATE` (deep-frozen) → `buildPreferences({ viewMode })` (a fresh
 *   copy with `defaultViewMode` / `lastViewMode` set) → `writePreferences`.
 *
 * Key decisions:
 * - The template is the one shared source: the Rust oracle
 *   `src-tauri/src/models/preferences_verify_preset_tests.rs` `include_str!`s
 *   the same file and deserializes it as `UserPreferences`. Every generated
 *   file differs from it only in the two view-mode keys, so the oracle's
 *   verdict carries over. A per-run `config.json` is never committed.
 * - `logging` carries both fields: `LogSettings` has no struct-level serde
 *   default, so a missing `level` voids the whole parse and logging with it.
 *   No `mcp` key, so the MCP server starts on its default.
 * - Only `source` and `wysiwyg` are accepted, the two modes the journeys use.
 * - The writer sets modes explicitly (dir 0700, file 0600) rather than relying
 *   on umask, and creates the file exclusively (`wx`): an existing
 *   `config.json` is an `EEXIST` rejection, never an overwrite.
 *
 * @module scripts/control/preset
 * @coordinates-with scripts/control/runDir.mjs (`layout().prefsDir`, `.prefs`)
 * @coordinates-with src-tauri/src/models/preferences.rs (UserPreferences)
 */
import fs from "node:fs";

const TEMPLATE_URL = new URL("./presets/verify-preferences.json", import.meta.url);
const VIEW_MODES = new Set(["source", "wysiwyg"]);
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The committed template, parsed once and deep-frozen. */
export const PRESET_TEMPLATE = deepFreeze(JSON.parse(fs.readFileSync(TEMPLATE_URL, "utf8")));

/**
 * A fresh preferences object for one run.
 * @param {{ viewMode: unknown }} input `"source"` or `"wysiwyg"`
 * @returns {Record<string, unknown>}
 */
export function buildPreferences({ viewMode } = {}) {
  if (typeof viewMode !== "string" || !VIEW_MODES.has(viewMode)) {
    throw new Error('viewMode must be "source" or "wysiwyg"');
  }
  const prefs = structuredClone(PRESET_TEMPLATE);
  prefs.defaultViewMode = viewMode;
  prefs.lastViewMode = viewMode;
  return prefs;
}

/**
 * Write `<RUN>/.mdpro/config.json` (dir 0700, file 0600, exclusive create).
 * The run dir must already exist. Rejects with `EEXIST` if the file does.
 * @param {{ prefsDir: string, prefs: string }} lay a run layout
 * @param {{ viewMode: unknown }} input
 * @returns {Promise<void>}
 */
export async function writePreferences(lay, { viewMode } = {}) {
  const body = `${JSON.stringify(buildPreferences({ viewMode }), null, 2)}\n`;
  await fs.promises.mkdir(lay.prefsDir, { recursive: true, mode: DIR_MODE });
  await fs.promises.chmod(lay.prefsDir, DIR_MODE);
  const handle = await fs.promises.open(lay.prefs, "wx", FILE_MODE);
  try {
    await handle.chmod(FILE_MODE);
    await handle.writeFile(body, "utf8");
  } finally {
    await handle.close();
  }
}
