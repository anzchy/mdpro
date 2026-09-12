# UI redesign plan — Appendices

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Appendix A — Literal classification (filled in WI-0.2)

| File:line | Selector | Property | Value | Class (a/b/c) | Target token / exception | Stage |
|---|---|---|---|---|---|---|
| _to fill_ | | | | | | |

## Appendix B — QA surface matrix (filled in WI-0.3 / WI-0.4)

| Surface | Reference | Runs under | Light before | Dark before | Light after | Dark after | Size / scale | Notes |
|---|---|---|---|---|---|---|---|---|
| Main window — Source | has reference | `pnpm dev` | | | | | | |
| Main window — WYSIWYG | no reference: the proposal draws Source only (:386-427) | `pnpm dev` | | | | | | Compare the chrome with the Source shot; content follows DESIGN.md § Tokens |
| Main bar — sidebar shown and hidden | has reference (Board 1) | `pnpm dev`; drag region and traffic lights in Tauri | | | | | | New in WI-4.8; "before" is the mode label |
| Status strip | has reference (Board 1) | `pnpm dev` | | | | | | New in WI-4.8; no "before" shot |
| Narrow window — 400×640 with the sidebar shown and hidden; 959px wide | no reference (DR16) | `pnpm dev` viewport; confirm in Tauri | | | | | | Main bar, status strip and bottom tabs; nothing clips |
| Settings dialog at 400×640 | no reference (DR16) | `pnpm dev` viewport; confirm in Tauri | | | | | | Icon-only rail; rows wrap |
| Sidebar / TOC active row | has reference | `pnpm dev` | | | | | | |
| Insert modal / link modal | no reference; the shell, type steps and buttons follow the proposal's mini-dialog (:538-544) | `pnpm dev` | | | | | | |
| Table and image context menus | table menu has reference (:546-557); image menu no reference, follows the table menu | `pnpm dev` | | | | | | WI-4.15: also capture the image menu with Custom… open |
| Settings — each page | Integrations / Export / Editor drawn; others no reference | `pnpm dev` / Tauri | | | | | | All eight row panels get the WI-4.3 row markup; Shortcuts and About keep their layouts |
| Toasts | has reference (:558-564) | `pnpm dev` | | | | | | |
| Preview pane | none: not mounted since `4570de3` (DR10) | n/a | n/a | n/a | n/a | n/a | | Dead-code candidate (A8); no screenshots |
| Recent files | none: the native "Open Recent" submenu (`menu.rs:73-96`), which the app doesn't style | Tauri | n/a | n/a | n/a | n/a | | No in-app dropdown exists. Check that labels are file names only (`menu.rs:65-71`) and that the empty submenu shows a disabled "No Recent Files" item |
| Disabled-with-reason button | has reference (:535-536, a static swatch) | `pnpm dev`, at whatever disabled button WI-0.3 finds | | | | | | The proposal's example string isn't in `src/`. If WI-0.3 finds no disabled button with a reason, mark the row n/a |
| External-change dialog — changed / changed with edits / deleted | local mockup only (DR1, not committed) | Tauri | | | | | | Rebuilt in WI-4.10 (DR5); one shot per state |
| Draft recovery and encoding dialogs | no reference; compare with the external-change dialog | Tauri | | | | | | Token changes only; the same shell, type steps and buttons as the other dialogs |
| Drag-and-drop target, six states (WI-4.12) | local mockup only (DR1, not committed) | Tauri | | | | | | Also cancel a drag with Esc and check the target clears |
| Empty / no-tabs state | has reference (proposal :607-609, a static swatch) | `pnpm dev` | | | | | | Today: a blank read-only editor (`App.tsx:1136-1146`) |
