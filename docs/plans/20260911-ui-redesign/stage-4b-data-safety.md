# UI redesign plan — Stage 4b: data safety

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Stage 4b — Data safety (part of Stage 4, Deliverable C)

Stage 4's entry condition, acceptance criteria, commit split and worktree lanes are in [`stage-4a-components.md`](stage-4a-components.md).

WI-4.10, WI-4.11, WI-4.13 and WI-4.14 came out of the design review. The last three — **WI-4.16, WI-4.17 and WI-4.18** — came out of the round-2 engineering review and are sequenced with the rest of that series in [`stage-4c-foundation.md`](stage-4c-foundation.md); they live here because each one is a data-safety fix, not because they run with the items above.

### WI-4.10 — External change dialog (DR5) — M
- **Why:**
  - "Modified" and "deleted" share one `ReloadDialog` (`App.tsx:487-494`, `:1163-1168`), and **Reload** has `autoFocus` (`ReloadDialog.tsx:38-40`).
  - `decideFileChange` never looks at unsaved edits (`src/utils/dataLossGuards.ts:68-88`), so Enter discards them.
  - A deleted file is offered Reload, which then fails in `handleReloadFile` (`App.tsx:606-620`) with a "Reload failed" toast.
  - Against rule 32: there is no Tab trap, and the dialog uses `aria-label` where the rule requires `aria-labelledby` / `aria-describedby`.
- **Guard first (pure):** `decideFileChange` also takes the active document's `isModified` and returns one of three prompts: changed with no edits, changed with unsaved edits, or deleted. `rename` and `ignore` are unchanged. The `switch` in `App.tsx` stays exhaustive (rule 60).
- **Dialog:**
  - Implements the DESIGN.md § External change dialog state table: titles, copy, button order, focus and Esc. The file name comes from the DR4 shared helper.
  - Tab is trapped in the dialog, following `handleDialogKeyDown` in `SettingsDialog.tsx` (rule 32).
  - The state is derived at render from the latest event and the current `isModified`, so a later event can never show the no-edits state over unsaved text.
- **Deleted → Save As…:** there is no Save As menu item, but the code path exists: `saveActiveDocumentAs` (`useDocument.ts:172-200`) opens the save picker and saves, as untitled documents already do (`:207`). "Save As…" calls it (Q14, closed). Preflight: confirm the file watcher follows the new path.
- **Tests** (through tdd-guardian, RED first):
  - Guard: changed + clean, changed + dirty, deleted (clean and dirty), renamed, another path, and a null event
  - **Data-loss regression:** in the unsaved-edits state, Enter does not call reload and the content is unchanged. This test fails against today's dialog.
  - In every state, Esc takes the left action and never reloads
  - The deleted state has no Reload button
  - Tab from the last button wraps to the first, and Shift+Tab wraps back
  - `tests/focus-trap.test.ts:83-93`: replace the ReloadDialog "primary action button has autoFocus" source match with per-state focus assertions (rule 33 asks new dialogs for equivalent assertions)
- **Logging:** keep `dialog.reload.reload` and `dialog.reload.ignore` (`ReloadDialog.tsx:19,32,43`). Add `dialog.reload.discard` and `dialog.reload.save_as`, each with `context.state`.

### WI-4.11 — Already-open guard (DR6) — S
- **Order:** no UI and no file overlap with the other Stage 4 items, so it runs first in Stage 4. WI-4.14 follows it.
- **Why:** `openDocumentFromPath` (`useDocument.ts:59-82`) and `openDocumentFromDialog` (`:92-100`) read the file and call `upsertDocument`. That call replaces any document with the same id (`documentStore.ts:45-64`), and the id is a hash of the path (`document.rs:57-64`). So re-opening an open file discards its unsaved edits with no prompt. The routes are ⌘O, recent files, Finder / `file:open` (`openPaths`, `App.tsx:553-567`) and a drop.
- **Behavior:** if the path is already open, activate that document and do not use the fresh read, whether or not it has unsaved edits.
  - No dialog and no toast: the tab switch is the one signal (rule 30 rule 5).
  - A change on disk is still handled by WI-4.10's dialog.
