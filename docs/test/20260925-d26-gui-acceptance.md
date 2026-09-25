# D26 — A window that answered the quit prompt is re-checked: GUI acceptance (2026-09-25)

This is the real-device acceptance for D26
([ADR-0035](../adr/0035-a-window-that-answered-the-quit-prompt-is-re-checked-before-commit.md))
at commit `68d4648`. ADR-0035 names its own device criterion: two windows, one
answers `clean`, it is then edited in a **background tab** while the other
window's dialog is up, and the quit must prompt it. The repo has no integration
lane and jsdom has no second window, so no automated lane can reach this path.

It was driven through `/gui-acceptance` (computer use) on the release bundle. The evidence is:

- byte-offset log slices from `~/.mdpro/mdpro.log`;
- zoomed captures of the editor and tab bar.

No screenshots were kept. The MCP token was not read.

## Binary under test

| Field | Value |
|---|---|
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, built 2026-09-25 07:06:48Z. The only uncommitted changes at build time were outside the build (`.claude/*`, `docs/`), so the image is `68d4648` |
| `Contents/MacOS/tauri-app` sha256 | `1d413c5504bcc7aacdde38d0c3c0e6c7510dab50e4dc6fab65b0969c86588681` |
| Freshness (trap 2) | Bundle is newer than every source under test: `src/hooks/useQuitGuard.ts`, `src/utils/quitDraftBackstop.ts`, `src/utils/quitGuardHandlers.ts`, `src/utils/quitDiscardSnapshot.ts`, `src/services/quitGuardService.ts`, `src-tauri/src/services/quit_guard/{rounds,coordinator,request,backstop}.rs`, `src-tauri/src/commands/quit_guard.rs` |
| Cold launch (trap 3) | A stale instance from 2026-09-24 12:17 (PID 52773) was found with `/bin/ps -axo pid,lstart,command`. It did **not** show under `ps -Ao …comm`. It was killed. The relaunch logged `appReady:false` and window `main`. `app.quit.recheck` cannot come from any build before ADR-0035, and it appears in every quit below |
| Note | The build exited 1 only at the updater-signing step. `/Applications/mdpro.app` was not used |

- **Fixtures:** all in the session scratchpad (`…/scratchpad/d26/`), none in the repo:
  - `w1a.md`: `# D26 W1 tab A` / `Tab A body.`
  - `w1b.md`: `# D26 W1 tab B` / `Tab B body.`
  - `w2.md`: `# D26 W2` / `W2 body.`
- **Windows:**
  - W1 is `main`, holding `w1a` and `w1b` as two tabs.
  - W2 was opened with `open -a <bundle> w2.md`, which logs `file.open.route` `outcome:new-window`.
- **Harness notes:**
  - Launch showed *Recover drafts* for leftover drafts. **Recover** was clicked on each, never Discard. Each was then saved with ⌘S, so that W1 would start clean.
  - The first click on an inactive mdpro window only activates it. Every edit below was confirmed by a zoom showing the typed text and the tab's dirty dot.

## Verdicts

| # | Criterion | Result |
|---|---|---|
| B | Baseline: every window clean → quit still runs the re-check and the backstop, then exits | **pass**. With 8 clean windows: round 0 all `clean` → `app.quit.recheck` round 1 all `clean` → `app.quit.backstop` all `drafted` 0 → `app.quit.commit` `{backstop:true, capped:0, deleted:0, drafted:0, draftFailed:0, draftMissing:0, failed:0, undiscarded:0}` → `app.quit`. One `app.quit.check` per window per round, so there are no duplicate quit-guard listeners |
| A1 | Two dirty windows: only one prompt at a time | **not re-run in this session**. Last proved as D16 G20/G21 on `8a7c1a7` (`docs/test/20260923-d16-gui-acceptance.md`). The A2/A3 slices below show one `app.quit.prompt` per round and one `phase:prompt` check per prompt, which fits G20/G21 but was not the A1 set-up |
| A2 | **ADR-0035 device criterion**: W1 answers `clean`, is edited in a **background tab** while W2's dialog is up; the quit must prompt W1 | **pass** — see slice A2 |
| A3 | Cap (ADR-0035 §3): a window edited again after its re-prompt is capped, not prompted; the quit terminates; the edit survives as a draft that is recovered on next launch | **pass** — see slice A3 |
| A4 | *Keep editing* on a re-check-induced prompt aborts the whole quit; both windows stay open and editable | **pass** — see slice A4 |
| — | Logs carry counts only | **pass** for every `app.quit.*` line in the slices. They carry `requestId`, `round`, `windowLabel` and counts, and no document id, path or content. (`file.open.*` and draft `file.write` lines do carry paths, but those events are outside the quit guard) |

### Slice A2 — request 1, from log offset 15 591 324

