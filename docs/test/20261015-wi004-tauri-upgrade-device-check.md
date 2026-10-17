# ADR-0047 WI-004 device check: Tauri 2.12.1 upgrade and the D217 focus fix (2026-10-14 → 15)

Recorded by mdpro-delegator. **Verdict: PASS for landing.** `9940be9` (Tauri pin `df2a879` + D217
fix) was fast-forwarded onto `master` on 2026-10-15. The device gate was the brief
`docs/pending/20261014-brief-wi004-tauri-upgrade.md` and its two addenda. Full reports stay on the
Mac mini under `~/.mdpro-redesign/dtrack/reports/` (named per section below). This file keeps the
verdicts and the proof lines they rest on.

## Builds

| Name | Commit | Identity |
|---|---|---|
| OLD | `9974d7a` (v0.3.3 release lock) | tauri-app sha256 `787eeaca…98bb` |
| NEW | `a6131ec` (Tauri 2.12.1, before the D217 fix) | sha256 `8b50071d…74cc6`, `releaseId 0.3.3@a6131ec…` |
| FIX | `9940be9` (NEW + D217 fix, the landed head) | sha256 `42c82a30…a50a`, mtime 2026-10-15T05:27:08 |
| VB / VA | verify bundles of `62810ba` / `a6131ec` | buildId `c284edb2…` / `589d52e5…` |

## Parts 1–5 on NEW (report `20261014-wi004-part1.md`, dtrack)

| Row | Verdict | Proof |
|---|---|---|
| A1 double launch | PASS | NEW = OLD in every cell. At a 0 s gap both builds start two primaries 5/5 (pre-existing); at 0.05 / 0.2 / 0.5 s both forward 5/5 |
| A2 open from Finder | PASS (steps 1–2); step 3 not run (needs Finder) | Cold: `finder` → `pending` → `pending_paths_transfer` → `app.ready`. Warm: `file.open.route`, one PID |
| A4 quit guard | PASS | `app.quit.hook_installed outcome:"added"`; menu quit and AppleScript quit both prompt; Keep editing cancels; the clean control quits with no prompt |
| A5 local images | PASS on rerun | First run NOT EXERCISED (OLD failed the control too: the files sat under a dot-directory, now [D206](../plans/20260912-frontend-backend-sequencing-order.md#d206)). Rerun from `~/Documents`: `ok.png` paints and the missing image shows a placeholder on both builds, byte-identical shots |
| A6 fullscreen | PASS | before/after shots byte-identical, NEW = OLD |
| A3 shortcuts, parts A–C | 93 of 94 rows = the v0.3.3 baseline | **F2 differed**: a ⌘⇧N window never logged `window.focus` on NEW (L24954–L24991); OLD logged it in the same sitting (L25265). Fixed by D217, below |
| A7 journeys (part 5) | PASS | VB vs VA: all 33 judged slices equal; J2/J3 drafts byte-identical; J5 step 3 (physical Esc) left to H2 |

Side observation, both builds, registered as [D218](../plans/20260912-frontend-backend-sequencing-order.md#d218):
Settings shows Auto-save "Off" while autosave writes every ~5 s.

## F2 recheck on FIX (report `20261015-wi004-f2-recheck.md`, dtrack)

| Row | Verdict | Proof |
|---|---|---|
| R1 control on NEW | holds 3/3 | each ⌘⇧N window: `window.create` + `window.blur main`, no `window.focus` before close |
| R2 ⌘⇧N on FIX | PASS 5/5 | exactly one `window.focus` per new label after its create start (L25970, L26005, L26040, L26075, L26110) |
| R3 focus between windows | PASS | blur new, focus main, blur main, focus new, each once (L26168–L26171) |
| R4 external open into a new window | PASS | `file.open.route` new-window (L26244), `window.open` c.md (L26245), one `window.focus` (L26248), one PID |

## Updater signature (A8.1, adr047-verify)

PASS. Evidence: `~/.mdpro-redesign/adr047-a81/` on the MacBook. All six `.sig` files from build-only run
38585747638 verify against the `tauri.conf.json` updater key, and each trusted comment carries
`version:0.3.3`. `latest.json`'s darwin signatures equal their files. The negative controls (one
flipped byte, an edited trusted comment) are rejected. FIX changes no lock file and no tauri-cli, so
the signing path is the same.

## H1–H4, the user's keys (FIX, on the mini, 2026-10-15)

| Row | Verdict | Proof |
|---|---|---|
| H1 Esc cancels a Chinese IME composition | **Not a WI-004 regression**; defect registered as **D219** | User over UU加速器: Esc left the Doubao Pinyin candidate open, nothing inserted. Control (dtrack, report `20261015-wi004-h1-ime-esc.md`, scripted Esc key code 53 in one atomic probe per target, Doubao Pinyin): TextEdit **cancelled**; OLD v0.3.3 and FIX both **not cancelled**, the same. Shots `h1ime-*` |
| H2 Esc on "Unsaved changes" | PASS (user; class `remote key`, pressed on the MacBook and relayed by UU, not physical: the user confirmed 「Yes, through UU」 on 2026-10-17) | L26429 `ui.dialog.escape {dialog:"confirm", outcome:"cancel"}` at 06:15:49; the tab stayed open and dirty |
| H3 Tab in a Source table | PASS (user; class `remote key`, relayed by UU, confirmed 2026-10-17 as for H2) | the cursor moved between cells; no text inserted (ADR-0046) |
| H4 ⌘Q with a dirty document | PASS (scripted ⌘Q via dtrack's `key.sh`, at the user's request: 「do it for me」) | L26479 `app.quit.request` → L26480 `app.quit.check dirty` → L26482 `app.quit.prompt` → Keep editing → L26490 `app.quit.cancel`. A scripted key, not a physical one; it goes through the same key-equivalent path |

## Changes to the mini's as-found state

- macOS "Documents folder" access was granted to OLD and NEW: the user clicked both Allow prompts.
- The input source was left on Doubao Pinyin. The as-found selection could not be confirmed.
- `reports/shots/r3.png` and `r4.png` were overwritten by the F2 recheck. The 2026-10-09 and 10-11
  reports cite them. Shot names now carry a run prefix.
