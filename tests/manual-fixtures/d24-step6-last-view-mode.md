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

## M-5: cold-start read counts (needs D24 Part B; not runnable yet)

`preferences.read` does not exist in the source yet; it lands with Part B (WI-4).
Quit mdpro, mark the log, launch with no file.

Expected as planned: exactly one `preferences.read` with `purpose:"app_hydrate"`
and one with `purpose:"view_mode_startup_settle"`, and one `window.apply_state`
for `main` with `outcome` `applied` or `maximized`. Two reads in a window with no
document is the current design; whether ADR-0032 GA-12 should say so is an open
question in the D24 row. Launched with a file: one read (`app_hydrate`) only.

## M-6: secondary windows and outside Tauri (needs D24 Part B; not runnable yet)

1. Open a second window (M-3 step 3). Expected: that window logs one
   `window.apply_state` with `outcome:"skipped"`, `reason:"not_main"`
   (this skip line exists today), and after Part B no `applied` line for it.
2. `pnpm dev` in a browser: the view switches work and nothing reaches
   `~/.mdpro/mdpro.log` (no IPC outside Tauri).

## Cleanup

`cp "$S/config.backup.json" ~/.mdpro/config.json`, then reset Default View
Mode if you changed it in the UI before the backup.
