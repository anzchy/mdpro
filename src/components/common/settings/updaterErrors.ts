/**
 * Purpose: Classify an updater `check()` rejection as "updates disabled"
 * (no endpoint configured) versus a genuine failure such as a network error.
 * Only the plugin's EmptyEndpoints Display text counts; anything else,
 * including ReleaseNotFound and messages that merely mention "empty", is a
 * real failure.
 *
 * Key decisions:
 * - Pure substring classifier over the rejection message. The caller narrows
 *   the rejection first (`e instanceof Error ? e.message : String(e)`); under
 *   Tauri, `invoke` rejects with the plugin error's serialised string.
 * - Case-sensitive, unanchored: the plugin's message may be wrapped
 *   ("Error: …") or carry a trailing newline / period.
 * - ReleaseNotFound ("Could not fetch a valid release JSON from the remote") is
 *   uncertain, not disabled: plugin 2.9.0 `updater.rs:442-446` collapses every
 *   non-2xx answer (404, 401/403, 5xx) into it, so it cannot mean "not
 *   configured" (D85, option A — sequencing doc D85 row).
 *
 * @coordinates-with AboutSettings (runCheck catch branch)
 */

/**
 * The only substring that marks an updater rejection as "updates disabled":
 * "does not have any endpoints", tauri-plugin-updater 2.9.0
 * `Error::EmptyEndpoints` ("Updater does not have any endpoints set."), raised
 * by an empty `endpoints` list (the verify build). Its Display text is pinned
 * on the Rust side by src-tauri/tests/updater_error_wire.rs (K1). The former
 * "Could not fetch a valid release" marker was dropped (D85): it is the
 * plugin's answer to any non-2xx, so treating it as disabled hid outages and
 * auth failures behind "coming soon". The older "no endpoints" / "empty"
 * markers were dropped earlier: the plugin never emits them.
 */
const UPDATES_DISABLED_MARKERS = ["does not have any endpoints"] as const;

/** True when the updater rejection message means no update endpoint is configured. */
export function isUpdatesDisabledError(message: string): boolean {
  return UPDATES_DISABLED_MARKERS.some((marker) => message.includes(marker));
}
