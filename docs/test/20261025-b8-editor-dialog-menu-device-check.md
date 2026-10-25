# Device check B8: Encoding focus, list conversion, menu routing, mode refusal (Mac mini, 2026-10-25)

Committed by herdr-delegator from the tester's report (opus-auditor, Claude on Opus, `MDPRO_ROLE=real-device-tester`;
the user: 「hand the batch to opus-auditor」). Build: verify bundle of master `76065b2c` (contains D317 `a38a7afd`, D319
`9b9cd404`, D318+D320 `77d53ba6`), launched by exact path, one process, `releaseId:"unknown"`. picsee paused by the
user's word: 「Yes, picsee is paused (Recommended)」. No Computer Use tools were available in the tester's session; it
drove the app with System Events, AX menu presses and compiled CGEvent tools (real HID mouse events for the D319 menu
race), all listed in its Deviations. D317's physical Esc was pressed by the user (「Yes, I pressed Esc」).

## Delegator's check against the cards

| Item | Verdict | Note |
|---|---|---|
| D317 Encoding cancel returns focus | **PASS** | WYSIWYG and Source; Esc, Cancel, backdrop and text-click-then-Esc; one cancel and `ui.dialog.focus-return focus:"editor"` each time; the typed probe landed at the kept caret in the intended document only. Physical Esc PASS (the user pressed it) |
| D318 ordered ↔ bullet in WYSIWYG | **PASS** | menu and keys, both directions, nested list, one-step Undo, no-op on an already-bulleted item, save and reopen |
| D319 menu target survives an immediate switch | **FAIL** | 0 ms race: B focused 15–25 ms before `menu.action.dispatch {target:B, via:"focused"}`, Highlight 4/4 and Save 2/2 (Save wrote B's file). No `via:"click_time"` in any run. 300 ms passes only because dispatch beats the switch. Every 0 ms run had two `ui.menu.build` between A's blur and the dispatch. Reopened: Fix 3 to opus-imple-1, the user: 「Reopen, fix in 0.3.6 now (Recommended)」. M1-across-rebuild without a focus change NOT EXERCISED |
| D320 wrong-mode refusal | **PASS** | one toast and one `ui.menu.select cancel reason:"wrong_mode"` per wrong-mode key; wrong-mode native items greyed; positive controls edit without a toast; saved bytes unchanged |

## Tester's report (verbatim)

# B8 device report: editor commands, dialog focus and menu routing (Mac mini, 2026-10-25)

Tester: opus-auditor (`MDPRO_ROLE=real-device-tester`). Brief: `~/.mdpro-redesign/device/brief-B8.md`.
Build: `verify-76065b2` at `76065b2cb21486aacaf53439ad6206165f89ab76`, bundle
`…/mdpro-wt/verify-76065b2/src-tauri/target/release/bundle/macos/mdpro.app`, one process pid 90885 from that path,
`app.ready` 13:56:51.543 (`pid:90885`, `appVersion:"0.3.5"`; `releaseId`/`buildId` are `"unknown"` on this local build).
GUI lock `B8` acquired 13:55 (`session=opus-auditor`), released after the run. picsee: paused by the user's word quoted in the brief.

## Verdicts

| item | verdict | proof |
|---|---|---|
| **D317** Encoding cancel returns focus | **PASS** (WYSIWYG and Source; Esc, Cancel button, backdrop, click-explanatory-text then Esc; **physical Esc PASS**, reported separately) | Every run: exactly one `ui.dialog.cancel {controlId:"dialog.encoding.cancel"}`, then `ui.dialog.focus-return {controlId:"dialog.encoding.cancel", focus:"editor"}` (Esc runs also one `ui.dialog.escape {outcome:"cancel"}`). One typed `Q` with no click landed in d317-main.md at the preserved caret and nowhere else. Saved bytes: WYSIWYG `Second paragraph.Q` (caret at end of line 5), Source `First pQaragraph.` (caret mid-line 3); the d317-source.md control tab kept sha `340af209…`. One Undo + Save restored sha `340af209…` after every run. Physical Esc 14:27:15.568 → cancel/escape/focus-return `editor`; probe saved `Second paragraph.Q` (`d317-phys-saved-probe.md`). Logs `d317-{w,s}-{esc,button,backdrop,textesc}.log`, `d317-phys.log`; shots `d317-*-1-dialog`, `d317-*-2-probe`, `d317-phys-*` |
| **D318** ordered ↔ bullet in WYSIWYG | **PASS** | Menu Paragraph › Unordered List with the caret in "second": `menu.action.dispatch {action:"editor.paragraph.unorderedList", target:"main", via:"focused"}` + `ui.menu.select success`; the saved diff changes only lines 24–26 `1./2./3.` → `-` (`d318-1-o2b-menu-saved.md`). Bullet → ordered via the menu (`d318-2`), and both directions through ⌘⌥U / ⌘⌥O (`ui.editor.command … via:"key"`, `d318-3`, `d318-4`) gave the same diffs as the menu. Nested: Ordered List on "two" converts the containing list, and its sublist stays bullets, re-indented to 3 spaces (`d318-5`). One Undo + Save restored sha `0ef2cb43…` after each (`ONE-UNDO RESTORED`). Plain paragraph → bullet works (`d318-6`). Unordered List on an already-bulleted item: `ui.menu.select cancel reason:"no_change"`, bytes unchanged (`d318-7`). Save → close tab → reopen: the file stays converted (sha `fcfc77e4…` before and after), and it renders as bullets (`d318-8-reopened`) |
| **D319** menu target survives immediate window switch | **FAIL** (0 ms race, Highlight 4/4 and Save 2/2) | Highlight Selection clicked in A (`main`), then ⌘\` to B (`mdpro-d8184d37-…`) at once. B's `window.focus` came 15–25 ms **before** `menu.action.dispatch {action:"format.highlight", target:"mdpro-d8184d37-…", via:"focused"}` every time (e.g. r1: focus B 14:08:32.016 → dispatch target B 14:08:32.034). B: `editor.milkdown.highlight fail` (no selection there), so the action ran in the wrong window and A's highlight was silently dropped. **Save** with both windows dirty and two recent entries both named `README.md`: `menu.action.dispatch {action:"file.save", target:B, via:"focused"}` → `file.save` wrote **b/README.md**, and a/README.md stayed unsaved, in both 0 ms runs (`d319-save-race0.log`, `d319-save-run1-gap0.log`). No run logged `via:"click_time"`. 300 ms gap: 3/3 Highlight and 1/1 Save went to `target:"main"` via `focused`, dispatched before B's focus. That is the pre-fix B5c behaviour, so it does not show the fix. Stationary control: `target:"main"`, A highlighted. M2 (shortcut, no Begin): ⌘⇧M in B after a race → `ui.shortcut.trigger` + highlight success in B only (`d319-m2.log`). M1 (selection active across a rebuild): every 0 ms race had two `ui.menu.build` between A's blur and the dispatch, and the selection did not keep A. A separate rebuild-without-focus-change variant was **NOT EXERCISED** |
| **D320** wrong-mode commands show a visible refusal | **PASS** | Locked table, macOS v2 single-mode rows: Math Block S (⌘⌥⇧M), Delete Word S (no key, `<unassigned>`), Table… W (⌘⇧T), Clear Format W (⌘\). WYSIWYG: ⌘⌥⇧M → one toast "Available in Source mode only" + one `ui.menu.select cancel {controlId:"editor.paragraph.mathBlock", reason:"wrong_mode"}` (`d320-w-1-mathkey`). Source: ⌘⇧T → one "Available in WYSIWYG mode only" toast + `cancel …paragraph.table wrong_mode`. ⌘\ isolated (no toast before, toast after) + `cancel …format.clearFormat wrong_mode` (`d320-s-5-*`). Wrong-mode native items are greyed (AX `enabled=false`: Math Block and Delete Word in W; Table… and Clear Format in S); an AX press on them logged nothing and changed nothing. Saved bytes of both fixtures unchanged (`f5517bcd…`). Positive controls: Math Block in Source → `ui.editor.command success`, `$$` block inserted, no toast, one Undo restored; Clear Format in WYSIWYG on bolded "Second" → `ui.editor.command success`, bold removed, no toast, file back to `f5517bcd…` |

## Steps

1. Lock acquired. `~/.mdpro/config.json` was backed up to `config.json.bak`. Fixtures were copied from `verify-76065b2/tests/manual-fixtures/`: d173 → d317-main/d317-source and d319/a/README.md (b/README.md is d173 with its title changed to "WINDOW B CONTROL"), d195 → d318-lists, and d37 → d320-w/d320-s. The Latin-1 file `d317-latin1.md` (`# caf\xe9\n`) was **created** there, because no committed fixture matches B4's file. Hashes are in `fixtures-before.sha256` and `fixtures-after.sha256`.
2. No mdpro was running. `open -n -a <bundle> d317-main.md` gave one process from the bundle path and a fresh `app.ready`. Input source switched from Doubao pinyin to ABC for the run and restored at the end.
3. D317: d317-source.md was opened as a control tab, then d317-main.md was made active. The caret was placed with a real click, and d317-latin1.md was opened through ⌘O → ⌘⇧G path, which showed the Encoding dialog over the active document. The dialog was cancelled four ways, then `Q` was typed with no click, then ⌘S, diff, ⌘Z, ⌘S, sha compare. This was repeated in Source (⌃2). Physical Esc: dialog staged, user asked, the user answered "Pressed Esc once", mdpro re-activated, probe typed and saved.
4. D318 with menu and keys on d318-lists.md, as in the table. Save/reopen was done via ⌘W and ⌘O, and the conversion back restored the original sha.
5. D320 with d320-w.md (WYSIWYG) and d320-s.md (Source). The native menu enabled-state and accelerators were read via AX.
6. D319: a/README.md was opened in `main` (A, left), New Window ⌘⇧N plus b/README.md made B (right), and both entries appear under Open Recent. A word in A was selected by a real double-click. A compiled CGEvent tool clicked the Format (or File) title and then the item, then posted ⌘\` after a gap of 0 or 300 ms. It printed `item_up` and `switch_key` times (e.g. r1 item_up 14:08:31.974, switch_key 14:08:32.013).
7. Quit with ⌘Q. A quit prompt appeared for B's scratch README.md, and **Discard changes** was clicked (scratch copy only). `app.quit` at 14:29:18, no mdpro process after. Config restored and `cmp` OK, input source restored, lock released.

## Deviations (automation differs from a real user)

- **No Computer Use tools were available in this session.** The run was driven from the shell instead:
  - `screencapture` for evidence;
  - System Events (`osascript`) for keys and AX menu presses, gated on mdpro being the frontmost process before each input;
  - compiled CGEvent tools for real mouse clicks and the menu race.

  D318 and D320 menu invocations were AX presses on menu items, not mouse tracking. The D319 menu clicks were real HID mouse events on the menu bar.
- The first D317 attempt was voided. System Events `click at` is an AX press and did not place the caret, so `Q` landed at the document start. From then on the caret was placed by a CGEvent click, checked once with a control probe (`d317-caret-control*`).
- D317 Esc is reported in two kinds. **Synthetic** Esc was System Events `key code 53`, which reached keydown: `ui.dialog.escape` was logged. **Physical** Esc was pressed by the user. After the physical Esc, mdpro was re-activated through System Events before the probe, because the user had switched to the terminal to answer.
- External `open -a … d317-latin1.md` opens a **new window** (`file.open.route outcome:"new-window"`), not the active document, so it does not count. That window's dialog served as a synthetic-Esc probe (`focus:"none"`, no document) and was then closed.
- In the D319 Save setup, a double-click selects the whole paragraph in these editors. The later typed "C" therefore replaced B's paragraph in the scratch copy, and that content (40 bytes) is what the 0 ms Save wrote to b/README.md. This is my input, not an app defect.

## Surprising

1. **D319 race fails on the landed build exactly as on B5c.** The landed fix (`698fdd77`, `9b9cd404`) did not take effect for a real menu-bar click followed by ⌘\`. `via:"click_time"` never appeared. Each failing race has two `ui.menu.build` between A's `window.blur` and the dispatch (`recent_files.sync` and `mode_report source:"focus"`). That fits a capture lost or expired at the rebuild, but it is not proven: no log line records native Begin/WillSend or the capture, so this run cannot tell "Begin never observed" from "capture expired". **Save is the serious case**: the click in A wrote B's file.
2. Synthetic Esc through System Events `key code 53` did reach keydown here, under ABC (`ui.dialog.escape` logged). The skill's §9 records an earlier failure of this route.
3. ⌘⇧D, the stored v1 Delete Word key, does nothing in WYSIWYG, silently: no toast, no log. That matches v2 `<unassigned>`, so it is not a D320 failure, but the config still stores `editDeleteWord = Cmd+Shift+D`.
4. In WYSIWYG, each of the 8 D317 runs logged an `editor.milkdown.mount` (same documentId) about 1.2 s after the probe keystroke; Source logged none. The edit and focus were unaffected.
5. Source Math Block inserted `$$` directly under "Second paragraph ends here." with no blank line between (`d320-s-6-math-saved.md`).
6. D318 paragraph → bullet makes the next list serialize with `*` markers, which keeps the two adjacent lists separate. Expected under CommonMark; noted only.
