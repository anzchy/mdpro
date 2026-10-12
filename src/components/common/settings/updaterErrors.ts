/**
 * Purpose: Classify an updater `check()` rejection as "updates disabled"
 * (no endpoint configured) versus a genuine failure such as a network error.
 * Only the plugin's exact EmptyEndpoints Display text counts; anything else,
 * including ReleaseNotFound and messages that merely contain that text, is a
 * real failure.
 *
 * Key decisions:
 * - Anchored on the full Display text (D110). The caller narrows the rejection
 *   first (`e instanceof Error ? e.message : String(e)`); under Tauri, `invoke`
 *   rejects with the plugin error's serialised string, which is exactly that
 *   text. A substring match would also accept a Serialization error whose
 *   echoed response body happens to contain it.
 * - Case-sensitive; only surrounding whitespace is tolerated.
 * - ReleaseNotFound ("Could not fetch a valid release JSON from the remote") is
 *   uncertain, not disabled: plugin 2.9.0 `updater.rs:442-446` collapses every
 *   non-2xx answer (404, 401/403, 5xx) into it, so it cannot mean "not
 *   configured" (D85, option A — sequencing doc D85 row).
 *
 * @coordinates-with AboutSettings (runCheck catch branch)
 */

/**
 * The only rejection text that marks updates as disabled: tauri-plugin-updater
 * 2.9.0 `Error::EmptyEndpoints` Display text, raised by an empty `endpoints`
 * list (the verify build). Pinned character for character on the Rust side by
 * src-tauri/tests/updater_error_wire.rs (K1-exact). The former
 * "Could not fetch a valid release" marker was dropped (D85): it is the
 * plugin's answer to any non-2xx, so treating it as disabled hid outages and
 * auth failures behind "coming soon". The older "no endpoints" / "empty"
 * markers were dropped earlier: the plugin never emits them.
 */
const EMPTY_ENDPOINTS_DISPLAY = "Updater does not have any endpoints set.";

/** True when the updater rejection message means no update endpoint is configured. */
export function isUpdatesDisabledError(message: string): boolean {
  return message.trim() === EMPTY_ENDPOINTS_DISPLAY;
}
