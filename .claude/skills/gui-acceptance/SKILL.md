---
name: gui-acceptance
description: Run empirical GUI acceptance QA for mdpro by driving the real app with computer use. Use when a work item's acceptance criteria are geometric, visual, or scroll/pointer-driven and therefore cannot be proven by vitest under jsdom. Covers the mandatory build-a-bundle prerequisite, launch, evidence capture, and the verdict table.
---

# GUI Acceptance (computer use)

Empirical acceptance testing of mdpro by driving the shipping app on the real
desktop. This is the lane of last resort: it is slow, it is manual, and it puts
the user's personal desktop on screen. Use it only for obligations the automated
lanes provably cannot discharge.

WI-7 of the Source-mode scroll-spy plan is the worked reference throughout, and
the trial-and-error that produced this document is recorded in §8.

---

## 1. When this lane is the right one

Use it when the acceptance criterion depends on something jsdom does not have:

| jsdom has no… | so you cannot test… |
|---|---|
| layout or element heights | scroll spy, sticky headers, overflow, viewport maths |
| `getClientRects` / `getBoundingClientRect` geometry | anything calling `posAtCoords`, `coordsAtPos`, `lineBlockAtHeight` |
| `IntersectionObserver` | visibility-driven highlighting |
| `scrollIntoView` | click-to-navigate landing position |
| a compositor | theme rendering, focus rings, z-index, real paint |

**This repo has no integration lane and no e2e lane.** There is nothing between
the vitest unit lane and a human looking at the screen. That gap is exactly what
this skill fills — and it is why geometry modules carry an explicit "unmet
integration obligation, discharged by manual QA" note in their headers.

**Do not use it** for anything a pure function can decide. If the behaviour can
be expressed in terms of line numbers, keys, or ranges, push it into a pure
module and unit-test it. Manual QA is for confirming that the geometry feeding
those pure functions is real.

---

## 2. The prerequisite that blocks everything: build a bundle

> **`pnpm tauri dev` does not work with computer use. Neither does `pnpm dev`.
> You must build a `.app` bundle first.**

This is not a preference. It is a hard structural block, and it cost a full
session to diagnose.

### Why

macOS computer-use grants are keyed by **bundle identifier**, not by executable
path. The dev target is a bare Mach-O executable:

```
src-tauri/target/debug/tauri-app        # a FILE, not a directory
```

It has no `Contents/Info.plist` and therefore no `CFBundleIdentifier`. The
consequences, in order:

1. `request_access(["tauri-app"])` returns **`notInstalled`**.
2. Because no grant can attach, the screen compositor **filters the window out
   of screenshots entirely** — you do not get a blocked click, you get a
   desktop with no app on it.
3. There is no workaround at the tool level. Nothing you pass to
   `request_access` will match an executable that has no identity.

A built bundle does have one:

```
src-tauri/target/release/bundle/macos/mdpro.app   # a DIRECTORY
  Contents/Info.plist → CFBundleIdentifier = com.mdpro.app
```

`com.mdpro.app` matches the grant the user has already approved, at tier
**full** (mdpro is not a browser and not a terminal, so clicks, typing, and
scrolling all work).

### How

```bash
# Fastest path: bundle only the .app, skip the DMG.
pnpm tauri build --bundles app
# → src-tauri/target/release/bundle/macos/mdpro.app
```

Run it in the background; a cold release build takes minutes.

A `--debug --bundles app` build also carries the bundle id and keeps DevTools,
which is preferable when you need the web inspector. WI-7 was executed against
the **release** bundle, so that is the path this document verifies; if you use
the debug bundle, say so in the QA record, because it is a different binary.

---

## 3. Verify you are testing the code you think you are

Three traps, all of which have actually fired in this repo. Trap 3 is the
expensive one: it produced a **false FAIL** that was reported to the user before
being retracted.

### Trap 1 — the stale installed copy

```
/Applications/mdpro.app     mtime 2026-05-04     ← four months old
```

`request_access(["mdpro"])` may resolve to **this** rather than your fresh
build. They share a bundle id, so the grant works perfectly and you test
four-month-old code while believing you tested your branch.

