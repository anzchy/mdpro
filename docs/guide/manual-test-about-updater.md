# Manual Testing Guide: In-App Update Checker (Settings > About)

Last updated: 2026-04-02

---

## Overview

The About page (Settings > About) displays the app version, checks for updates
via the Tauri updater plugin, and manages the download/install/relaunch flow.
Because the updater is currently configured with **empty endpoints** (Approach B+),
the full update flow cannot be exercised until signing keys and a release endpoint
are configured. This guide covers everything that CAN be tested today and
documents what requires the full pipeline.

---

## 1. Prerequisites

| Item | Details |
|------|---------|
| OS | macOS 13+ (Apple Silicon) |
| Build | Development build via `pnpm tauri dev` |
| Sample workspace | At least one `.md` file on disk for save-guard tests |
| Log monitoring | Terminal with `tail -f ~/.mdpro/mdpro.log \| jq .` running |
| Network | WiFi on for error-message tests; toggle off for network-error test |

Before starting, confirm the app launches and the main editor is functional.

---

## 2. Opening the About Page

### 2.1 Via menu

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the **mdpro** menu in the menu bar (or use **Cmd + ,**) | Settings dialog opens on the "General" page |
| 2 | In the left sidebar of the Settings dialog, click **About** | The About page loads and shows "Checking for updates..." briefly |

### 2.2 Via keyboard

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press **Cmd + ,** | Settings dialog opens |
| 2 | Press **Tab** to navigate the sidebar, then **Enter** on "About" | About page loads |

---

## 3. About Page -- Basic Functionality

### 3.1 Version display

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings > About | The heading "About" is visible |
| 2 | Observe the app info area | "mdpro" label is displayed |
| 3 | Observe the version line | Shows "Version v0.2.4" (or whatever the current version is, always v-prefixed) |
| 4 | Cross-check: in terminal run `grep '^version' src-tauri/Cargo.toml` | The number after `version = "` matches the displayed version (without the `v` prefix) |

### 3.2 Updates-disabled state (current default behavior)

Because `tauri.conf.json` has `"endpoints": []`, the updater plugin will fail
immediately on check. The About page detects this and shows the "updates-disabled"
state.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings > About | After a brief "Checking for updates..." flash, the status text reads: **"Automatic updates coming soon."** |
| 2 | Observe the button area | There is **no** "Check Again" button visible (it is hidden when phase is `updates-disabled`) |
| 3 | Check logs: `tail -1 ~/.mdpro/mdpro.log \| jq .` | A log entry with `event: "ui.about.update_check"` and `status: "start"` should be present |

### 3.3 State caching across tab switches

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings > About and confirm "Automatic updates coming soon." is shown | updates-disabled state displayed |
| 2 | Click "General" in the sidebar | General page loads, About component unmounts |
| 3 | Click "About" again | About page loads immediately with "Automatic updates coming soon." -- no "Checking for updates..." flash |

This works because the `updates-disabled` state is cached in `updaterStore`.

---

## 4. State Persistence Tests (Close/Reopen Dialog)

### 4.1 Cache survives dialog close

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings > About | "Automatic updates coming soon." displayed |
| 2 | Close the Settings dialog (click Close button, click backdrop, or press Esc) | Dialog closes |
| 3 | Reopen Settings (Cmd + ,) and navigate to About | "Automatic updates coming soon." appears immediately with no "Checking..." flash |

### 4.2 Dialog always opens on General tab

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Settings, navigate to About | About page shown |
| 2 | Close the dialog | Dialog closes |
| 3 | Reopen the dialog | The active tab is "General", not "About" |

This is expected -- the dialog resets to General on each open. The user must
click About again, but the cached updater state loads instantly when they do.

---

## 5. Error Handling Tests

### 5.1 Updates-disabled error detection

This is tested in section 3.2 above. The empty-endpoints configuration produces an
error that is caught and mapped to the `updates-disabled` phase. Confirm that the
error message "Couldn't reach the update server..." does NOT appear -- instead, the
friendlier "Automatic updates coming soon." is shown.

### 5.2 Network-error state (optional, requires network toggle)

