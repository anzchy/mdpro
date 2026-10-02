---
name: gui-manual-verify
description: Run human-in-the-loop device acceptance for mdpro — Claude plans, prepares, instructs, observes and judges; the user performs the timing-sensitive or privileged actions. Use when the criteria involve MCP/curl with the server token, confirm dialogs with a 60 s timeout, typing immediately after an async event, or anything else that races Claude's tool latency. Use gui-acceptance instead when Claude can drive every step alone.
---

# GUI Manual Verify (human in the loop)

The sibling of [`gui-acceptance`](../gui-acceptance/SKILL.md). Same goal —
empirical acceptance on the shipping `.app` — but the user's hands do the parts
Claude cannot do in time or must not do at all. Claude keeps everything else:
the plan, the fixtures, the launch, the log window, the zoom, and the verdict.

The D37 / ADR-0042 device runs are the worked reference.

---

## 1. When to use

| Criterion involves… | Lane |
|---|---|
| Layout, scroll, clicks, visuals only | `gui-acceptance` |
| A gated MCP write/insert/table route (confirm prompt, 60 s timeout) | **this skill** |
| Any curl that needs the server token | **this skill** |
| Typing within ~1-2 s of an async event (write applied, reload, focus change) | **this skill** |
| Concurrent requests (queueing, FIFO, `queueDepth > 1`) | **this skill** |
| Standing config changes (`claude mcp add`, Settings toggles that persist) | **this skill** — the user runs them |

If an item needs neither the token nor fast reaction, push it back to
`gui-acceptance`; the human loop is slower and costs the user's attention.

---

## 2. Roles

**Claude** plans, prepares, instructs, observes, judges:
fixtures, launch, safe state placement, log offset, instruction block, log read,
zoom, verdict, record.

**The user** acts where Claude is too slow or not permitted:

- **Confirm dialogs.** Claude's tool round-trip is longer than the 60 s confirm
  timeout — twice a prompt ended in `408 CONFIRM_TIMEOUT` before Claude could
  click. The user clicks Approve / Reject and types any follow-up keys.
