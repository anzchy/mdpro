# D19 WI-6 — Save does not clobber edits made during the save: GUI acceptance (2026-09-23)

This run is the GUI acceptance for plan `.claude/tdd-guardian/plan-20260922-232521-d19.md` § WI-6.
It was driven through `/gui-acceptance` (computer use) on the release bundle.

The evidence is **byte-offset log slices** from `~/.mdpro/mdpro.log`, plus `od -c` of the saved files and
zoomed captures of the tab bar and editor. No screenshots were kept.

## Binary under test

| Field | Value |
|---|---|
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, mtime 2026-09-23 00:39:58 (+08), working tree at `9c7abbc` plus uncommitted D19 changes |
| `Contents/MacOS/tauri-app` sha256 | `d82c0aab4b6c9ab79e226dd35f0dd4068303dce468531e86b913f04db4e63492` |
| Freshness (§3 trap 2) | Bundle mtime is later than `src/services/saveService.ts` (00:36:38), `src/utils/saveResult.ts` (00:08:53) and `src/hooks/useDocument.ts` (00:27:32) |
| Cold launch (§3 trap 3) | PID 68055, started 00:42:30 from the `target/release/bundle` path, no instance already running. Log: `app.launch` → `mcp.http_server.start` → `window.open {windowId:"main"}` → `app.ready`. There is no `file.open.external` line because the app was launched without a file argument. |
| Note | The build's exit 1 was the updater-signing step only. `/Applications/mdpro.app` was not used. |

- **Log offset before interacting:** 3 852 129 B. The final size was 3 893 777 B.
- **Fixtures:** everything is under `~/mdpro-repro/`:
  - `d19-src.md` and `d19-wys.md`, both created by this run.
  - `d19-table.md`, restored to its original bytes afterwards.

## Probe: can an edit land while the Save As panel is open?

**No. The NSSavePanel is app-modal.**

- In both Source and WYSIWYG, a click on the editor while the panel was open did not move focus.
- `beta` was typed into the panel's **Save As** field instead, giving `Untitled.mdbeta` and then `d19-src.mdbeta`. The WYSIWYG run replaced the name with `beta.md`.
- The editor kept showing `alpha` every time.

**MCP write during the panel: not performed.** The `POST /api/documents/{id}` probe needs `~/.mdpro/server.token`. This session's tool permission layer denied reading it, and I did not bypass the denial. So it is **not established** whether an MCP write can land while the panel is open.

**Consequence:** the planned Save As scenario, where `beta` lands during the dialog, **could not be reached by hand**. Each Save As therefore exercised the plain *applied* outcome.

**The edited-during-save outcome *was* reached** on a later ⌘S of an already-saved file, the no-dialog path. A keystroke typed immediately after ⌘S, in the same input batch, landed while the save was in flight. See the auto-reformat section.

**Harness note:** on this machine ⌘⇧G is bound to an Alfred hotkey. That hotkey opened an Alfred window, invisible to the capture tool, over the panel. It was dismissed by clicking outside it. The folder was then chosen by typing `/` into the Save As field, which opens the panel's own Go-to sheet.

## Steps and evidence

| # | Mode | Action | Observed |
|---|---|---|---|
| S1 | Source | ⌘N, ⌃2, type `alpha`, ⌘S → Save As panel. Click the editor, type `beta` (it went to the panel). Set name `d19-src.md` in `~/mdpro-repro`, Save. | Tab `d19-src.md`, **clean** (no dot), "Saved" toast. Editor `alpha`. File = `alpha` (5 B). `file.save` success 5 B, no `editedDuringSave`. |
| S2 | Source | Type `beta`, then ⌘S. | Dot shown before the save. **No second dialog.** Dot cleared. Editor `alphabeta`. File = `alphabeta` (9 B). |
| W1 | WYSIWYG | ⌘N, ⌃4, type `alpha`, ⌘S → panel. Click the editor, type `beta` (it went to the panel). Name `d19-wys.md`, Save. | Tab `d19-wys.md`, clean. File 6 B (`alpha\n`; the WYSIWYG serializer adds the trailing LF). `editor.milkdown.flush reason:"save-settle" outcome:"clean"` logged after the IPC. |
| W2 | WYSIWYG | Type `beta` at the end, then ⌘S. | Dot shown before the save. No second dialog. Dot cleared. File = `alphabeta\n` (10 B). `save-settle` flush logged again. |
| T1 | Source | Settings → Markdown: tick **Auto-Reformat Tables on Save**. `open -a <bundle> ~/mdpro-repro/d19-table.md` opened it in a second window (`appReady:true`, as expected with the app already running). ⌃2, append ` edit` to `body`. | Dirty dot. |
| T2 | Source | **⌘S, then `Z` typed immediately.** | Editor `body editZ`, **dirty dot kept**. File = the table **unformatted** plus `body edit`, **without** `Z` (56 B). Log: `file.save` success 56 B, then `file.save {documentId, editedDuringSave:true}` 13 ms later. **No** `editor.table.auto-reformat-on-save` line. |
| T3 | Source | ⌘S again. | Dot cleared. File ends `body editZ\n` (57 B). The table is still unformatted. |

Log slice from 3 852 129:

- `editedDuringSave:true`: exactly **1**, the T2 save.
- `closedDuringSave`: **0**.
- Every other `file.save` is a plain start/success pair.
- The periodic `file.write` lines are draft autosaves from `commands/draft.rs`, not writes to the real file. That includes the one at 00:49:38 that preceded T2.