1. `app.quit.request {windowCount:2}`.
   - Round 0: `main` answered `clean`; W2 answered `dirty`.
   - `app.quit.prompt` went to W2, and W2 acked `delivered`.
2. With W2's dialog up, W1's **w1b** tab was edited to `Tab B body. W1B-LATE-EDIT`. W1 was then switched back to `w1a`, so the edit sat in a **background tab** (zoom: `● w1b.md`).
3. 73 s later (15:31:16) W2 answered `discard` (`idCount:1`).
   - `app.quit.recheck {round:1, windowCount:2}` ran.
   - W2 answered `clean` (`discardedUnchangedCount:1`, so the discarded document did not re-trigger a prompt).
   - **`main` answered `dirty`**, and `app.quit.prompt` went to `main`, which acked `delivered` in round 1. The quit re-prompted W1 instead of terminating.

### Slice A3 — continuing request 1

1. With W1's round-1 prompt up, W2 was edited again (`W2 body. W2-EDIT W2-SECOND`).
2. W1 answered `discard` (15:32:17).
   - `app.quit.recheck {round:2}` ran: W2 `dirty`, W1 `clean` (`discardedUnchangedCount:1`).
   - `app.quit.prompt` went to W2. This is W2's re-check-induced prompt, which spends its one re-prompt.
3. With W2's round-2 prompt up, W1's w1b was edited **again**, to `Tab B body. W1B-LATE-EDIT W1B-THIRD`. W1 had already spent its re-prompt.
4. W2 answered `discard` (15:34:15).
   - `app.quit.recheck {round:3}` ran: W1 `dirty`, W2 `clean`.
   - **No prompt was issued.** `app.quit.backstop {round:3}` followed.
   - W2 replied `drafted {draftedCount:0}`; W1 replied `drafted {draftedCount:1, idCount:1}`.
5. `app.quit.commit` `status:fail` `{backstop:true, capped:1, deleted:1, drafted:1, draftFailed:0, draftMissing:0, failed:0, gateWaitMs:0, undiscarded:1}`, error `1 windows capped after their re-prompt`.
   - `app.quit` followed 4 ms later.
   - `/bin/ps` then showed no mdpro process.
   - The whole quit took four rounds and three dialogs. That is within the `N windows × 2 prompts` bound, so there was no livelock.
6. Cold relaunch showed *Recover drafts* with **exactly one** draft: `D26 W1 tab B` (w1b).
   - W2's discarded edit was not resurrected. That is the `deleted:1`.
   - **Recover** restored `Tab B body. W1B-LATE-EDIT W1B-THIRD`. W1 had discarded w1b in round 1 and edited it again afterwards, so the newer edit beat the older discard (ADR-0035 §4 correction, `undiscarded:1`).

`status:fail` on this commit is by design: a capped window is a limit the user
should be able to find in the log, even though its edit was drafted.

### Slice A4 — request 1 of the next launch, from log offset 15 637 256

1. Set-up: `main` held the recovered, dirty w1b. W2 was opened clean from `w2.md`.
2. ⌘Q.
   - Round 0: W2 `clean`, `main` `dirty`, so `main` was prompted.
   - With that prompt up, W2 was edited (`W2 body. A4-EDIT`).
3. `main` answered `discard`.
   - `app.quit.recheck {round:1}` ran: W2 `dirty`, `main` `clean` (`discardedUnchangedCount:1`).
   - `app.quit.prompt` went to W2 (round 1).
4. **Keep editing** on W2 logged `app.quit.answer {answer:cancel, round:1}` → `app.quit.cancel {reason:cancelled}`. There was no backstop, commit or `app.quit`.
5. Both windows stayed open and editable:
   - W2 took `OK2` → `W2 body. A4-EDIT OK2`.
   - `main` took `OK1` → `…W1B-THIRD OK1`.
6. The next ⌘Q (request 2) prompted `main` again in round 0. Its request-1 discard had not carried over the cancel.
   - Discard → re-check all `clean` → backstop 0 → `app.quit.commit` `success` `{capped:0, deleted:1, undiscarded:0}` → `app.quit`.

## Defect found on the way (not ADR-0035)

**⌘⇧N (New Window) opened 7 windows from one keypress.** The log shows seven
`ui.menu.select` `menu.file.new_window` lines for the single press. Recorded as
[D31](../plans/20260912-frontend-backend-sequencing-order.md#d31). The mechanism
was read from the code but not proved by a reproduction. At
`src/hooks/useMenuEvents.ts:125-137`, `unlisten` is assigned only when the
`listen()` promise resolves, so a cleanup that runs first leaks the
subscription. The effect depends on 14 handler props, so it re-runs often. The
run worked around it: `open -a` was used to create W2.