### Trap 2 — a bundle older than the source

Always prove the bundle postdates every file under test:

```bash
node -e '
const fs=require("fs");
const app="src-tauri/target/release/bundle/macos/mdpro.app";
const sources=["src/hooks/useSourceScrollSpy.ts","src/utils/tocLineSpy.ts","src/hooks/useTOC.ts"];
const b=fs.statSync(app).mtime;
console.log("bundle  "+b.toISOString());
let ok=true;
for(const s of sources){ const m=fs.statSync(s).mtime; const fresh=m<b;
  ok=ok&&fresh; console.log((fresh?"OK   ":"STALE")+" "+m.toISOString()+"  "+s); }
console.log(ok?"BUNDLE IS FRESH":"REBUILD REQUIRED");
'
```

List *every* source file whose behaviour the criteria touch, not just the one
you edited.

### Trap 3 — the stale *process*, which `ps` cannot see

**Replacing the binary on disk does not replace the binary that is running.**
macOS single-instance handling routes `open -a <path> <file>` into an
**already-running** instance, so a process launched before your rebuild keeps
executing the **old image** while serving your fresh fixture.

`ps -Ao pid,lstart,comm` does **not** catch this. It reports the executable
*path*, and the path is correct — the file at that path was simply overwritten
underneath the running process. §4's `ps` check passes while you test dead code.

The log signature, which is the only reliable tell at launch time:

```
file.open.external  { "appReady": true, … }     ← an instance was ALREADY up
window.open         { "windowId": "mdpro-<uuid>" }
window.blur         { "windowId": "main" }      ← the pre-existing window
```

A genuine cold launch has `appReady: false` and takes the window label `main`.

**Mitigation — kill before you build, not after:**

```bash
pkill -f 'bundle/macos/mdpro.app/Contents/MacOS/tauri-app' ; sleep 1
pnpm tauri build --bundles app
```

This cost a full QA run on 2026-09-20. Run 1 of the WI-6 sweep reproduced the
pre-fix defect perfectly against what was believed to be the fixed build, and
**`QA-A FAILS` was reported to the user** before the log window was read and the
run was identified as a clean control of the old code.

### Do NOT try to verify freshness by searching the binary

`strings`/`grep` against `Contents/MacOS/tauri-app` for a symbol you just added
returns **absent even when it is present**. Tauri embeds the frontend assets
*compressed* inside the Mach-O, so no frontend identifier is findable. The
bundle directory holds only four files and none of them is your JS.

Two checks that do work:

1. **Disk**: grep the built asset, not the binary —
   `dist/assets/*.js` contains your symbol, and its mtime must predate the
   bundle's.
2. **Running image** (the stronger one): have the build under test emit
   something the previous build could not. A temporary diagnostic log event is
   ideal — if its line appears in `~/.mdpro/mdpro.log`, the *running process* is
   provably your build. This is the only check that closes Trap 3, because it
   interrogates the image rather than the filesystem.

Remove the diagnostic and re-run before recording any log-volume criterion —
per-sample instrumentation makes a "nothing is logged per scroll" claim
unprovable. See §7.

---

## 4. Launch

Launch the fresh bundle **by absolute path**, and hand it the fixture on the
command line. This also sidesteps the native file dialog, which `rfd` renders
as a blocking modal that is tedious to drive:

```bash
open -a "$PWD/src-tauri/target/release/bundle/macos/mdpro.app" \
     "$SCRATCHPAD/wi36-duplicate-headings.md"
```

Then confirm the running process is the one you built — not the installed copy,
not a leftover from a previous run:

```bash
ps -Ao pid,lstart,comm | grep -i mdpro | grep -v grep
```

The `comm` column must show the `target/release/bundle` path. Kill strays
first; a previous `pnpm tauri dev` and the installed app can both leave
`mdpro_mcp` sidecars behind.

---

## 5. Fixtures

