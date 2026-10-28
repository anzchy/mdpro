# Card MENU-D261-WI-1: menu-plan target-token acceptance on Windows

**Controlling AC** ([menu plan § 6, D261-WI-1](../../plans/20261015-plan-menu-reorganisation.md#6-work-items), quoted):

> Rust: the target is the window focused at event time; with none focused, editor and document actions are dropped with a log line and app-level ones (New, New Window, Open, Settings) keep today's handling. TS: focus changes after the click and before the handler runs → the action runs in the clicked window only; the document is switched during an await → `stale`, nothing applied; **switching away and back** during an await → `stale` (the generation moved); the Insert Table dialog opened from the menu, the document switched, then Insert pressed → nothing inserted into the other document, `stale` logged; two windows → exactly one acts.

The same plan row is amended in place to route no-focus App actions through `last_focused`/`any_live`; that fallback has no Windows per-window-menu equivalent. This card proves the Windows portion and shares fixtures with [D261](D261.md).

## Setup

- Use the verified `build-windows.yml` artifact from current `master`; record the full workflow `head_sha`, hashes, and `app.ready.releaseId == <version>-dev@<head_sha>`. Record 270% display scale and maximize to about 1120 CSS px or wider.
- With mdpro closed, snapshot configuration/drafts and copy `tests/manual-fixtures/d37-small-doc.md` to `%WIN_DIR%\fx\w036\menu-d261-a.md` and `menu-d261-b.md`; then use the remote Windows driver's labelled multi-window operations.
- Windows has one native menu per window. Mark the no-focused-window fallback **平台不适用**; do not synthesize it into a new requirement.

## Steps

1. `cli` — With restored, non-overlapping A and B, dirty A only and run labelled A `menuclick` File → Save. The route enters `src-tauri/src/menu.rs:366` and emits one target payload from `src-tauri/src/menu_target.rs:159`. Proof: one `menu.action.dispatch` success from `src-tauri/src/menu_target.rs:204` targets A; only A records `ui.menu.select` and becomes clean.
2. `cli` — In one `ui.sh` call, `menuclick` a harmless item in A and immediately `focus` B; repeat until the log proves focus moved before dispatch or record NOT EXERCISED. The window listener compares `payload.target` at `src/hooks/useMenuEvents.ts:103`. Proof: one dispatch and one A effect; any B `wrong_target` line at `src/hooks/useMenuEvents.ts:107` is a refusal, never an effect.
3. `cli` — Open Insert Table from A's menu, switch the active document away and back using the driver `open` operation, then submit. The monotonic generation rule is documented and enforced at `src/utils/menuTargetToken.ts:61`. Proof: `ui.menu.select` cancel with `reason:"stale"` and `stage:"table_submit"`, plus unchanged document bytes and no inserted table.
4. `cli` — Capture the log, close test windows, restore fixture/configuration snapshots while mdpro is closed per `.agents/skills/remote-windows-device-test/reference/config-isolation.md:48`, return mdpro to normal mode, and run driver cleanup per `.agents/skills/remote-windows-device-test/SKILL.md:133`. Proof: each window has a `window.close` line emitted at `src-tauri/src/main.rs:327` and visibly disappears; cleanup succeeds and restored hashes match.

## Failure condition

Fail if a menu click acts twice, B acts for A's click, a switch-away-and-back revives a token, a stale table inserts, or identity/setup evidence is absent. An ordering the driver did not actually force is NOT EXERCISED.