**No document content appears in the log.**
- `alphabeta`, `body edit` and `editZ` are absent.
- The only `ccc` hit is inside a UUID (`…8cccb8`).
- Contexts carry only ids, paths, byte counts, and flags.

## Auto-reformat preference does not persist (pre-existing defect)

The checkbox showed ticked, but nothing was persisted:

- No `preferences.set` line was logged.
- `~/.mdpro/config.json` kept its 2026-09-22 20:18 mtime, and its `markdown` object is still `{"autoPair":true}`.
- Settings opened fresh in a new window shows the box **unticked**.

**Code read (corrected 2026-09-23).** The first reading of this run blamed the
missing serde field alone. That is a real defect but it is the *second* one, and
it is not what the observations above show. There are two, and the outer one
makes the inner one unobservable:

1. **The Tauri detector never fires, so `preferencesService` never does IPC at
   all.** `src/services/preferencesService.ts:20-25` gates every call on
   `"__TAURI__" in window`, but Tauri v2 injects `window.__TAURI__` only when
   `withGlobalTauri` is enabled, and it is **absent from
   `src-tauri/tauri.conf.json`**. The app itself detects Tauri the other way —
   `src/main.tsx:9` tests `__TAURI_INTERNALS__`, which is what v2 actually
   provides. So in the shipping app `isTauriEnv()` is always false,
   `preferencesService` silently takes its browser-mode path, and no preference
   write ever reaches Rust. **This is why there was no `preferences.set` line:
   nothing was sent.** It is not specific to this checkbox — it disables
   preference persistence across the service.

   This is already known in the codebase: `src/services/loggingService.ts:113-118`
   documents the same detector defect and exists to route around it, reading
   logging settings through `safeInvoke` precisely because
   `preferencesService.getPreferences()` cannot be trusted to reach the backend.

2. **`MarkdownConfig` has no field to persist into.**
   `src-tauri/src/models/preferences.rs:616` carries only `auto_pair`, so
   `autoReformatTablesOnSave` could not survive a `get_preferences` round trip
   even once defect 1 is fixed, and `useDocument.ts:219`
   `prefs.markdown?.autoReformatTablesOnSave` would stay falsy.

Fixing either alone leaves the checkbox dead. Defect 1 is the one that hides the
evidence, which is why this run could not see past it.

**Restoring the setting:** the persisted setting was never on, so nothing needed turning off. The Settings dialog in the first window still showed the stale local tick when the run ended.

## Verdict

| # | Criterion (WI-6) | Result |
|---|---|---|
| 1 | Edit typed while the Save As panel is open lands in the editor, and the file gets only the pre-dialog snapshot | **NOT VERIFIED.** The panel is app-modal, so keystrokes go to the panel in both Source and WYSIWYG. The MCP-write-during-panel fallback was blocked by the tool permission layer (token read denied), so whether the panel window is reachable by MCP is not established. |
| 2 | Edited during save: dirty dot kept, editor keeps the edit, disk has the snapshot only | **pass**, on the no-dialog ⌘S path (T2, Source). Editor `…editZ` stayed dirty; disk had `…edit` without `Z`. **Not observed in WYSIWYG**, where no in-flight edit was attempted. |
| 3 | Second ⌘S: no dialog, dot clears, disk has the full text | **pass**: S2 and W2 (`alphabeta`), and T3 (`…editZ`). |
| 4 | One `file.save` with `editedDuringSave:true`, and no content in the log | **pass**: exactly one `editedDuringSave:true` (T2), and no document text in the slice. |
| 5 | Applied save (no concurrent edit): clean, and the path is adopted | **pass**: S1 and W1 (untitled → path, dot cleared). |
| 6a | Auto-reformat, in-flight: disk = formatted table, editor keeps the edit and stays dirty | **NOT VERIFIED; blocked by a pre-existing defect.** An in-flight edit *was* reached (T2), but the preference never takes effect: `preferencesService` never reaches Rust at all (detector defect), and `MarkdownConfig` has no field to hold it either. Nothing is formatted. The editor-keeps-edit half passed, but the "disk = formatted" half cannot hold. |
| 6b | Auto-reformat, plain applied: disk and editor both formatted, clean | **NOT VERIFIED**, for the same defect. T3 saved clean but unformatted. |
| 7 | Close during save | **Not GUI-tested.** With an untitled document the Save As panel is app-modal, so a close cannot be issued during it. For a titled document the IPC completes in about 15–20 ms, too fast to close by hand. `closedDuringSave` count = 0. |
| — | Both themes (rule 34) | Not exercised; this was a behavioural run in the dark theme only. |

### Follow-ups (not fixed here)

1. **Preference persistence is dead in the Tauri app** — broader than this one
   checkbox, and it needs both fixes plus a decision recorded as an ADR:
   - Correct `preferencesService.isTauriEnv()` to test `__TAURI_INTERNALS__`
     (matching `main.tsx`), **or** enable `withGlobalTauri` — these are different
     trade-offs, not interchangeable, and the choice constrains later work.
   - Add `auto_reformat_tables_on_save` to the Rust `MarkdownConfig` (serde
     default `false`) with a round-trip test.
   - Then re-run 6a/6b. Both are bug fixes, so each needs a regression test that
     fails without it. Note that no existing test caught defect 1, because the
     unit lane runs under jsdom where the detector is *supposed* to report
     browser mode — a test asserting the shipping-app path is the gap.
2. **MCP-during-panel probe:** re-run with token access allowed, to settle criterion 1's fallback.
