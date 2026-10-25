# Device check B8b + B8c: D319 menu target after Fix 3 (Mac mini, 2026-10-25)

Committed by herdr-delegator. Build: verify bundle of master `9d38f8fb` (D319 Fix 3 `32fa5b96`), launched by exact path,
one process. picsee paused by the user's word: 「Yes, picsee is paused (Recommended)」.

- **B8b** (opus-auditor, Claude): the 0 ms Highlight race, 5 runs, then stopped on an API connection error; the user
  then moved all macOS device tests to gpt-auditor (「from now on, all mac os device test goes to gpt-auditor, redelegate
  and pause opus device test task」). Its stale lock was released by the delegator after its holder process had exited.
- **B8c** (gpt-auditor, Codex, device pane with `-s danger-full-access` by the user's 「Full access for device panes
  (Recommended)」): the remaining items. The timed menu click and window switch used a compiled CGEvent tool (real HID
  mouse events; Computer Use cannot set a sub-50 ms gap).

## Delegator's check against the card

| Item | Verdict | Note |
|---|---|---|
| 0 ms Highlight race (B8b) | **PASS 5/5** | each: one `menu.action.dispatch {action:"format.highlight", target:"main", via:"click_time"}`; `menu.capture` begin → end → will_send `ended` → store `source:"ended"` → route `click_time` |
| 0 ms Save race, two dirty windows, two recent `README.md` (B8c) | **PASS 2/2** | B `window.focus` 15–18 ms **before** the dispatch, yet `target:"main", via:"click_time"`; only a/README.md written, B unsaved and byte-identical |
| 300 ms control (B8c) | **PASS 3/3** | dispatch to A before B's focus |
| Shortcut control: menu cancelled in A, ⌘⇧M in B (B8c) | **PASS** | B highlighted, A unchanged, no `click_time` |
| Stationary control (B8c) | **PASS** | A |

The B8 failure (every 0 ms race acting in B) no longer reproduces. D319 is device-verified on macOS.

## Tester reports (verbatim)

### B8c
# B8c device report — D319 Fix 3 recheck (Mac mini, 2026-10-25)

Tester: gpt-auditor. Build: master `9d38f8fb` verify bundle at `/Users/jack/Documents/mac-app/mdpro-wt/verify-9d38f8f/src-tauri/target/release/bundle/macos/mdpro.app` (includes Fix 3 `32fa5b96`). One process, pid 43859, launched from that path; fresh `app.ready` at 23:15:46.325 +08:00. B8c GUI lock held throughout. picsee paused by the user's word quoted in `brief-B8c.md`.

| item | verdict | proof |
|---|---|---|
| Save race, 0 ms, two dirty windows, duplicate `README.md` recent entries | **PASS, 2/2** | `save-r1-gap0.log` and `save-r2-gap0.log`: B `window.focus` at 23:36:47.642 / 23:38:04.210 precedes the sole `menu.action.dispatch {action:"file.save",target:"main",via:"click_time"}` at 23:36:47.660 / 23:38:04.229. Each has `menu.capture` begin → end → will_send item `ended` → store `source:"ended"` → route `decision:"click_time"`. `file.save` writes only `d319/a/README.md` (A-RACE-1, then A-RACE-2); B stays visibly dirty (`save-r{1,2}-gap0.png`) and its disk hash remains `5c79d787…`, identical to `fixtures-before.sha256`. `recent-readmes.txt` records both distinct recent paths. Tool timestamps in `save-r{1,2}-gap0.tool`; switch key was 13/11 ms after item up despite a requested 0 ms sleep. |
| Highlight, 300 ms control | **PASS, 3/3** | `hl300-r{1,2,3}.log`: each has exactly one `format.highlight` dispatch to `main` via `focused`, one `editor.milkdown.highlight success`, then B focus. `hl300-r{1,2,3}.png` show only A's `First` highlighted; B stays plain. B disk hash remained `5c79d787…`. Tool files show item up → switch key gaps of 319/314/313 ms. |
| Shortcut control, A menu Esc → B ⌘⇧M | **PASS** | `shortcut-ax-observation.txt` records the Computer Use AX Format menu open in A and Esc cancellation; `shortcut-after-esc.png` shows it closed. `shortcut.log` records B focus, one `ui.shortcut.trigger {action:"format.highlight",shortcut:"Cmd+Shift+M"}` and one `editor.milkdown.highlight success`; no `click_time` dispatch. `shortcut-before.png` / `shortcut-after.png` show A plain and B's `Second` highlighted with B dirty. The AX menu open did not produce a native `menu.capture` Begin, so this is a shortcut control, not a native click capture test. |
| Stationary Highlight in A | **PASS** | `stationary.log`: sole `format.highlight` dispatch to `main` via `focused`, followed by `editor.milkdown.highlight success`; `stationary.png` shows A's `First` highlighted and B plain. |
| B8b Highlight race, 0 ms, prior evidence | **PASS, 5/5 (B8b; not repeated)** | `../B8b-evidence/d319-hl-r{1..5}-gap0.log`: each contains exactly one `format.highlight` dispatch to `main` via `click_time`, and capture begin → end → will_send `ended` → store `source:"ended"` → route `decision:"click_time"`. The screenshots and tool timestamps are in the same B8b folder. |

