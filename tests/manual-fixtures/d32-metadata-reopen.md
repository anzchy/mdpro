# D32 device check: re-opening an unchanged file does not prompt

Run on a release bundle built from the D32 commit
([ADR-0068](../../docs/adr/0068-file-watcher-drops-metadata-and-content-events-when-the-file-is-unchanged.md)).
The user performs every click and key press; the agent only runs the shell
commands and reads the log. **Run on a copy in a scratch directory, never on
this file**: steps b and f write to the file, step e saves it, and step b
leaves a draft behind.

## Setup

- `S` = a scratch directory under `/private/tmp`, e.g. `S=/private/tmp/d32`
  (`mkdir -p "$S"`). Steps a–f use their own copy each:
  `cp tests/manual-fixtures/d32-metadata-reopen.md "$S/a.md"` (likewise
  `b.md` … `f.md`).
- Logging must be on (⌘, → Advanced).
- Before each step, mark the log: `N=$(wc -l < ~/.mdpro/mdpro.log)`. After it,
  read the new lines: `tail -n +$((N+1)) ~/.mdpro/mdpro.log | grep '"file.watch'`.
  For a quick look at the latest lines: `grep '"file.watch' ~/.mdpro/mdpro.log | tail`.
- **If a reload prompt appears that the step did not expect, click Ignore,
  never Reload or Enter** (Reload has default focus and would discard
  unsaved edits), and record the step as FAILED with its log lines.
- Wait at least 35 s after opening or writing a copy before the re-open in
  steps a–d, so the result does not depend on FSEvents' 30 s flag window
  (step e covers that window on purpose).

## a. Re-open a watched clean file from Finder / `open -a`

1. `open -a mdpro "$S/a.md"`. Expected: one `file.watch.register` line with
   `ok: true`.
2. Wait 35 s. Mark the log. Re-open it: `open -a mdpro "$S/a.md"`; then
   repeat once by double-clicking `a.md` in Finder.

   Expected: no "External change detected" prompt either time. At least one
   `file.watch.event` line with `kind: modify_metadata` (`detail: extended`
   or `any`) and `outcome: ignored_unchanged`; no `emitted_modified` line and
   no `file.change.decision` with `action: reload-prompt` for `a.md`.

## b. A recovered dirty document whose original is re-opened

1. `open -a mdpro "$S/b.md"`. Type one line in the body below without
   saving. Wait 35 s so auto-save writes a draft (`draft.write` success).
2. `pkill -9 -x mdpro`. Cold launch: `open -a mdpro`. In *Recover drafts*,
   click Recover. Expected: a `file.watch.register` line with `ok: true` for
   `b.md` (D59).
3. Wait 35 s. Mark the log. `open -a mdpro "$S/b.md"`.

   Expected: no prompt; the recovered line is still in the tab and the tab is
   still dirty. A `file.watch.event` with `outcome: ignored_unchanged`.
4. Close the tab with ⌘W and choose Don't Save.

## c. The `/tmp` path form

1. `open -a mdpro /tmp/d32/c.md` (the same directory as `S`, spelled through
   the `/tmp` symlink). Expected: `file.watch.register` with `ok: true`.
2. Wait 35 s. Mark the log. Re-open it as `open -a mdpro /private/tmp/d32/c.md`,
   then once more by double-clicking `c.md` in Finder.

   Expected: no prompt either time; `ignored_unchanged` lines (the event path
   is the `/private/tmp/...` form; the baseline is keyed by the canonical path,
   so both spellings match).

## d. Re-open a file that is already open

1. `open -a mdpro "$S/d.md"`. Open a second document (⌘N) so `d.md` is not
   the active tab, or move it to another window.
2. Wait 35 s. Mark the log. `open -a mdpro "$S/d.md"`.

   Expected: the existing tab is focused (`file.open.route` with
   `focused-tab`), no new tab or window, no prompt; `ignored_unchanged` in the
   `file.watch.event` lines.

## e. ⌘S, then re-open within 30 s

1. `open -a mdpro "$S/e.md"`. Type one character, then ⌘S. Expected: the dirty
   dot clears.
2. Within 30 s of the save (aim for 3–5 s), mark the log, then
   `open -a mdpro "$S/e.md"`.

   Expected: no prompt. The burst after the re-open may carry
   `modify_data` / `content` and `modify_metadata` / `any` as well as
   `extended`; every one of them is `ignored_unchanged` or `self_write`, none
   is `emitted_modified`.
3. Repeat step 2 once more 10–20 s after a fresh ⌘S.

## f. Positive control: a real external change still prompts

1. `open -a mdpro "$S/f.md"`. Wait 35 s. Mark the log.
2. In Terminal: `printf 'x' >> "$S/f.md"`.

   Expected: the "External change detected" prompt appears. A
   `file.watch.event` line with `outcome: emitted_modified`, then a
   `file.change.decision` with `action: reload-prompt`. Click Reload and
   confirm the tab now ends in `x`.
3. Mark the log. Re-open `f.md` with `open -a mdpro "$S/f.md"`.

   Expected: no prompt; `ignored_unchanged`. This shows the baseline advanced
   on the emitted `modified`.

## g. Out of scope: rename-over saves (D68)

An external save that writes a temporary file and renames it over the
document (`printf x > "$S/t" && mv "$S/t" "$S/f.md"`) is D68, not part of
this check; do not record its result either way as a D32 finding. (History:
when this fixture was written such a save raised no prompt and logged
`ignored_rename_single_path`. D68 was fixed in `658bc1d` (ADR-0072), the
replaced file is now checked like a content change and does raise the
prompt, and D167 (`c552974`) removed the retired outcome altogether.)

Mark every expectation you did not observe NOT VERIFIED.

## Body

D32 metadata re-open fixture. Type below this line.