- **Anything with the token.** Claude **never** reads
  `~/Library/Application Support/mdpro/server.token`, `~/.mdpro/server.token`,
  or any other token file, and never runs token-bearing curl. The user pastes
  the [MCP guide §5](../../../docs/guide/mdpro-mcp-guide.md#5-shell-preamble)
  preamble (`MDPRO_DIR` / `PORT` / `TOKEN` / `API` + `mcurl`) into their own
  terminal tab once; the variables live only there. Nothing to install — `curl`
  and `jq` ship with macOS.
- **Standing config** (`claude mcp add`, settings files, persistent toggles).
- **Irreversible clicks** — e.g. Discard in the Recover-drafts modal (§8).

Reply to the user in the language the user writes in. This file is English;
the instruction blocks you send are not.

---

## 3. Setup

Do not duplicate — follow `gui-acceptance`:

- §2 build a bundle (`pnpm tauri build --bundles app`; never `tauri dev`).
- §3 the three stale-binary traps (installed copy, bundle older than source,
  stale running process).
- §4 launch by absolute path with the fixture argument.
- §7 log size deltas.

What differs here:

- **Build exit 1 can be benign.** `pnpm tauri build --bundles app` may exit 1
  on a missing `TAURI_SIGNING_PRIVATE_KEY` (updater artifact) *after* the
  `.app` is written. Accept it only if the `.app` mtime postdates every source
  under test (gui-acceptance §3 trap 2 script).
- **Confirm a cold launch:** `file.open.external` has `appReady:false`, the
  window label is `main`, and `/usr/bin/pgrep -fl mdpro` shows the
  `target/release/bundle` path.
- **Ask the user to start the MCP server** (Settings) and paste the §5 preamble
  once; they confirm with the `port …, token loaded (N chars)` line.
- **Every relaunch rotates the token.** mdpro writes a new `server.token` (and
  possibly a new `server.port`) at each launch, so a tab that sourced the
  preamble earlier holds a stale `$TOKEN`: every call returns
  `401 {"code":"UNAUTHORIZED"}` and nothing applies — the run is void. After
  any relaunch or rebuild, the next instruction block **starts** with the user
  re-running the `PORT` / `TOKEN` / `API` lines, then
  `mcurl "$API/api/status"`, which must return a version, not `UNAUTHORIZED`.
- **Use absolute binaries** — `/usr/bin/stat`, `/usr/bin/pgrep`. An `rtk` shell
  wrapper can mask exit codes and mangle `wc`/`ls` output.

---

## 4. The per-item loop

```
prepare → place state → blur → record offset → instruction block
        → user acts + replies → read appended log → zoom → verdict
```

1. **Prepare.** Fixture copied from `tests/manual-fixtures/` to the scratchpad; app launched on the copy; doc open.
2. **Place state** Claude can safely set: collapse a TOC node, switch tab,
   scroll. `open_application(mdpro)` and re-screenshot before any click.
3. **Blur** if the item needs the prompt path (bring the terminal forward, or
   tell the user to).
4. **Record offset:** `/usr/bin/stat -f %z ~/.mdpro/mdpro.log`.
5. **Send ONE instruction block** (§5). Then stop and wait.
6. **User acts and replies** ("好了" / "done" + where keys landed + curl output).
7. **Read only the appended bytes**, regex-filtered:

   ```bash
   node -e '
   const fs=require("fs"),p=require("os").homedir()+"/.mdpro/mdpro.log";
   const from=+process.argv[1],size=fs.statSync(p).size,fd=fs.openSync(p,"r");
   const b=Buffer.alloc(size-from);fs.readSync(fd,b,0,b.length,from);
   const re=/mcp|focus|confirm|reload|flush|degrade|"level":"(warn|error)"|window\.(focus|blur)/;
   for(const l of b.toString("utf8").split("\n")) if(re.test(l)) console.log(l);
   ' <OFFSET>
   ```

8. **Zoom** the region (editor line, TOC, dialog). `open_application(mdpro)`
   first; never judge from a zoom taken before the app was in front.
9. **Verdict** row (§9). Re-check before any FAIL (§8).

Order matters in steps 2-4: **place state → blur → record offset → send.** A
stray focus change after the offset confounds the run.

---

## 5. Instruction-block template

One block per item. Every block has: goal (one line), numbered steps with
exact copy-paste commands, an unambiguous click target, what to type, what
NOT to do, what to reply, and the expected result **stated up front**.

Click targets must be character-exact. "After the T of TARGET" was ambiguous
(two T's); write "after the whole word TARGET, between the last T and the
colon: `TARGET|:`".

Worked example: D37 item 6, a caret inside a rewritten region. This is the
block as it was actually run on 2026-10-01. It uses the **prompt path**. The
user writes Chinese, so the real block was in Chinese.

````
Goal: when a write rewrites the paragraph holding the caret, the caret lands
at the start of the rewritten region (ADR-0044).
Expected: `zzz|Brand new 3rd line!`; focus.restore restored, anchor diff.

1. In mdpro, click after the word "Third" in "Third paragraph REJECT ME."
   (between the d and the space).
2. ⌘Tab to your terminal. mdpro must be unfocused so the confirm dialog
   appears. Paste:

   DOC=642df2b1f573fbb3
   NEW=$(mcurl "$API/api/documents/$DOC" | jq -r .content | sed 's/Third paragraph REJECT ME\./Brand new 3rd line!/')
   mcurl -X POST "$API/api/documents/$DOC" -d "$(jq -n --arg c "$NEW" '{content:$c}')"

3. When mdpro shows the confirm dialog, click Approve, then type zzz at once.
   Do not click the editor body.
4. Reply "好了" and say where zzz landed.
````

The replacement shares no prefix or suffix with the original, so the whole
paragraph is one rewritten region and the expected caret is unambiguous. The
user's IME typed lowercase `zzz`, which was harmless. Tell the user to switch
to an English input method before a typing step.

---

## 6. Focus and confirm-prompt recipes (ADR-0042)

A gated write/insert prompts **only if the owning window is unfocused at
request time.** Design every step around that.

| Want | Recipe |
|---|---|
| No prompt (applies immediately) | `sleep 8; mcurl …` — user ⌘Tabs to mdpro within the sleep |
| Prompt → Approve / Reject | User stays in the terminal, runs `mcurl …` directly, then clicks the button in mdpro |
| Timeout (408) | User runs it and does nothing for 60 s |
| Cancelled (503) | User closes the window / quits while the prompt is up |
| True queueing (`queueDepth > 1`) | Concurrent curl from the user's shell: `mcurl … & mcurl … & wait` |

- **AI MCP clients serialize parallel tool calls** — `queueDepth` stayed at 1.
  Queueing criteria need the `& … & wait` form.
- **Unplanned focus changes confound runs.** An early caret-placing click, or a
  user click on mdpro, produced a no-prompt write when a prompt was expected.
  Check `window.focus` / `window.blur` lines in the byte window before trusting
  the outcome.
- Use the Reject **button**; Escape did not reject on device (D34).

---

## 7. Fixtures

- **Originals in `tests/manual-fixtures/`, runs on a scratchpad copy** (same as gui-acceptance §5).
- **Self-verifying:** each paragraph labelled ("Third paragraph REJECT ME."),
  so a zoom answers "what changed" without counting.
- **Rewrite tests:** replacement text shares no prefix or suffix with the old
  text, so the diff region is unambiguous (`REJECT ME.` → `Brand new 3rd line!`).
- **Check degrade guards before sizing.** A 9.5 MB doc with ~160k structural
  elements was forced to Source by `editor.large_document.degrade` (structure
  threshold 25,000) and never exercised WYSIWYG; 10k long paragraphs (~9.3 MB)
  stayed WYSIWYG. After opening any fixture, grep the byte window for
  `degrade` / `view.mode.change`.

---

## 8. Pitfalls

- **Clicking with another app in front** fails ("X is not in the allowed
  applications") or lands in a different window, and an older zoom then
  misleads. Always `open_application(mdpro)` → screenshot → click.
- **The user's own activity** (Warp, Finder) can come forward at any moment.
  If Claude would be racing the user, hand that action to the user.
- **Re-check before a FAIL.** The TOC lagged 1-2 s after a tab switch and
  briefly showed the previous document. Wait ~2 s, zoom again, then record.
- **Relaunch leaves a Recover-drafts modal.** Killing the app before a rebuild
  leaves drafts; Discard is irreversible, so the **user** clicks it — even for
  test fixtures.
- **Absence claims** ("no `focus.restore` line", "0 errors") are valid only
  inside a recorded byte window.

---

## 9. Evidence and verdict table

One row per criterion; verdict is `PASS` / `FAIL` / `PARTIAL` / `NOT VERIFIED`,
with log evidence: timestamps and the key context fields (`outcome`, `anchor`,
`durationMs`, `waitedMs`, `queueDepth`).

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
Real rows from the D37 run (2026-10-01, release build of `66cb742`):

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 4 | Reject, then type: caret unchanged | PASS | 08:35:00 `ui.mcp_confirm.reject`, `outcome:rejected waitedMs:4445`, curl 403; doc unchanged |
| 5 | Queued prompts: keys land visibly | PASS — D38 observed | 08:44:39 `queueDepth` 1, 2; 1st approve `skipped:focus-elsewhere`; 2nd `focus_return` fallback, then `restored anchor:diff durationMs:1` |
| 6 | Caret inside rewritten region → region start | PASS | 08:59:02 `approved waitedMs:4583`, reload gen 11, `restored anchor:diff durationMs:0`; zoom `zzz\|Brand new 3rd line!` |
| 7 | Non-focusable click: no carry | PASS | 2 runs, reload gen 12/13, **no** `focus.restore` line in the byte window, 0 warn/error |
| 8 | ~10 MB doc: restore cost and TTL | PASS | 9,318,971 B stayed WYSIWYG; `durationMs:8`; restore 2.9 s after reload (TTL 10 s) |
| — | Retained heap (D12) | NOT VERIFIED | not observable on device; evidence is `pnpm perf:d12` plus unit tests |

- A PASS that shows a **known recorded limit** says so ("PASS — D38 observed").
- **Not observable on device** (heap retention, timing-dependent parser races)
  is `NOT VERIFIED`, naming where the evidence lives instead.
- **Criteria come from the original plan's device-verification WI; the
  original plan wins.** A run that covers part of another WI's gate does not
  close that gate. An ADR was nearly accepted early because one check's device
  run was counted toward a different six-criterion WI.

---

## 10. Recording

Same rules as gui-acceptance §10 and CLAUDE.md:

- Sequencing-doc row and `docs/feature-ledger.md` row are updated **in the
  commit that closes the item**; `pnpm ledger:check` passes.
- ADR status follows the plan's stated precondition — not this run's mood.
- **Commits need the user's explicit approval.**
- **When a peer Claude session owns the commit:** send it the verdict table,
  then verify its SHA (`git show --stat`, the diff, `pnpm ledger:check`)
  before any fast-forward.
- Never commit screenshots or fixtures.

---

## Checklist

```
[ ] Item genuinely needs a human (token, 60 s prompt, fast typing, concurrency) (§1)
[ ] Bundle built and fresh; exit 1 only from the signing key (§3, gui-acceptance §2-§3)
[ ] Cold launch confirmed: appReady:false, label main, pgrep bundle path (§3)
[ ] User started the MCP server and pasted the guide §5 preamble; Claude read no token
[ ] After any relaunch: user re-ran PORT/TOKEN/API; /api/status returns a version (§3)
[ ] Fixture copied from tests/manual-fixtures/ to scratchpad, self-verifying, degrade guard checked (§7)
[ ] Order: place state → blur → record offset → send block (§4)
[ ] Block has goal, exact commands, char-exact click target, don'ts, reply, expected (§5)
[ ] Focus recipe matches the path under test (§6)
[ ] Read only appended bytes, regex-filtered; zoomed after open_application (§4, §8)
[ ] Re-checked after ~2 s before any FAIL (§8)
[ ] Verdict table with log fields; NOT VERIFIED rows honest; original plan's WI wins (§9)
[ ] Plan + ledger rows in the closing commit; user approved the commit (§10)
```
