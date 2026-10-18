/**
 * SettingsPageState
 *
 * Purpose: the two page states every Settings page shares (DESIGN.md § States
 * › Settings, WI-4.3b): one muted busy "Loading…" line while preferences load,
 * and one failure line when the read fails. Presentational only.
 *
 * Key decisions:
 * - The failure line never carries the rejection text: raw messages can hold
 *   filesystem paths and go to the log only (rule 30 rule 3).
 * - Styled by class, never inline, so both themes take the tokens. The failure
 *   line is the settings error box (DESIGN.md: "in the settings error style"),
 *   announced as an alert because it replaces the whole page.
 *
 * @coordinates-with src/styles/sections/settings-pages.css — .settings-loading
 * @coordinates-with src/styles/sections/settings-rows.css — .settings-error
 * @module components/common/settings/SettingsPageState
 */

export const LOAD_FAILED_MESSAGE = "Failed to load preferences. Please close and reopen settings.";

export function SettingsLoading() {
  return (
    <p className="settings-loading" aria-busy="true">
      Loading…
    </p>
  );
}

export function SettingsLoadFailed() {
  return (
    <p className="settings-error" role="alert">
      {LOAD_FAILED_MESSAGE}
    </p>
  );
}
