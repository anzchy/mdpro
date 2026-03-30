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
