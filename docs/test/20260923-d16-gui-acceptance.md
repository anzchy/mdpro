# D16 quit-guard — real-device GUI acceptance (2026-09-23)

**Build under test**: `ab54ee6`, clean worktree, release `.app`, bundle id
`com.mdpro.app`, v0.3.0. **Not branch HEAD** — `9cb32eb` (the MUST-2 draft-gate
fix) is *not* in this bundle. Three cold launches, each verified `appReady:false`
with window label `main` (gui-acceptance §3 Trap 3). Nothing committed or staged.

Run executed by a second session driving the shipping app; this file is the
record, per gui-acceptance §10.

## Verdict table

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| PC | `app.quit.hook_installed` at launch | **pass** | `{"delegateClass":"TaoAppDelegateParent","outcome":"added"}`, status `success`, on all 4 cold launches |
| G2 | one dirty untitled doc, ⌘Q → prompt | **pass** | `app.quit.request{requestId:1,windowCount:1}` → `check{answer:"dirty"}` → `prompt{windowLabel:"main"}`; dialog visible. Never quit silently |
| G13 | Cancel → app alive, doc still dirty | **pass** | `answer{answer:"cancel"}` → `app.quit.cancel{reason:"cancelled"}`; process alive, tab still dirty, draft and `server.port`/`server.token` intact |
| G15 | Discard → quits, draft gone | **pass** | `app.quit.commit{deleted:1,failed:0}` → `app.quit{}`; drafts dir empty |
| G20 | two dirty windows prompted **one at a time** | **FAIL (partial)** | Rust is correct — exactly one `app.quit.prompt{windowLabel:"main"}`, and `effects.rs` calls `emit_to(label, …)`. But **both** windows showed the dialog: two `app.quit.check{phase:"prompt"}` lines, both visible on screen |
| G21 | Cancel in the **second** window aborts the whole quit | **FAIL** | Cancel from the un-prompted window logged `answer{answer:"cancel"}` then **nothing** — no `app.quit.cancel`, quit not aborted. No data lost; both windows stayed open. Answering window 1 afterwards recovered the protocol correctly |
| G22 | clean docs only → quits promptly, no prompt | **pass** | `request` → `check{answer:"clean",dirtyCount:0}` → `commit{deleted:0}` → `app.quit{}` in **5 ms**, zero dialogs |
| — | per-quit: server files removed + `app.quit` written | **pass** | All three completed quits: `server.port` and `server.token` gone, `app.quit{}` present. This discharges the outstanding G1 end-to-end check for the `RunEvent::Exit` move |
| — | ADR-0027 timeout / native alert rows | **NOT VERIFIED** | Deliberately skipped: BLOCK-1 is re-specifying the timeout model, so these criteria are about to change. Not a pass |
| — | Both themes (rule 34) | **NOT VERIFIED** | Behavioural run only |

## The decisive experiment: a second ⌘Q is a total no-op

**Result: AppKit suppresses `applicationShouldTerminate:` entirely while an
`NSTerminateLater` reply is outstanding.** A second ⌘Q produced no visible
change, **zero new log bytes**, and left the original prompt intact.

The stock binary cannot answer this question — `QuitGuard::begin` logs only
inside its `if let Begin::Later` arm, so an `AlreadyPending` hit writes no line,
making "AppKit re-invoked the delegate" and "AppKit swallowed the keystroke"
byte-identical silences. A temporary `app.quit.hook_probe` was therefore added as
the **first statement inside the `should_terminate` IMP**, before `host()`:

- First ⌘Q: `hook_probe{outcome:"enter"}` → `app.quit.request` →
  `hook_probe{outcome:"later",nsReply:2}`.
- Second ⌘Q: **no `hook_probe` at all** — the IMP is never entered.
- Control: with the same prompt up, ⌘⇧L *did* fire (`ui.menu.select`), so the
  menu bar was live and ⌘Q specifically was suppressed.