The originals live in the repo at `tests/manual-fixtures/` (see CLAUDE.md §
"Manual test fixtures"), named `<id>-<slug>.md`. **Launch the app on a copy in
the scratchpad, never on the original**: a run edits the document, ⌘S writes it,
and a draft can outlive the run, so the committed fixture must stay pristine.

A good fixture makes the screenshot **self-verifying**. The scroll-spy fixture
(`wi36-duplicate-headings.md`) works because:

- Heading line numbers are fixed and written down:
  `L1 #`, `L8 ## Setup`, `L22 ### Details`, `L34 ## Middle marker one`,
  `L46 ## Setup`, `L60 ### Details`, `L74 ## Middle marker two`,
  `L86 ## Setup`, `L99 ## Tail` — 111 lines total.
- Titles repeat deliberately (three `## Setup`), so the test can prove the spy
  picks the *correct* one of several identically-titled entries.
- Each section's body is self-labelling ("First", "SECOND", "THIRD"), so a
  screenshot answers "which section am I in" without counting pixels.

Enable the source-mode line-number gutter before scrolling. Reading `topLine`
off the gutter is what turns "the highlight looks wrong" into a table of
numbers you can hand to a debugger.

---

## 6. Probe design

**Probe symmetrically.** A directional defect is invisible to a one-directional
sweep. The WI-7 bug shipped through every prior review precisely because
everyone scrolled down. Use identical step counts in both directions:

```
down 8, down 8, down 8, …   record (topLine, highlighted entry) at each stop
up   8, up   8, up   8, …   record again — the same topLine must give the same entry
```

If the down-sequence and the up-sequence disagree at the same scroll offset,
you have a state-dependent bug, and the pure layer is the first suspect.

**Hold still and re-check.** Wait ~2.5s without input at a failing stop. If the
highlight corrects itself, the defect is a debounce or throttle artifact. If it
does not, the sampling logic itself is wrong.

**Probe the boundaries.** Document start, document end, a heading exactly on the
last visible line, and a document shorter than the viewport.

---

## 7. Evidence

### Counting log events — use size deltas, not `tail -f`

`tail -f` is unreliable through the tool layer and floods context. Mark the log
size before the interaction, then read only what was appended:

```bash
# before
wc -c < ~/.mdpro/mdpro.log       # → record this number, e.g. 2272789

# …drive the app…

# after: read only the new bytes
node -e '
const fs=require("fs"),os=require("os"),p=os.homedir()+"/.mdpro/mdpro.log";
const from=Number(process.argv[1]);
const fd=fs.openSync(p,"r"), size=fs.statSync(p).size;
const buf=Buffer.alloc(size-from); fs.readSync(fd,buf,0,buf.length,from);
for(const l of buf.toString("utf8").split("\n")) if(l.trim()) console.log(l);
' 2272789
```

This is how WI-7 proved criterion 5 (one attach per Source entry, nothing per
scroll): five lines total appeared — three `ui.menu.select`, one
`view.mode.change`, and exactly one `ui.toc.spy.attach`. A negative claim
("nothing was logged while scrolling") is only credible with a byte-exact
window like this.

### Screenshots

Prefer `zoom` on the region of interest (the TOC sidebar, the gutter) over a
full `screenshot`. It is more readable *and* it is the privacy-preserving
choice — see §9.

### Never commit screenshots.

---

## 8. The verdict table

Every run produces a table with one row per acceptance criterion and an
explicit verdict. **"Not verified" is a legitimate verdict and must never be
silently upgraded to a pass.** The WI-7 record, verbatim:

| # | Criterion | Result |
|---|---|---|
| 1 | Highlight tracks scrolling, down and up | **FAIL** — down works, up is frozen |
| 2 | Correct one of identically-titled headings | pass |
| 3 | Click moves highlight and it stays, incl. `## Tail` | pass |
| 4 | Mode switch leaves highlight sensible | **partial** — content jumps to top, highlight stays behind |
| 5 | One `spy.attach` per Source entry, nothing while scrolling | pass |
| 6 | No visible frame-rate cost | not objectively measured; felt responsive |
| — | Both themes (rule 34) | **NOT VERIFIED** — menu bar region owned by a non-granted app |