## Steps and decisive lines

1. Acquired `desktop-gui.lock` as `project=mdpro`, `batch=B8c`, `session=gpt-auditor`. The interrupted B8b app was no longer running. Copied the **B8b pre-run** `config.json.bak` to this folder; did not make a new backup of the changed config. Copied `d173-two-windows.md` into B8c `d319/a/README.md` and `d319/b/README.md`, changing only B's title to `WINDOW B CONTROL`. Discarded one B8b scratch draft offered at launch.
2. Launched with `open -n -a` and the full verify-bundle path. `ps` showed exactly one mdpro process from it; log showed fresh `app.ready` pid 43859. Switched Doubao pinyin to ABC with Control-Space. Opened B's copy in a second window. `recent-readmes.txt` records both `README.md` paths at the top of the recent list.
3. Compiled `menu-race.m` to `menu-race`. It checks Accessibility permission, posts HID mouse down/up on the menu title and item, then posts Command-grave after the requested gap, printing `item_up` and `switch_key`. `run-menu.py` took a byte-exact `~/.mdpro/mdpro.log` slice and screenshot for each run. No permission was changed.
4. Stationary A Highlight succeeded. For each 300 ms run, undid the preceding highlight, retained A's `First` selection, clicked Format › Highlight Selection, then switched to B. The decisive dispatches were to `main` at 23:24:32.287, 23:26:35.236, and 23:26:53.061; in each, B focus followed dispatch.
5. Returned A to plain. Opened Format in A, pressed Esc, focused B, selected `Second`, and pressed ⌘⇧M. B highlighted; A remained plain. `shortcut.log` has no `menu.action.dispatch` for that shortcut.
6. With B's unsaved highlight still present, replaced A's `First` with `A-RACE-1`. File › Save 0 ms run 1: `window.focus` B 23:36:47.642 → `menu.capture` end and will_send 23:36:47.654 → dispatch `target:"main",via:"click_time"` 23:36:47.660 → `file.save success` for `d319/a/README.md` 23:36:47.675. Replaced A-RACE-1 with A-RACE-2 and repeated: B focus 23:38:04.210 → will_send 23:38:04.224 → dispatch main/click_time 23:38:04.229 → A save success 23:38:04.240. Neither dispatch has a `value` field; neither run saved B.
7. Quit with ⌘Q and chose **Discard changes** only for B's B8c scratch fixture. `app.quit` succeeded at 23:40:35.968; no mdpro process remained. Restored Doubao pinyin, with `cmp` matching `input-source-before.txt`. Restored `~/.mdpro/config.json` from B8c's copy of the B8b backup, with `cmp` against the original B8b backup: **OK**.

## Deviation and limits

- Computer Use handled app UI, selection, shortcut, and Esc. The timed menu click and switch used the requested compiled CGEvent tool because Computer Use cannot set a sub-50 ms gap. `screencapture` saved the screenshots. The 0 ms setting means zero intentional sleep after item up; actual posted-key timestamps were 11–13 ms later for the Save runs.
- The shortcut control's menu was opened by AX click, so its Esc cancellation has an AX observation and screenshot, but no AppKit capture Begin. The native click path is proven separately by the Save runs and B8b's five Highlight races.

### B8b (partial: the five 0 ms Highlight logs are in `B8b-evidence/d319-hl-r{1..5}-gap0.log`; no report was written before the tester stopped)