- **Check:** one pure helper, used by both open paths.
  - It compares the id the store uses. `Document::generate_id` (`document.rs:57-64`) hashes the path exactly as given, with no canonicalization.
    - So two spellings of one file (a symlink, or a `./` segment) still open twice.
    - That is today's behavior and stays out of scope.
  - The path route checks before calling `fileService.openFile`, which skips the read.
  - `open_file_dialog` (`file.rs:1094-1135`) reads the file before it returns, so the dialog route compares `result.document.id` and drops the fresh copy.
- **Tests** (through tdd-guardian, RED first):
  - **Data-loss regression:** with an open document that has unsaved edits, opening the same path leaves `content` and `isModified` unchanged and makes that document active. This test fails today.
  - The same case through the dialog path (Tauri mocked at the boundary)
  - A clean already-open document is also just activated
  - A different path still opens a new tab
- **Logging:** `tab.switch` with `context.reason: "already_open"` and the action id.

### WI-4.13 — Error toasts (DR9) — S
- **Order:** Lane B, right after WI-4.2. It uses the `Icon` close glyph and edits failure calls in `App.tsx`.
- **Why:**
  - `toastStore.ts` holds one `message` and always starts a 3000 ms timer, so every toast disappears on its own.
  - `Toast.tsx:13` always renders `role="status"` with `aria-live="polite"`. The component already accepts `onClose`, but `App.tsx:1189` passes none, so no toast has a dismiss button today.
  - About a dozen calls report failures with the same look and timing as successes, including `Save failed: ${message}` (`saveService.ts:40`) next to "Saved" (`:37`). Rule 60 requires save errors to reach the user.
  - DESIGN.md § Toasts specifies an error variant that nothing builds.
- **Store:** `showToast(message, options?)`, where `options.variant` is `"info" | "error"` and defaults to `"info"`.
  - No call passes `durationMs` today, so the options object replaces that parameter. Re-check with grep before changing the signature.
  - `info` keeps the 3000 ms timer.
  - `error` clears any pending timer and starts none, so it stays until dismissed or replaced.
  - Any new toast replaces the current one (rule 32: one at a time), and its own variant decides the timer. A timer started for an earlier `info` toast must never clear a later `error` toast.
- **Component:** reads the variant from the store.
  - `error`: `role="alert"`, the danger icon and left edge from DESIGN.md § Toasts, and a button named "Dismiss" that calls `clearToast`. Focus does not move to the toast.
  - `info`: unchanged: `role="status"`, `aria-live="polite"` and no button.
- **Error calls:** re-locate each by its message, since earlier work items move the line numbers.
  - `App.tsx`: `:530` open, `:596` export, `:614` reload, `:644` recover draft, `:655` discard draft, `:670` reopen with encoding, `:703` new window
  - `saveService.ts:40`; widen `SaveDeps.showToast` to take the options
  - `preferencesService.ts:78`
  - `useUpdater.ts:52` (a save failed, so the update was cancelled)
  - `imagePastePlugin.ts:161` and `:217`, and the batch summary at `:208` when `failureCount > 0`
  - the WI-4.6 "Close failed" toast at both Discard callers
