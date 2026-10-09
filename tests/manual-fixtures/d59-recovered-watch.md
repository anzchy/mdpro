# D59 device check: a recovered document is watched

Run on a release bundle. The user performs every click and key press; the
agent only runs the shell commands and reads the log. Run on a copy, never on
this file: the check kills mdpro with a dirty document, so a draft outlives
the run, and an external write changes the file.

## Setup

- `S` = your scratchpad directory. `cp tests/manual-fixtures/d59-recovered-watch.md "$S/d59.md"`,
  then open the copy: `open -a mdpro "$S/d59.md"`. Use the path exactly as
  printed by `echo "$S/d59.md"` in the log filters below.
- Logging must be on (⌘, → Advanced).
- Before each step, mark the log: `N=$(wc -l < ~/.mdpro/mdpro.log)`. After it,
  read the new lines: `tail -n +$((N+1)) ~/.mdpro/mdpro.log | jq -c 'select(.event | test("file.watch|file.change|file.draft"))'`.
- **Do not `open -a` the copy again once it is recovered.** That is the D32
  trigger: it raises a false reload prompt, and Reload has default focus, so
  Enter would discard the recovered edit. If a prompt appears that the step
  did not cause, click Ignore and record it under D32.

## G59: Recover → watched → external change prompts → close unregisters

1. Type one line in the body below, without saving. Wait 35 s so the
   auto-save writes a draft (`draft.write` success in the log).
2. In Terminal: `pkill -9 -x mdpro`.
3. Cold launch: `open -a mdpro`. The *Recover drafts* dialog lists the copy.
   Click Recover.

   Expected: one `file.watch.register` line with `ok: true`, `path` equal to
   the copy's path, `alreadyWatched: false`. Before D59 there was none.
4. In Terminal: `printf '\nexternal\n' >> "$S/d59.md"`.

   Expected: a `file.watch.event` line with `outcome: emitted_modified`, then a
   `file.change.decision` line, and the "External change detected" prompt.
   Click **Ignore** (Reload would replace the recovered edit with the disk text).
5. Close the tab with ⌘W and choose Don't Save.

   Expected: one `file.watch.unregister` line with `ok: true`, and
   `watchedCount` back to what it was before step 3.

Mark every expectation you did not observe NOT VERIFIED.

## Body

Recovered-watch fixture. Type below this line.
