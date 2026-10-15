/**
 * Purpose: Classify an updater `check()` rejection as "updates disabled"
 * (no endpoint configured), "platform not offered" (latest.json has no entry
 * for this platform, off macOS: D224), or a genuine failure such as a network
 * error. Only the plugin's exact EmptyEndpoints and TargetsNotFound Display
 * texts count; anything else, including ReleaseNotFound and messages that
 * merely contain one of those texts, is a real failure.
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
 * - TargetsNotFound (D224, ADR-0102): plugin 2.13.1 `check()` looks the
 *   client's platform up in latest.json before it compares versions
 *   (`updater.rs:676`), so a manifest with no entry for it rejects even when
 *   nothing is newer. latest.json lists only darwin, so off macOS that is
 *   "updates are not offered here", shown as the updates-disabled state. On
 *   macOS it means a broken release and stays a failure. Anchored on the full
 *   Display, a backticked list of one or more quoted targets.
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

/**
 * tauri-plugin-updater 2.13.1 `Error::TargetsNotFound` Display text: the targets it tried
 * (for a Windows NSIS client, "windows-x86_64-nsis" then "windows-x86_64") as a Rust debug
 * list inside backticks. Pinned by src-tauri/tests/updater_error_wire.rs (K3).
 */
const PLATFORM_NOT_IN_MANIFEST =
  /^None of the fallback platforms `\["[\w-]+"(?:, "[\w-]+")*\]` were found in the response `platforms` object$/;

/** What a `check()` rejection means for the About pane. */
export type CheckRejection = "updates-disabled" | "platform-not-offered" | "error";

/**
 * Classify a `check()` rejection message. `isMac` decides what a missing
 * platform entry means: not offered (Windows, Linux) or a broken release (macOS).
 */
export function classifyCheckRejection(message: string, isMac: boolean): CheckRejection {
  if (isUpdatesDisabledError(message)) return "updates-disabled";
  if (!isMac && PLATFORM_NOT_IN_MANIFEST.test(message.trim())) return "platform-not-offered";
  return "error";
}
