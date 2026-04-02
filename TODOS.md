# TODOS

Items deferred from code review and planning sessions.

---

## Clean up ghost shortcuts

**What:** Remove `fileNewWindow`, `fileOpenQuickly`, `fileSaveAs`, `viewSwitchDocuments`
from `SHORTCUT_CATEGORIES` in `KeyboardShortcutsSettings.tsx` and from the `KeyboardShortcuts`
type in `src/types/preferences.ts` and the Rust `KeyboardShortcuts` struct in `preferences.rs`.

**Why:** These entries appear in the Keyboard Shortcuts settings table as configurable, but
they have no corresponding entries in `menu.rs`. Users can assign keys to them, but the keys
do nothing. It's false UI.

**Pros:** Cleaner shortcuts table, no misleading entries, smaller type surface.

**Cons:** If these features are ever added, the shortcuts will need to be re-added. Low risk
since defaults can just be re-established.

**Context:** Noted during settings panel refactor (2026-03-30). The current `SettingsDialog.tsx`
(pre-refactor) has these in `SHORTCUT_CATEGORIES` at lines 94-98. After `KeyboardShortcutsSettings.tsx`
is extracted in the settings polish PR, clean up these entries in a follow-up commit.

**Depends on:** Settings panel full polish PR (extract `KeyboardShortcutsSettings.tsx`)
**Blocked by:** Nothing

---

## Add failure UX for write-through preference saves

**What:** Wrap `preferencesService.setPreferences()` calls in each settings page component
with a `try/catch`. On failure, show a toast error: "Failed to save preferences" using the
existing `useToastStore`.

**Why:** The write-through model (no Cancel/rollback) means if an IPC save fails (disk full,
permissions issue), the UI shows the new value but the disk still has the old value. The user
has no way to know the save failed. Silent confusion on next app launch.

**Pros:** Closes the silent failure gap. The toast infrastructure already exists.

**Cons:** Rare in practice (local disk failures uncommon). Minor complexity in each page component.

**Context:** Flagged by Codex outside voice review and confirmed as a gap (2026-03-30).
Deferred because write-through save failures are rare on local disk, and the existing
preferences system has no error surfacing today either.

**Depends on:** Settings panel full polish PR
**Blocked by:** Nothing

---

## Create DESIGN.md design system

**What:** Document the app's existing design language in `DESIGN.md` at the repo root:
CSS color tokens (`--color-panel`, `--color-border`, `--color-accent`, etc.), spacing scale,
border-radius conventions (8px controls, 12px cards, 16px dialogs), type scale, and the
component patterns established by the settings panel (`.settings-row`, section headers, steppers).

**Why:** No DESIGN.md means every new contributor and every AI session invents patterns from
scratch. The settings panel will establish real, reusable component patterns — worth documenting
while the decisions are fresh.

**Pros:** Prevents design drift in future PRs. Enables faster, more consistent contributions.
Makes the codebase welcoming to designers.

**Cons:** Takes time to write well. Goes stale if not maintained.

**Context:** Flagged by `/plan-design-review` (2026-03-30). No DESIGN.md existed at review time.
The settings panel full polish PR will ship the most coherent set of UI patterns this project
has had — ideal time to capture them.

**Depends on:** Settings panel full polish PR (establishes `.settings-row`, stepper, section patterns)
**Blocked by:** Nothing

---

## Updater: Background launch check

**What:** When the app launches, silently call `check()` in the background (after a 30-second
delay to avoid blocking startup). If an update is available, show a subtle badge or notification
on the Settings icon or in the title bar. Don't interrupt the user with a modal.

**Why:** The Settings → About flow requires users to manually check. Most users never will.
Background check is the standard behavior for auto-updaters. The badge approach keeps it
non-intrusive while ensuring users discover updates.

**Deferred because:** Requires `updaterStore` to be established first (Phase 1 of this feature).
Also depends on notarization being confirmed in CI (Approach B+). Ship the manual check first,
add background check in a follow-up.

**Depends on:** In-app update checker PR (this feature)
**Blocked by:** CI notarization confirmation

---

## Updater: What's New modal on first launch after update

**What:** After a successful relaunch following an update, detect the version change
(compare stored `lastSeenVersion` in preferences with `CARGO_PKG_VERSION`) and show a
one-time "What's New in v{version}" modal with the release notes.

**Why:** Users who clicked Restart get no feedback that the update succeeded and don't see
what changed. This closes the loop.

**Deferred because:** Requires `lastSeenVersion` in preferences schema (minor change) and a
new modal component. Not blocking for the initial updater PR.

**Depends on:** In-app update checker PR (this feature)
**Blocked by:** Nothing

---

## Updater: App icon in About panel

**What:** Display the app icon (512px or 1024px PNG from `src-tauri/icons/`) in the About
panel's header section, above the app name and version.

**Why:** Standard macOS About box pattern. Makes the About panel feel polished and official.
The icon asset already exists in the repo — just needs to be referenced.

**Deferred because:** Asset path in Tauri web context needs verification (`convertFileSrc` or
bundled as frontend asset). Not blocking for functionality.

**Depends on:** In-app update checker PR (this feature)
**Blocked by:** Nothing

---

## Updater: Download-interrupted remount recovery

**What:** If the user closes Settings during an active download and reopens the dialog,
restore the downloading state (show progress or "download in progress" message) and
disable navigation away from About until the download completes.

**Why:** Currently, if download starts and user closes dialog, state is lost (even with
updaterStore, the `downloadAndInstall` Promise is detached). The new download would need
to start fresh. For the MVP, the simpler fix is to lock the dialog during download.

**Deferred because:** The `updaterStore` Zustand approach handles state persistence.
Locking the dialog (disabling close / tab-switch during `downloading`/`ready`) covers
the most important case. Full interrupt recovery is a future improvement.

**Depends on:** In-app update checker PR (this feature)
**Blocked by:** Nothing

---

## Updater: Windows / Linux CI entries in latest.json

**What:** When Windows and Linux builds are added to the release matrix, extend the
`publish-release` `generate-latest-json` step to include their platform entries in
`latest.json` (using `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` keys).

**Why:** The initial `latest.json` script only covers `aarch64-apple-darwin` and
`x86_64-apple-darwin`. Multi-platform support requires extending the script.

**Deferred because:** Windows/Linux builds are not in the current release matrix.

**Depends on:** Multi-platform release PR (future)
**Blocked by:** Nothing
