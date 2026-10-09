/**
 * Purpose: Classify an updater `check()` rejection as "updates disabled"
 * (no usable endpoint configured / no release published) versus a genuine
 * failure such as a network error.
 *
 * Key decisions:
 * - Pure substring classifier over the rejection message. The caller narrows
 *   the rejection first (`e instanceof Error ? e.message : String(e)`); under
 *   Tauri, `invoke` rejects with the plugin error's serialised string.
 * - Case-sensitive, unanchored: the plugin's message may be wrapped
 *   ("Error: …") or carry a trailing newline / period.
 *
 * @coordinates-with AboutSettings (runCheck catch branch)
 */

/**
 * Substrings that mark an updater rejection as "updates disabled".
 * - "does not have any endpoints": tauri-plugin-updater 2.9.0
 *   `Error::EmptyEndpoints` ("Updater does not have any endpoints set."),
 *   raised by an empty `endpoints` list (the verify build). Pinned on the Rust
 *   side by src-tauri/tests/updater_error_wire.rs.
 * - "Could not fetch a valid release": `Error::ReleaseNotFound`, every
 *   endpoint answered non-success (e.g. no latest.json published yet).
 * - "no endpoints" / "empty": legacy markers, kept unchanged.
 */
const UPDATES_DISABLED_MARKERS = [
  "does not have any endpoints",
  "no endpoints",
  "empty",
  "Could not fetch a valid release",
] as const;

/** True when the updater rejection message means updates are not configured. */
export function isUpdatesDisabledError(message: string): boolean {
  return UPDATES_DISABLED_MARKERS.some((marker) => message.includes(marker));
}
