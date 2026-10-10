/**
 * Purpose: Classify an updater `check()` rejection as "updates disabled"
 * (no usable endpoint configured / no release published) versus a genuine
 * failure such as a network error. Only the plugin's two disabled-meaning
 * Display texts (EmptyEndpoints, ReleaseNotFound) count; anything else —
 * including messages that merely mention "empty" — is a real failure.
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
 * The only two substrings that mark an updater rejection as "updates disabled".
 * - "does not have any endpoints": tauri-plugin-updater 2.9.0
 *   `Error::EmptyEndpoints` ("Updater does not have any endpoints set."),
 *   raised by an empty `endpoints` list (the verify build).
 * - "Could not fetch a valid release": `Error::ReleaseNotFound` ("Could not
 *   fetch a valid release JSON from the remote"), every endpoint answered
 *   non-success (e.g. no latest.json published yet).
 * Both Display texts are pinned on the Rust side by
 * src-tauri/tests/updater_error_wire.rs (K1). The former "no endpoints" /
 * "empty" markers were dropped: the plugin never emits them, and "empty"
 * misclassified real failures (e.g. "body is empty") as disabled, hiding the
 * error and its Check Again button.
 */
const UPDATES_DISABLED_MARKERS = [
  "does not have any endpoints",
  "Could not fetch a valid release",
] as const;

/** True when the updater rejection message means updates are not configured. */
export function isUpdatesDisabledError(message: string): boolean {
  return UPDATES_DISABLED_MARKERS.some((marker) => message.includes(marker));
}