- **Refusals stay `info`:** `imagePastePlugin.ts:85` and `:110`, `useUpdater.ts:28`, `App.tsx:724` and `:959`, and WI-4.12's unsupported-drop toast. Each tells the user what to do next instead of reporting a failure.
- **Open failures reach the user** (DESIGN.md § States › Documents):
  - Today `openDocumentFromPath` returns `null` for every failure that isn't an encoding error (`useDocument.ts:70-79`), and `openPaths` swallows the rest (`App.tsx:553-567`). Recent files, Finder / `file:open` and a drop show nothing (rule 60). Only ⌘O shows "Failed to open file" (`:530`), because the dialog path re-throws (`useDocument.ts:112-114`).
  - `openDocumentFromPath` re-throws non-encoding failures, as the dialog path already does. An encoding failure still opens the encoding dialog and shows no toast.
  - `handleOpenPath` shows one error toast, "Failed to open *name*", with the name from the DR4 helper. `openPaths` collects its failures and shows one toast for the batch, for example "Failed to open 3 files". ⌘O uses the same copy.
  - A file over the limit adds its reason: "Failed to open *name*: larger than 10 MB". The backend returns `FileError::FileTooLarge` for it (`src-tauri/src/commands/file.rs:162-168`). Other raw error text goes to the log only (rule 30 rule 3).
  - The large-file warning can't fire: it warns above 10 MB (`useDocument.ts:31`, `:66-68`, `:101-103`, `:126-128`; shown at `App.tsx:499-503`), and the backend refuses those files first (`file.rs:16`). It is a dead-code candidate (A8); list it, don't delete it.
- **Export success:** "Exported HTML to *path*" (`App.tsx:593`) puts an absolute path in primary UI (rule 30 rule 3). It becomes "Exported *name*" with the DR4 helper; the path goes to the log only.
- **Logging settings save:** `loggingService.setLoggingSettings` (`loggingService.ts:82-85`) goes through `safeInvoke`, which returns `null` on any failure (`:17-23`). The call then resolves with the requested settings, so a failed save looks saved. It calls `invoke` directly and rejects instead; the `AdvancedSettings` change is in WI-4.3.
- **Rule 32:** § Toast gains the variant contract in the same commit (DESIGN.md § Rule changes).
- **Tests** (through tdd-guardian, RED first):
  - The store, with fake timers: `info` clears after 3000 ms; `error` is still set long after; `error` after `info` cancels the pending timer; `info` after `error` replaces it and starts a timer
  - `Toast`, by role: `error` renders an alert whose "Dismiss" button clears the store; `info` renders a status with no button
  - Regression: `tests/save-blink.test.ts:106-115` expects the save rejection to pass the error variant. This test fails today.
  - `tests/preferences-save-failure.test.ts` and `tests/useUpdater.test.ts:96` assert the error variant
  - A source-inspection test, in the style of `tests/focus-trap.test.ts`, finds each `App.tsx` failure message above and asserts its call passes the error variant
  - **Regression:** opening a missing path through `handleOpenPath` shows one error toast naming the file. This test fails today. A batch of two failures through `openPaths` shows one toast with the count; an encoding failure shows none.
  - A `FileTooLarge` rejection gives "larger than 10 MB"; an unknown rejection gives no raw message in the toast
  - The export success toast contains the file name and no `/`
  - `setLoggingSettings` rejects when `invoke` rejects
- **Logging:** keep `toast.close` and add `context.variant`. Log nothing when a toast appears; each failure path already logs its own `fail` event.

### WI-4.14 — WYSIWYG follows text changed outside the editor (DR11) — M
- **Order:** right after WI-4.11, before the lanes split. It touches `App.tsx` and `MilkdownEditor.tsx`, which Lane B also edits.
- **Why:**
  - `useEditor` builds the Milkdown instance with `[activeDocumentId]` as its only dependency (`MilkdownEditor.tsx:173-203`) and reads the text once, through `defaultValueCtx` (`:188`). A store write that keeps the id never reaches the screen.
  - Reload writes that way: `handleReloadFile` (`App.tsx:606-620`) calls `replaceDocument`, which is `upsertDocument` with the same id (`useDocument.ts:155-160`). The screen keeps the old text.
  - The listener at `MilkdownEditor.tsx:245-250` writes what is on screen back to the store on the next edit. Typing after Reload therefore restores the old text plus the edit, and ⌘S saves that over the reloaded file (rule 60: data loss).
  - A WYSIWYG image drop appends to the store and expects the editor to re-render (`App.tsx:744-752`). The image stays off screen, and the next keystroke removes it from the store.
  - MCP writes already push into the live editor with `replaceAll` (`useMcpEvents.ts:135-144`). Source mode reads the store, so it is unaffected.
