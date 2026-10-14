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

## Don't overwrite an unparseable config.json with defaults

**What:** When `load_preferences()` fails to parse `~/.mdpro/config.json`, the save paths
must not write defaults over the file. Either back it up (`config.json.corrupt-<timestamp>`)
before writing, or refuse the write and surface an error.

**Why:** `set_preferences` (`src-tauri/src/commands/preferences.rs`) does
`load_preferences().unwrap_or_default()`, merges the update and saves. `save_window_state`
follows the same pattern. One parse failure (a hand edit, or a downgrade that meets an enum
value the older build doesn't know) wipes every user preference on the next launch, with no
user action. `get_preferences` returns the error, the load effect in `src/App.tsx` swallows it,
still sets `preferencesLoaded`, and then immediately calls `setPreferences({ lastViewMode })`.
Any later settings change or window resize does the same. Rule 60 classes this as a BLOCK-level data-loss path.

**Pros:** Closes an existing silent data-loss path. Makes downgrades safe.

**Cons:** Touches two or three commands and needs Rust tests for the corrupt-file path.

**Policy (decided 2026-09-11):** back up, then reset, and tell the user. Rename the unparseable
file to `config.json.corrupt-<timestamp>`, continue with defaults, and show one toast that names
the backup. The file is never overwritten in place, and saves keep working for the rest of the
session. Rejected: refusing every write until the JSON is fixed by hand.

**Context:** Found during `/plan-eng-review` of `docs/plans/20260911-plan-ui-redesign.md`
(2026-09-11). That plan's `sourceFont` field is a `String` with serde defaults specifically so
it adds no new parse-failure trigger; the underlying bug predates it. Start at
`commands/preferences.rs` (`set_preferences`, `save_window_state`),
`services/preferences.rs` (`load_preferences`), the load+save calls in `commands/window.rs`, and
the preferences load effect in `src/App.tsx`, which must not write after a failed load.

**Priority:** P1
**Blocks:** Stage 5 (`sourceFont`) of `docs/plans/20260911-plan-ui-redesign.md` (decision E6)
**Depends on:** Nothing
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

## Add real spell-check backend

**What:** Integrate a real dictionary backend (system spellcheck / hunspell) with
misspelling highlighting in CodeMirror, replacing the removed `spellCheckPlugin.ts` stub.
Re-add the spell-check setting and a `spellCheck` shortcut entry.

**Why:** WI-3.5 of the Typora-parity plan deletes the dead stub (it was false UI — a
setting with no highlighting). Real spell-check is a genuine writing-app feature, just not
worth blocking Typora parity on.

**Pros:** Catches typos inline; expected in a serious writing tool.

**Cons:** Dictionary bundling/licensing; per-language packs; CodeMirror decoration perf on
large docs. Non-trivial.

**Context:** Stub removed during Typora-parity Phase 3 (docs/plans/20260628-plan-typora-parity.md,
WI-3.5). Start from a CodeMirror 6 linter/decoration extension + a WASM hunspell or the
macOS NSSpellChecker via a Tauri command.

**Depends on:** Typora-parity WI-3.5 (stub removal) landing first
**Blocked by:** Nothing

---

## Remove dead App.css and TabBar; fix rule 34's App.css claim

**What:** Delete `src/App.css` and `src/components/TabBar/`. Rewrite `.claude/rules/34-dark-theme.md:22`, which says
`prefers-color-scheme` is used "only in `App.css` for the pre-React paint flash".

**Why:** `App.css` is imported nowhere (not from `index.html`, `src/` or the Vite config), so the
mechanism rule 34 describes never runs. `TabBar` is re-exported only by its own `index.ts`; `BottomTabs`
is the tab UI in use. Both mislead contributors and AI sessions. They also force the UI redesign plan to
carry an extra "still unimported" assertion to keep them out of its tokenization scope.

**Pros:** About 120 fewer lines of dead CSS/TSX. Rule 34 matches reality. The tokenization scope needs no exclusions.

**Also delete the dead CSS that went with them** (plan P STOP 2, user 2026-10-15: 「Delete with the TODOS cleanup
(Recommended)」; WI-3.0 delegator ruling): the selectors on the `UNRENDERED` list in `tests/css-tokenization.test.ts`
(the `.tab*` rules in `src/styles/sections/tab-bar.css` and the orphans, 27 literals), plus two `--color-border` fills
with no literal that `tests/color-border-fills.test.ts` lists as dead: `.split-divider` (`app-shell.css`, an orphan;
`SplitView.tsx` renders no divider) and `.tab__close:hover` (`tab-bar.css`, rendered only by `TabBar/`). Drop their
rows from both tests in the same change, and the A8 dead-code guard in `tests/css-tokenization.test.ts` with them.

**Cons:** Must first confirm nothing references them implicitly. It is unverified whether a pre-React theme flash
actually happens; if it does, fix it in `index.html` rather than reviving `App.css`.

**Context:** Found during `/plan-eng-review` of `docs/plans/20260911-plan-ui-redesign.md` (2026-09-11).
That plan's assumption A8 lists both as dead-code candidates without deleting them. `App.css` was last
touched in the initial commit. Start with a repo-wide grep for `App.css` and `TabBar`, then cold-start
the app in the dark theme and watch the first frame.

**Priority:** P3
**Depends on:** Nothing
**Blocked by:** Nothing

---

## MCP: server-file removal runs under the snapshot lock (D205 audit b133 M1)

**What:** Since D205, a serve task that fails unpublishes `server.port` / `server.token`
(two `remove_file` calls) inside `snap::update`, i.e. under the `std::sync::Mutex` that
`snapshot()` and `mcp_get_status` read. A status read can wait on those two syscalls.

**Why deferred:** The removal has to be ordered before any reader or next generation sees
`Failed`, which is what fixed the D205 race; moving it out of the lock needs a second
ordering mechanism (e.g. a files lock taken by `start_locked` too). It runs only on the
serve-failure path, and the wait is two unlinks on a local disk.

**Context:** `src-tauri/src/services/mcp_controller/transitions.rs` `spawn_watched`;
audit b133 (2026-10-15), M1.

---

## Completed

### Create DESIGN.md design system

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

**Completed:** `DESIGN.md` was added in `850b21e` (2026-05-03), backed by rules 30–34. Moved here 2026-09-11. The same day the file itself moved to `docs/design/mdpro-ui-old/DESIGN.md`; the root `DESIGN.md` is now an index.