Rules for the table:

- A criterion you could not exercise is `NOT VERIFIED`, with the blocker named.
- A criterion you judged by feel says so ("felt responsive"), rather than
  claiming a measurement you did not take.
- A FAIL carries the reproduction: the exact inputs, the expected value, and
  the observed value. WI-7's:

  | Action | Viewport top | Expected | Actual |
  |---|---|---|---|
  | down 26 | 42 | Middle marker one (L34) | Middle marker one ✓ |
  | up 8 | 30 | Details #1 (L22) | Middle marker one ✗ |
  | up 8 | 17 | Setup #1 (L8) | Middle marker one ✗ |

- **Then confirm the root cause by reading the code, not by reasoning from
  pixels.** WI-7's first hypothesis (the spy listens to CodeMirror's rendered
  `viewport`, which carries an off-screen render margin) was wrong, and reading
  `useSourceScrollSpy.ts` disproved it in one step by showing a real passive
  `scroll` listener. The second hypothesis was checked against all twelve
  recorded observations, including the exact closed-interval boundary case,
  before it was believed.

- **Establish whether the suspect code is load-bearing before proposing to
  delete it.** WI-7's clamp is what makes the `## Tail` and `## Setup #3` clicks
  work; the fix therefore had to narrow it, not remove it.

---

## 9. Privacy and safety

- **Screenshots expose the user's real desktop** — personal documents,
  financial spreadsheets, filenames. Take the minimum number needed, prefer
  `zoom` over full-screen capture, and never save one into the repo.
- **Call `request_access` before any action**, listing only the applications
  the task needs. Do not request access to an unrelated app to get past a
  blocked coordinate.
- **Never modify system or security settings** to unblock a test.
- **Never click a web link** with computer-use tools.

### Known blocker: the menu bar

Menu-bar utilities (on this machine, "iBar Pro") own menu-bar coordinates. A
click there returns:

> Click at these coordinates would land on 'iBar Pro', which is not in the
> allowed applications.

Do not fight it and do not request access to the utility. Record the affected
criterion as NOT VERIFIED and state whether the verdict is affected — for WI-7
the defect was behavioural rather than visual, so the missing dark-theme pass
did not change the outcome. Where a keyboard shortcut reaches the same command
(`⌃2` / `⌃4` for view modes, `⌘⇧L` for the sidebar), prefer it over the menu.

---

## 10. Recording the result

Per CLAUDE.md, **updating status is part of finishing the work item, not a
follow-up**:

- The work item's row in
  `docs/plans/20260912-frontend-backend-sequencing-order.md` records the
  verdict and, on a FAIL, what it blocks.
- A criterion that passed and changes user-visible behaviour rewrites its row
  in `docs/feature-ledger.md` **in the same commit**. `Partial` must carry a
  literal `限制：`.
- A defect found here is a bug fix, so it goes back through
  `/tdd-guardian:plan` → `:design-tests` → `:implement` with a regression test
  that fails without the fix. Manual QA finds the defect; it does not license
  an ad-hoc patch.
- Re-run the full criteria table after the fix. A fix verified only against the
  criterion that failed has not been verified.

---

## Checklist

```
[ ] Confirmed the criteria genuinely need layout (§1)
[ ] pnpm tauri build --bundles app                      ← NOT pnpm tauri dev
[ ] Bundle mtime postdates every source file under test (§3)
[ ] Killed stray mdpro / mdpro_mcp processes
[ ] Launched by absolute path with the fixture argument (§4)
[ ] ps confirms the PID runs from the build path
[ ] Line-number gutter on; fixture line numbers written down (§5)
[ ] Probed symmetrically, both directions, same step size (§6)
[ ] Recorded the log byte offset before interacting (§7)
[ ] Verdict table filled in, NOT VERIFIED rows kept honest (§8)
[ ] Root cause confirmed by reading code, not inferred from pixels (§8)
[ ] No screenshots committed; minimum capture taken (§9)
[ ] Plan row and ledger row updated in the fixing commit (§10)
```