NOTE: This test requires temporarily editing `tauri.conf.json` to add a dummy
endpoint. If you only have `endpoints: []`, the updates-disabled path will trigger
before any network call is made.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Edit `src-tauri/tauri.conf.json`: set `"endpoints": ["https://invalid.example.com/update/{{target}}/{{current_version}}"]` | Fake endpoint configured |
| 2 | Rebuild: `pnpm tauri dev` | App restarts |
| 3 | Turn off WiFi / disconnect network | No internet |
| 4 | Open Settings > About | After "Checking for updates...", shows: **"Couldn't reach the update server. Check your connection and try again."** |
| 5 | Observe "Check Again" button | Button is visible and enabled |
| 6 | Turn WiFi back on and click "Check Again" | Shows "Checking for updates..." then resolves (likely to error again since endpoint is fake, but the retry mechanism works) |
| 7 | Revert `tauri.conf.json` to `"endpoints": []` | Restore default |

### 5.3 Error state caching

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Trigger an error state (per 5.2 above, or with a bad endpoint) | Error message displayed |
| 2 | Switch to General tab, then back to About | Error message persists (cached in updaterStore) |
| 3 | Close and reopen Settings, navigate to About | Error message still persists |
| 4 | Click "Check Again" | "Checking for updates..." appears, then resolves to the new result |

---

## 6. Confirm Dialog and Restart Guard

These tests require the app to be in the `ready` phase, which is only reachable
after a successful download. Since the updater has no endpoints configured, this
flow **cannot be tested end-to-end** in the current build.

However, the `prepareForRelaunch` logic and `ConfirmDialog` component can be
verified through unit tests. The following describes what a tester would do once
endpoints are configured:

### 6.1 Restart with no dirty documents (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state after downloading an update | "Ready to install" text and "Restart to Apply" button visible |
| 2 | Ensure all open documents are saved (no dot/indicator on tabs) | Clean state |
| 3 | Click "Restart to Apply" | ConfirmDialog appears with title "Restart to apply update?" |
| 4 | Observe dialog buttons | "Save and Restart" (confirm) and "Don't restart yet" (cancel) |
| 5 | Click "Save and Restart" | App relaunches on the new version |

### 6.2 Restart with modified saved documents (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state | "Restart to Apply" button visible |
| 2 | Open a file from disk, type some text (unsaved changes indicator shows) | Modified document with a file path |
| 3 | Click "Restart to Apply" | ConfirmDialog appears |
| 4 | Click "Save and Restart" | File is auto-saved, then app relaunches |
| 5 | After relaunch, open the same file | The edits from step 2 are preserved |

### 6.3 Restart blocked by untitled document (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state | "Restart to Apply" button visible |
| 2 | Create a new document (Cmd+N), type some text, do NOT save to disk | Untitled modified document |
| 3 | Click "Restart to Apply" then confirm in the dialog | A toast appears: "Untitled has unsaved changes. Save it before updating." |
| 4 | Observe | App does NOT relaunch. The "Restart to Apply" button remains available |

### 6.4 Restart blocked by save failure (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state | "Restart to Apply" button visible |
| 2 | Open a file, modify it, then externally make the file read-only (`chmod 444 file.md`) | Modified doc whose save will fail |
| 3 | Click "Restart to Apply" then confirm | A toast appears: "Failed to save [filename]. Update cancelled." |
| 4 | Observe | App does NOT relaunch |
| 5 | Restore permissions: `chmod 644 file.md` | Cleanup |

### 6.5 Cancel the restart dialog (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state, click "Restart to Apply" | ConfirmDialog appears |
| 2 | Click "Don't restart yet" | Dialog closes, About page still shows "Ready to install" with the "Restart to Apply" button |
| 3 | No data is lost, no relaunch occurs | App continues normally |

### 6.6 Dismiss via Escape (future test)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Reach the "ready" state, click "Restart to Apply" | ConfirmDialog appears |
| 2 | Press **Escape** | Dialog closes (same as clicking cancel) |

---

## 7. UI State Matrix

The About page has 7 possible phases. This table summarizes expected UI for each.

| Phase | Status Text | Check Again Button | Other Controls | Reachable Today? |
|-------|-------------|-------------------|----------------|-----------------|
| `checking` | "Checking for updates..." | Disabled | Spinner (if styled) | Yes (briefly on load) |
| `up-to-date` | "You're up to date" (with checkmark) | Enabled | None | No (needs real endpoint) |
| `error` | Error message text | Enabled | None | Partial (needs fake endpoint) |
| `updates-disabled` | "Automatic updates coming soon." | Hidden | None | Yes (default config) |
| `available` | "Update available -- v{version}" | Enabled | "Install Update" button, release notes area | No (needs real endpoint) |
| `downloading` | "Downloading update (X%)..." or "Downloading update..." | Disabled | Progress bar | No (needs real endpoint) |
| `ready` | "Ready to install" (with checkmark) | Disabled | "Restart to Apply" button | No (needs real endpoint) |

---

