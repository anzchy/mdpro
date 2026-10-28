# Card MENU-M3a: Windows per-window menu availability follows view mode

**Controlling AC** ([menu plan § 6, M3](../../plans/20261015-plan-menu-reorganisation.md#6-work-items), quoted):

> Focus: two windows in different modes, focus switches, a window closing, the mode reported late, **no focused window (mode-limited items disabled)**; a menu event while a modal or the Settings recorder has focus is not applied to the editor. Rust: id → action covers every `MENU_*` id; **a failed `set_enabled` is logged and the click-time check still refuses**

This is the M3a per-window native-availability slice. Windows owns one menu per window, so the quoted no-focused-window state is **平台不适用** here.

Current master rebuilds and installs a whole menu rather than calling `set_enabled`; this card maps the quoted failure criterion to that current install boundary and keeps the same click-time refusal oracle.

## Setup

- Install the current-master `build-windows.yml` development artifact and record workflow SHA plus installer/executable hashes. Confirm launch `app.ready.releaseId` is `<version>-dev@<full head_sha>`; stop on `unknown`.
- With mdpro closed, snapshot preferences/drafts and create scratch copies of `tests/manual-fixtures/d37-small-doc.md` under `%WIN_DIR%\fx\w036\`. Then record display scale (expected 270%), maximize to about 1120 CSS px or wider, and use two restored, non-overlapping windows.
- No persistent setting change is required. Restore the snapshot after the card while mdpro is closed.

## Steps

1. `cli` — Put A in WYSIWYG and B in Source using real View-menu `menuclick` operations. Each change reports through `src/hooks/useRecentFilesMenuRefresh.ts:43`. Proof: paired `ui.menu.mode_report` start/success lines from `src/hooks/useRecentFilesMenuRefresh.ts:55` name the new mode, and the document surface visibly changes.
2. `cli` — Run labelled `menus` for A. The rebuild uses the focused mode at `src-tauri/src/menu_availability.rs:200`. Proof: the latest A mode report is `success`; A's menu dump shows View → WYSIWYG checked and Format → Insert Table enabled.
3. `cli` — Run labelled `menus` for B. `allows_insert_table` accepts only WYSIWYG at `src-tauri/src/menu_availability.rs:85`. Proof: B's mode report is `success`; B's menu dump shows View → Source checked and Insert Table disabled. A's menu state remains unchanged.
4. `cli` — Focus A, change A to Source by labelled `menuclick`, and immediately dump A's menu. Proof: `view.mode.change` success is written at `src/stores/editorStore.ts:57`, followed by `ui.menu.mode_report` success; A now shows Source checked and Insert Table disabled.
5. `cli` — Trigger a mode change in A and close A immediately, before its mode report can settle; repeat three times. Reports originate at `src/hooks/useRecentFilesMenuRefresh.ts:43`, and the backend rebuild boundary is `src-tauri/src/menu_availability.rs:200`. Proof: record the actual success/fail/cancel result of any late `ui.menu.mode_report` for A; regardless of status it never changes B's menu and never mutates either fixture. If no run produces a report after close, mark the late-report subcase **NOT EXERCISED**, not PASS.
6. `cli` — Race mode reports and native-menu rebuilds to attempt a whole-menu install failure at `src-tauri/src/commands/menu.rs:28`. If `menu.recent_files.sync` reports `fail`/`install_failed` as emitted at `src-tauri/src/menu_recent.rs:277` for a still-live labelled window, use labelled native `menuclick` on that same item/window while its current mode disables the action. The click-time guard is `src-tauri/src/menu_availability.rs:107`. Proof: the install-failure log is followed by `ui.menu.availability`/`ui.menu.select` refusal and unchanged bytes; if no live-window install failure can be induced on the locked build, mark only that fault subcase **NOT EXERCISED**. A silent failure or a native-menu command effect is FAIL.
7. `cli` — With a modal or Keyboard Shortcuts recorder open in B, attempt a real editor-command key and a native editor-menu click with a same-route harmless control. The click-time guard refuses disallowed mode/focus at `src-tauri/src/menu_availability.rs:107`. Proof: `ui.menu.availability` or `ui.menu.select` cancel is paired with unchanged document bytes.
8. `cli` — Capture the log, close both windows normally, restore configuration/fixtures while mdpro is closed per `.agents/skills/remote-windows-device-test/reference/config-isolation.md:48`, return mdpro to normal mode, and run cleanup per `.agents/skills/remote-windows-device-test/SKILL.md:133`. Proof: each window has a `window.close` line emitted at `src-tauri/src/main.rs:327` and visibly disappears; cleanup succeeds and restored hashes match.

## Failure condition

Fail if either window's checked/enabled state follows the other window, a late report changes a live window, a menu-install failure is silent or bypasses click-time refusal, Insert Table is enabled or mutates a Source document, a modal/recorder lets an editor command through, or a mode/effect lacks its log pair. Do not fail the Windows build for the macOS-only no-focused-window case.