Diagnostic then removed, pristine bundle rebuilt, probe string verified absent
from the binary, and **the result reproduced exactly**. Consequences:
[ADR-0029](../adr/0029-quit-deadlines-bound-machine-progress-not-people.md)
decision 3 withdrawn; replacement recorded in
[ADR-0030](../adr/0030-a-menu-item-is-the-escape-hatch-for-a-stuck-quit.md).

**What the control does and does not establish.** It proves native menu dispatch
survives a deferred reply. It does **not** prove menu dispatch survives a frozen
webview — the renderer was healthy throughout. ADR-0030 rests on the latter and
records it as an unverified assumption.

## Root cause of G20/G21 (read in code, not inferred from pixels)

`src/hooks/useQuitGuard.ts:42` imports `listen` from `@tauri-apps/api/event` and
subscribes with the **global** `listen(name, …)` rather than
`getCurrentWebviewWindow().listen(…)`. A global listener ignores the emit target,
so Rust's correct `emit_to("main", …)` reaches **every** window. Both windows
render the prompt; both can answer.

G21 follows from `coordinator.rs` ~150-156: a `cancel` from a never-prompted
window hits `_ => return refuse(IgnoredWhy::OutOfPhase)`. **The fix is one line in
the hook, not in the coordinator** — the coordinator behaved correctly given the
input it was handed.

## Findings not previously on the defect list

1. **Global `listen()` in `useQuitGuard.ts`** — the G20/G21 root cause above. The
   file's header claims "At most one phase-2 reply per request", enforced by
   `answeredRequestRef`; that latch is per-window and cannot enforce anything
   across windows.
2. **A refused answer is logged as a success.** `driver.rs` ~142-153 calls
   `logging::log_answer(…, None)` *before* `plan(|c| c.on_answer(…))`, and
   `plan()` maps `Step::Ignored{..} => Plan::Nothing`. An out-of-phase answer
   writes `app.quit.answer status:"success"` and then does nothing, with no line
   saying it was refused. **This is why G21 looked healthy in the log and was
   broken on screen** — it was caught only by looking at the display.
3. **One ⌘⇧N creates two windows.** Two `window.open` lines for one keystroke.
4. **Four identical `ui.menu.select` lines for one ⌘⇧L**, 1-2 ms apart, while the
   quit prompt was up (so the sidebar visibly did not move — an even number of
   toggles). Normally that chord produces exactly one line, via a different event
   (`ui.shortcut.trigger`). Observed once, not investigated. Possible duplicate
   `menu:action` subscription; possibly related to finding 3.
5. **NOTE, not a defect:** `commands/draft.rs:46` logs draft autosaves under the
   event name `file.write` with the *document's* `filePath` in context. In the log
   a draft save is indistinguishable from writing the user's file. The fixture was
   verified untouched (98 bytes) while two `file.write{bytes:109}` lines pointed at
   it. Misleading enough to alarm a reader mid-run.

Findings 1 and 2 are fixed in the BLOCK-1 change. Findings 3, 4 and 5 are filed
separately.

## Build note: a clean checkout cannot build

`src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` is gitignored, and
`tauri.conf.json` lists it as a bundle resource — so the build script fails
**before any target in the crate compiles, including the sidecar itself**.
`cargo build --release --bin mdpro_mcp` fails for the same reason. Bootstrap:

```bash
printf '#!/bin/sh\nexit 0\n' > src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin
chmod +x src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin
cargo build --release --bin mdpro_mcp                      # ~40s
cp src-tauri/target/release/mdpro_mcp \
   src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin       # overwrite the stub
pnpm tauri build --bundles app                             # ~65s
```

`pnpm tauri build --bundles app` exits **non-zero** at the very end with "A public
key has been found, but no private key" — that is the updater signing step, which
runs *after* bundling. The `.app` is complete and usable; the exit code is not a
failed build.