## 8. Progress Bar Behavior (Future Test)

When the download starts, the progress bar behaves differently depending on
whether the server provides a `Content-Length` header:

| Scenario | Expected |
|----------|----------|
| Server sends Content-Length | Determinate progress bar fills from 0% to 100% with percentage label |
| Server does NOT send Content-Length | Indeterminate progress bar (no `value` attribute on `<progress>` element), label shows "Downloading update..." without percentage |

To verify: inspect the `<progress>` element in DevTools during a download.

---

## 9. Release Notes Rendering (Future Test)

When an update is available, the `body` field from the update manifest is rendered
as sanitized Markdown HTML.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Trigger an `available` state with body containing Markdown | Release notes render as formatted HTML (headings, lists, code blocks) |
| 2 | Inspect rendered HTML in DevTools | No `<script>` tags, no `onclick` attributes -- DOMPurify strips them |
| 3 | Trigger with body containing `<script>alert('xss')</script>` | Script tag is stripped; no alert fires |

---

## 10. Log Verification

All updater actions emit structured logs. Verify the following events appear in
`~/.mdpro/mdpro.log`:

| Event | Status | When |
|-------|--------|------|
| `ui.about.update_check` | `start` | When check begins |
| `ui.about.update_check` | `success` or `fail` | When check completes |
| `ui.about.update_check` | `success` (context `outcome: "updates-disabled"`, plus `error`) | When check ends as "Automatic updates coming soon." (no endpoint / no release manifest); same `actionId` as the start line. A cached result logs no `update_check` line |
| `ui.about.update_install` | `start` | When "Install Update" is clicked |
| `ui.about.update_install` | `success` or `fail` | When download completes or fails |
| `ui.about.relaunch` | `start` | When relaunch is triggered |
| `updater.prepare_relaunch` | `start` | When pre-relaunch save guard runs |
| `updater.prepare_relaunch` | `success` or `fail` | After save guard completes |
| `app.get_version` | `success` | When version is fetched from Rust backend |

To verify:

```bash
tail -f ~/.mdpro/mdpro.log | jq 'select(.event | startswith("ui.about") or startswith("updater") or startswith("app.get_version"))'
```

---

## 11. What CANNOT Be Tested Until Signing Keys + Endpoints Are Configured

The following require a fully configured updater pipeline (signing keys generated,
`pubkey` populated in `tauri.conf.json`, release endpoint serving signed artifacts):

| Feature | Reason |
|---------|--------|
| `up-to-date` state | Requires a successful check against a real endpoint that returns "no update" |
| `available` state | Requires a real endpoint returning an update manifest |
| Download progress (determinate and indeterminate) | Requires downloading a real signed artifact |
| `ready` state | Requires a completed download |
| "Install Update" button functionality | Requires a downloadable update |
| "Restart to Apply" end-to-end | Requires reaching `ready` state + relaunch |
| Pre-relaunch save guard (manual) | Requires reaching `ready` state |
| ConfirmDialog interaction (manual) | Requires reaching `ready` state |
| Release notes rendering with real content | Requires a real update manifest with `body` field |
| Bad signature error | Requires a signed build and a tampered artifact |
| Disk-full error during download | Requires an actual download in progress |

All of the above are covered by **unit tests** (`AboutSettings.test.tsx`,
`useUpdater.test.ts`, `updaterStore.test.ts`) which mock the Tauri updater plugin.
The unit tests exercise all 7 phases and the save-guard logic.

---

## 12. Regression Checklist

Run this checklist after any change to the updater feature or the About page:

- [ ] App version displays correctly with `v` prefix on the About page
- [ ] Version matches `Cargo.toml` / `package.json` / `tauri.conf.json`
- [ ] With `endpoints: []`, the "Automatic updates coming soon." message appears
- [ ] No "Check Again" button is shown in the `updates-disabled` state
- [ ] Switching tabs in Settings and returning to About preserves the cached state
- [ ] Closing and reopening the Settings dialog preserves the cached state
- [ ] Opening Settings always lands on the "General" tab (not stuck on About)
- [ ] No `console.log` output in the browser console from updater code
- [ ] Log entries for `ui.about.update_check` appear in `~/.mdpro/mdpro.log`
- [ ] Pressing Escape in the Settings dialog closes it (focus trap works)
- [ ] The ConfirmDialog component renders correctly (verify via unit tests or Storybook if available)
- [ ] `pnpm test:run` passes all updater-related tests
- [ ] `cd src-tauri && cargo test` passes `get_app_version` tests
- [ ] No TypeScript errors: `pnpm build` completes without errors