- **Preflight:** grep every `upsertDocument` and `updateDocumentContent` call that doesn't come from the Milkdown listener. Classify each as already pushed (MCP), to fix, or unable to change the text of an open WYSIWYG document (for example a save that only sets `path` and `isModified`). Put the table in the stop report.
- **Behavior:**
  - A store write from outside the editor reaches the live view before the next edit, following the MCP `replaceAll` pattern. Do not remount on a revision key; that loses the cursor and the undo history.
  - The push must not mark a reloaded document modified or rewrite its Markdown. Either skip the listener's write-back for that transaction, or drop a write-back whose text equals the store's (assumption — choose in preflight; Milkdown's serializer may normalize text the store kept verbatim).
  - If `replaceAll` throws, remount the editor from the store and log `fail`.
  - The logic lives in a new hook file (assumption: `src/components/Editor/useMilkdownExternalSync.ts`). `MilkdownEditor.tsx` is already 328 lines (rule 50).
- **Tests** (through tdd-guardian, RED first; the extracted hook with a fake editor, per rule 10's plugin row):
  - **Data-loss regression:** after Reload, the next editor update carries the reloaded text, not the old text. This test fails today.
  - An image drop in WYSIWYG pushes the new text into the editor.
  - The editor's own write-back does not trigger a push, so there is no loop.
  - `isModified` stays false after Reload.
  - A document switch builds the new editor once and does not also push.
- **Logging:** `editor.milkdown.external_sync` with `context.reason` (`reload`, `image_drop` or `store`), and `fail` when a push falls back to a remount.

### WI-4.16 — One IPC error contract (E17) — M
- **Order:** after WI-4.17, per the E-series fix order. It also needs WI-4.13's error-toast variant to exist.
- **Why:**
  - `commands/file.rs:69-78` returns an **externally tagged** `FileError` with 7 variants and no `rename_all`, so `PermissionDenied` arrives as `{"PermissionDenied":{"path":"/x"}}`.
  - `saveService.ts:29-42` narrows with `err instanceof Error ? err.message : String(err)`. A plain object is not an `Error`, so `String(err)` yields `"[object Object]"` and the user sees **"Save failed: [object Object]"**.
  - Precision, recorded so the tests aim at the right thing: `DiskFull` is a **unit** variant and already serializes to the string `"DiskFull"`, so not every variant is broken. And only `saveService.ts:39-40` interpolates the raw error into user-visible text — `preferencesService.ts:78` and `useUpdater.ts:51-54` toast constants, so their damage is confined to the log payload.
- **Decision (E17): keep the wire format.** Changing the Rust representation buys nothing and breaks a shipped contract.
  - The TS union for `FileError` is declared once, next to the other IPC types.
  - `fileService` normalizes every rejection into an `IpcError extends Error` carrying a `kind`, so callers narrow on `kind` and never re-parse the payload.
  - `useDocument.ts:35` moves onto it in the same commit.
- **Tests** (through tdd-guardian, RED first):
  - Parameterized over **Rust-serialized fixtures** for all 7 variants, asserting the exact toast, e.g. `"Save failed: Permission denied: /x"`.
  - **Regression:** a `PermissionDenied` rejection never produces `[object Object]`. This test fails today.
  - `tests/save-blink.test.ts:106` currently mocks a shape the backend never sends; it is replaced by a real fixture.
  - An unknown or malformed payload degrades to a generic message and logs the raw value.
- **Logging:** the normalizer logs the raw payload once, with `context.kind`; the toast keeps rule 30 rule 3 (no raw text in primary UI).

### WI-4.17 — File watcher delivers the trailing event (E18) — M
- **Order:** after WI-4.19, whose primitive the frontend listener uses.
- **Why:**
  - `file_watcher.rs:113-123` returns `is_debounced` = true and **suppresses** the event. A coalesced change is dropped, not deferred, so a rapid external change is lost outright.
  - `useFileWatcher.ts:12` adds a 3000 ms frontend suppression window and `:37` drops within it, so fixing only the frontend leaves the Rust loss in place.
  - The unconditional save blackout hides self-writes by hiding *everything* for a window of time.
- **Behavior:**
  - The unconditional blackout goes. Frontend coalescing stays.
  - Rust retains the last event of a coalesced burst and **delivers** it, preserving rename and delete information rather than collapsing every change to "modified".
  - Self-write dedup becomes its own concern, keyed on the expected content or mtime rather than on elapsed time.
  - Clearing `markSaveInProgress` in a `catch` is an emergency patch and is **not** the fix; it may still land first as a one-line stopgap.
- **Tests** (through tdd-guardian, RED first):
  - **Regression (`cargo test`):** two changes inside the debounce window deliver one event carrying the **second** change. This test fails today.
  - A delete coalesced after a modify is delivered as a delete.
  - A rename is delivered with both paths.
  - Frontend: a self-write is not reported, while a foreign write during a save still is.
- **Logging:** the watcher logs the coalesced count on delivery, so a dropped burst is visible in `~/.mdpro/mdpro.log`.

### WI-4.18 — View mode and preference persistence (E21) — M
- **Order:** after WI-4.21, per the E-series fix order, and before T11, which edits the same Rust preference types.
- **Why (a live, user-visible bug):**
  - `src/types/editor.ts:1` is `ViewMode = "wysiwyg" | "source"`. Rust's enum is `Split | EditorOnly | PreviewOnly | Wysiwyg` (`models/preferences.rs:402-409`, kebab-case).
  - `src/utils/viewModeUtils.ts` migrates `"editor-only"` → `"source"` on the **read** path and has **no inverse on the write path** — the decisive proof that the drift is one-directional.
  - `App.tsx:287-290` writes `lastViewMode` on every change, and `"source"` is reachable from the cycle order at `editorStore.ts:134` and from the View menu. So selecting Source sends an unknown enum string.
  - `preferencesService.ts:58-79` toasts a constant, "Failed to save preferences", and then **re-throws** into a `void` call.
  - **Cause, stated precisely:** the unknown enum string, *not* a missing `#[serde(default)]`. Absent `Option` fields deserialize to `None` perfectly well; `PartialPreferences.last_view_mode` (`services/preferences.rs:19`) is one.
- **Rust gains the missing shape, with backward-compatible defaults:**
  - a `Source` variant on `ViewMode`
  - `autoReformatTablesOnSave` on `MarkdownConfig`, which today has only `auto_pair` (`preferences.rs:615-619`) while TS declares both (`types/preferences.ts:293-303`)
  - `viewSource` and `viewWysiwyg` on `KeyboardShortcuts` (`types/preferences.ts:138-139`, `:213-214`), which are TS-only and silently dropped today
  - `deny_unknown_fields` is **rejected**: it would turn today's silent drop into a hard failure for every older client.
  - Note that the reverse direction is already safe: every `KeyboardShortcuts` field carries `#[serde(default = "…")]` (`preferences.rs:85-100`), so TS omitting a field is fine. Only the TS→Rust drop is real.
- **Then, and only then, type generation:** ts-rs is adopted incrementally, starting with `ViewMode` and the preferences types, so the hand-mirrored types stop drifting. Hand-declared TS is removed as each type is generated; ts-rs does not catch drift while both sides are still hand-written.
- **Tests** (through tdd-guardian, RED first):
  - **Regression:** persisting `lastViewMode: "source"` round-trips through Rust and back. This test fails today (`cargo test` plus the TS boundary test).
  - A round-trip case per `ViewMode` value, driven from the TS literal union so a new value cannot be added on one side only.
  - An older `config.json` with `"editor-only"` still loads and migrates.
  - `autoReformatTablesOnSave`, `viewSource` and `viewWysiwyg` survive a save/load cycle.
  - `tests/preferences-save-failure.test.ts` gains a `lastViewMode` case; today it only passes `showSidebar`.
- **Logging:** the preference save logs `context.field` on failure, so a rejected field is identifiable from the log alone.
