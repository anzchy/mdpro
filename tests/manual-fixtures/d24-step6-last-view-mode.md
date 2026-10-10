# D24 step 6 device check: only explicit view commands save the view mode

ADR-0053. The user performs every click and key press; the agent only runs
the shell commands and reads the log. Run on copies, never on this file:
a run can save the document, and a draft can outlive it.

## Setup

- `S` = your scratchpad directory. `cp tests/manual-fixtures/d24-step6-last-view-mode.md "$S/small.md"`
  and `cp "$S/small.md" "$S/small2.md"`.
- Large document (not committed). The WYSIWYG guard degrades when the
  structure score (newlines + non-leading `|`) is above 25,000
  (`LARGE_DOCUMENT_STRUCTURE_THRESHOLD`, `src/utils/largeDocumentGuard.ts`).
  30,000 lines is enough, about 330 KB:
  `seq 1 30000 | sed 's/^/Line /' > "$S/big.md"`
- Back up the config: `cp ~/.mdpro/config.json "$S/config.backup.json"`.
  Restore it byte for byte when done.
- Logging must be on (⌘, → Advanced). Frontend events are dropped when it is off.
- ⌘, → General → Default View Mode = **WYSIWYG**.
- Before each scenario, mark the log: `N=$(wc -l < ~/.mdpro/mdpro.log)`.
  Read only the new lines: `tail -n +$((N+1)) ~/.mdpro/mdpro.log | jq -c '<filter>'`.

Filters (event names checked against the source):

```
# every view switch, with who asked for it
select(.event=="view.mode.change") | .context
# expect {"fromMode":…,"toMode":…,"source":"setViewMode"|"cycleViewMode","intent":"user"|"programmatic"}

# preference writes (Rust; one start + one success per write)
select(.event=="preferences.set") | {status, context}

# the persistence hook's settle reason
select(.event=="preferences.last_view_mode") | .context

# the large-document degrade
select(.event=="editor.large_document.degrade") | .context.trigger
```

**`preferences.set` does not say which key it wrote** (context is only
`{"partial":true}`), and opening a file also writes `recentFiles`. So the
judge for `lastViewMode` is the disk value, `jq .lastViewMode ~/.mdpro/config.json`,
read before and after each scenario. The `preferences.set` count is a
cross-check against a control.

## M-1: explicit commands write once each

Open `small.md`. Press ⌃4 if the window is not in WYSIWYG, and check disk is
`wysiwyg`; then mark the log.

1. ⌃2. 2. ⌃4. 3. ⌃4 again (already WYSIWYG). 4. View → Cycle View Mode.
5. With the cursor in the Source editor, ⌘/.

Expected:
- `view.mode.change`: 4 lines, all `intent:"user"` (step 3 changes nothing, so it logs nothing).
- `preferences.set`: 4 start/success pairs, one per mode change. Step 3 adds none (D-3: it counts as a choice, but the value already matches).
- Disk after each step: `source`, `wysiwyg`, `wysiwyg`, `source`, `wysiwyg`.

## M-2: the large-document degrade does not write

Start in WYSIWYG with disk `lastViewMode` = `wysiwyg`.

1. Control: mark the log, ⌘O `small2.md`, count `preferences.set` success lines = K.
2. Mark the log, ⌘O `big.md`.

Expected: the "too complex for WYSIWYG" toast; one `editor.large_document.degrade`
with trigger `structure`; one `view.mode.change` `wysiwyg`→`source` with
`intent:"programmatic"`; `preferences.set` success lines = K (the recent-files
write only); disk still `wysiwyg`. Before the fix, disk became `source`.

## M-3: drop, Finder open and `?open=` do not write

Close all documents. ⌃2 so the disk holds `source` (Default View Mode stays
WYSIWYG, so each open below resets the window to WYSIWYG).

1. Drag `small.md` from Finder onto the window.
2. Close it (closing the last document re-applies the stored `source`), then
   with the window empty run `open -a mdpro "$S/small2.md"`.
3. With a document open, run `open -a mdpro "$S/small.md"` for a file not already open, so it opens in a new window (`?open=`).

Expected after each: disk still `source`. Step 1 logs one
`view.mode.change` `source`→`wysiwyg` with `intent:"programmatic"`. Step 2
logs two, both `intent:"programmatic"`: `wysiwyg`→`source` when the close
re-applies the stored mode, then `source`→`wysiwyg` from the open. No
`view.mode.change` line has `intent:"user"`. `preferences.set` success lines
match a plain ⌘O of a small file (the recent-files write). If step 2 opens a
new window instead of the empty one, record that; it is still a programmatic
path and the disk must still not change.

## M-4: a user switch survives a degrade and a relaunch

1. In an empty window: ⌃2, then ⌃4. Disk = `wysiwyg`.
2. ⌘O `big.md` (degrades to Source).
3. ⌘Q with `big.md` still open.
4. Relaunch mdpro with no file.

Expected: the empty window opens in **WYSIWYG**; one
`preferences.last_view_mode` with `reason:"read_applied"`; disk `wysiwyg`
throughout. Before the fix the relaunch opened in Source.

## M-5: cold-start read counts (ADR-0032 GA-12)

D24 Part B logs one `preferences.read` per frontend preference read, with an
enum `purpose` and `outcome` (`ok`, or `failed` with `reason:"invoke_rejected"`),
and one `window.apply_state` per hydration apply. Log lines carry no window
label, so run each case with only the windows it names. Do not open Settings
during these cases: each Settings page does its own `settings_*` read.

Filters:

```
# every preference read, in order
select(.event=="preferences.read") | .context.purpose
# with the outcome, to spot a failed read
select(.event=="preferences.read") | .context
# the hydration apply of the window geometry
select(.event=="window.apply_state") | {level, status, context}
```

1. **Cold start with no document.** Quit mdpro, mark the log, launch with no
   file (`open -a mdpro`). Expected: `preferences.read` purposes are exactly
   `"app_hydrate"` and `"view_mode_startup_settle"` (2 lines, both
   `outcome:"ok"`); `window.apply_state` is exactly 1 line, `context.outcome`
   `"applied"` (with `monitor` `"reported"` or `"absent"`) or `"maximized"`.
   The second read is by design (PRL-05, the GA-12 wording the user accepted
   on 2026-10-07); a third read, or a `failed` / `skipped` apply, fails.
2. **Launched with a file.** Quit mdpro, mark the log,
   `open -a mdpro "$S/small.md"`. Expected: `preferences.read` purposes are
   exactly `"app_hydrate"` (1 line, no `view_mode_startup_settle`);
   `window.apply_state` 1 line, `applied` or `maximized`.
3. **Closing the last document.** With only `small.md` open in one window,
   mark the log, ⌘W. Expected: `preferences.read` purposes are exactly
   `"view_mode_restore_on_close"` (1 line); no `window.apply_state` line.

## M-6: secondary windows and outside Tauri

1. Open a second window (M-3 step 3, `?open=`). Expected for that window:
   one `preferences.read` `"app_hydrate"`, and either zero or one
   `"view_mode_startup_settle"` (it depends on whether the document lands
   before the window settles, which races the 300 ms `?open=` retry; record
   which); one `window.apply_state` with `context` exactly
   `{"outcome":"skipped","reason":"not_main"}`, and no `applied` or
   `maximized` line from it.
2. ⌘⇧N with a document already open in `main`: one `"app_hydrate"` and one
   `"view_mode_startup_settle"` read, and one `skipped` / `not_main` apply.
3. `pnpm dev` in a browser: the view switches work and nothing reaches
   `~/.mdpro/mdpro.log` (no IPC outside Tauri; the browser branch of
   `getPreferences` does not log).

## Cleanup

`cp "$S/config.backup.json" ~/.mdpro/config.json`, then reset Default View
Mode if you changed it in the UI before the backup.
