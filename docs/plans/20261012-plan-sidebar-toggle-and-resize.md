# Plan: sidebar toggle button and resizable sidebar

**Status:** for review (2026-10-13). Decisions recorded; no code written.
**Base:** `master` @ `b722653`.
**Prototype:** [`design/prototypes/001-adr0088-sidebar-toggle.html`](../../design/prototypes/001-adr0088-sidebar-toggle.html)
(open it in a browser; the URL accepts `?open=0&variant=b&width=756&theme=dark`).
**Decision record:** [ADR-0088](../adr/0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md) (Accepted 2026-10-12).
**Related:** issue [#416](https://github.com/anzchy/mdpro/issues/416) / D189 (sidebar collapses at
≤960 px), [`DESIGN.md`](../../design/DESIGN.md) (the design contract).

## 1. Goal

1. A visible, clickable control to hide and show the sidebar, in the window's bottom-left
   corner, that never moves. Today the only routes are View → Toggle Sidebar and ⌘⇧L.
2. The sidebar keeps the same width at every window width: full screen, ½ screen, ⅓ screen
   (fixes #416).
3. The user can drag the sidebar's right edge to set its width, and the width is remembered.

## 2. Decisions taken (user, 2026-10-12)

| # | Question | Decision | Rejected |
|---|---|---|---|
| D-1 | Where does the toggle live? | **Variant B**: one button, fixed as the first item of the bottom tab bar; its icon and label swap between Hide and Show. | **Variant A** (VMark): a close button in the sidebar footer while open, plus an open button in the status bar while closed. Lost because the button jumps about 200 px after each click, so the user has to find it again to undo. |
| D-2 | Should the sidebar be resizable? | **Yes**, by dragging its right edge; the width persists. | Fixed 220 px only. It's simpler, but every competitor we checked lets the user size the outline. |

Both answers were given in chat (「1. B 2. 好的」) and are recorded in [ADR-0088](../adr/0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md). Both change
`DESIGN.md` (§ Layout has a fixed sidebar and no resize handle); those edits are SB-0.

## 3. Research: how VMark does it

Source: `xiaolai/vmark` @ `7916d41` (2026-10-12), read from the code, not screenshots. The
main points were re-checked in a local clone.

- **Two buttons, not one.**
  - Open sidebar: lucide `PanelLeftClose` (a panel with a `<`), 28 × 28, at the **right**
    of the sidebar footer (`src/components/Sidebar/Sidebar.tsx:253-262`,
    `.sidebar-footer { justify-content: flex-end }`).
  - Closed sidebar: the whole sidebar unmounts. A lucide `PanelLeft` button, 24 × 24, appears
    first in the status bar's left cluster (`src/components/StatusBar/StatusBar.tsx:200-213`).
  - That second button was added for VMark issue #212: after collapsing, users couldn't get the
    sidebar back.
- **Look.** Icons are 14 px at lucide's 2 px stroke. The button is transparent; hover gives a
  6 % wash plus text colour. Focus is a 2 px accent bar, not a ring. Tooltip and `aria-label`
  share one string, e.g. "Close Sidebar ⌃⇧0". `aria-expanded` is bound to the live state.
- **Sidebar behaviour.**
  - Width: default 260, min 180, max 480 (`src/stores/uiStore.ts:44-46`).
  - The right edge is a drag handle: 4 px painted, 12 px hit area, `role="separator"`, arrow
    keys step it.
  - No collapse animation, and no auto-collapse at narrow window widths.
  - Hidden by default. Width and visibility are restored through hot-exit.
- **Codex desktop app.** OpenAI's command reference lists *Toggle sidebar* as ⌘B. How its
  button looks is not publicly documented; I found no evidence that VMark copied Codex.

## 4. Design (what to build)

### 4.1 Toggle button (D-1, variant B)

| Aspect | Spec |
|---|---|
| Place | `BottomTabs`, first child, before the New Document `+`, then a hairline separator. It stays in the same place in both sidebar states. |
| Box | The DESIGN.md icon button: 24 px square, `--radius-control`, transparent. Rest: `--color-muted`. Hover: `--color-hover` fill with `--color-text`. Pressed: a stronger mix. Focus: rule 33 outline in `--color-focus-ring`. |
| Icon | Sidebar shown: `panel-left-close` (rect `3,3,18,18 rx2`, `M9 3v18`, `m16 15-3-3 3-3`). Sidebar hidden: `panel-left` (rect plus divider). Both use DESIGN.md's set: 24 viewBox, 1.75 stroke, round caps and joins, `currentColor`, `--icon-size-md`. No new dependency: inline SVG, the same geometry as lucide. |
| Name | `aria-label` and `title` read "Hide Sidebar" or "Show Sidebar", plus the platform shortcut (⌘⇧L on macOS, Ctrl+Shift+L elsewhere). `aria-expanded` follows `showSidebar`; `aria-controls` points at the sidebar's id. |
| Behaviour | Calls `useSidebarPreference().toggle()`, the same path as the menu and ⌘⇧L. That hook stays the only non-store writer of `showSidebar` (SB8 pin). Focus stays on the button after the click because the button doesn't unmount. |
| Motion | None. The sidebar appears and disappears instantly (DESIGN.md § Motion, DR12). |
| Logging | Reuse `ui.sidebar.preference` / the `preferencesService` write; add `ui.sidebar.toggle` with `{ source: "button" }` so button use can be told apart from the menu and the shortcut. |

### 4.2 Fixed width at every window width (#416)

- Remove `.app-shell { grid-template-columns: 1fr; }` from the `@media (max-width: 960px)`
  block in `src/styles/sections/responsive.css`. That block changes the columns without the
  areas, which is the cause recorded in #416.
- **Keep** the `.split-view` / `.split-pane` rules there: Source mode still renders
  `div.split-view > div.split-pane.full-pane` (`SplitView.tsx:19-20`). Only `.split-divider`
  is unused. The issue body said all the `.split-*` rules look dead; only `.split-divider` is
  (corrected in a comment on #416).
- Pin the sidebar column so no later rule can squeeze it: `grid-template-columns:
  var(--sidebar-width-current) minmax(0, 1fr)` and `min-width` on `.sidebar`.

### 4.3 Resizable sidebar (D-2)

| Aspect | Proposed (review) |
|---|---|
| Range | Default **220 px** (today's `--sidebar-width`), min **180**, max **480** (the VMark range). |
| Handle | Right edge of the sidebar: 1 px hairline at rest (the existing border), a 2 px `--color-border` bar on hover or drag, and a **10 px hit area** centred on the edge. Cursor `col-resize`. `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`, label "Resize sidebar". |
| Keyboard | Focusable. ←/→ step 8 px, Shift+←/→ step 32 px, Home/End jump to min/max, Enter or double-click resets to 220. Rule 33 focus outline. |
| Write policy | During a drag only the CSS variable changes; one preference write on `pointerup` (or keyboard step settle), never per frame. Same no-write-before-hydration policy as `useSidebarPreference` (P1). |
| Narrow windows | The sidebar keeps its stored width. Only when the main column would drop below **320 px** does the *rendered* width clamp: `clamp(180, stored, windowW − 320)`. The stored value is untouched, so widening the window restores it. At the default 220 this never triggers above a 540 px window (window min is 400). **Review question 1.** |
| Persistence | New preference `sidebarWidth: number` (Rust `models/preferences.rs` field with a serde default of 220; TS `types/preferences.ts`; `preferencesService` default). Out-of-range or non-finite values are clamped on read, never written back silently. |
| Multi-window | One global value, like `showSidebar` (every window reads it on mount; a drag writes it). Per-window widths are out of scope. |
| Logging | `ui.sidebar.resize` with `{ from, to, source: "drag" | "keyboard" | "reset" }`, once per settle. |

### 4.4 DESIGN.md changes (ship with the ADR)

- § Layout → Sidebar: add the resize handle, the 180–480 range and the narrow-window clamp.
- § Components: add a **Sidebar toggle** contract (4.1) and a **Resize handle** contract (4.3).
- § Icons: list the two new glyphs.
- Rules 30–34 need no change if the specs above hold; verify against rule 33 (focus) and
  rule 31 (tokens: any new token goes in both theme files in the same commit).

## 5. Work items

Branch per item, `<type>/<id>-<slug>` off `master` in its own worktree, landed by the delegator
(rule 70). The receipt ids carry the D/WI prefix assigned by the delegator.

| WI | Scope | Files (expected) | Tests (rule 10) |
|---|---|---|---|
| **SB-0** | DESIGN.md edits (§ 4.4) + prototype updated to variant B only, with a resize handle. ADR-0088 itself is done. | `design/DESIGN.md`, the prototype | none (docs) |
| **SB-1** | #416 fix: drop the media-query override, pin the column | `src/styles/sections/responsive.css`, `app-shell.css` | Layout test: rendered sidebar width at 1512 / 961 / 960 / 756 / 504 px equals `--sidebar-width` (jsdom has no layout, so this belongs in the Milkdown/browser suite or a headless-Chrome check like the #416 repro) |
| **SB-2** | Toggle button (variant B) | `src/components/BottomTabs/BottomTabs.tsx` + `.css`, a small `SidebarToggleButton.tsx`, icon SVGs, `App.tsx` wiring | Component: role/name/`aria-expanded`/`aria-controls`, label swaps, click calls the hook's `toggle` once, focus stays; SB8 pin still green |
| **SB-3** | `sidebarWidth` preference end to end | `src-tauri/src/models/preferences.rs` (+ tests), `src/types/preferences.ts`, `src/services/preferencesService.ts`, `src/stores/editorStore.ts` | Rust: default, clamp on read, round-trip; TS: hydration policy P1 for width, the write count |
| **SB-4** | Resize handle | new `src/components/Sidebar/SidebarResizeHandle.tsx`, `src/hooks/useSidebarResize.ts`, `app-shell.css` | Hook: clamp, keyboard steps, reset, one write per settle, narrow-window rendered clamp vs stored value |
| **SB-5** | Ledger + changelog + device check | `docs/feature-ledger.md` (rows 104 / 112 / new resize row, `pnpm ledger:check`), `CHANGELOG.md` | Device: macOS full / ½ / ⅓ screen, both themes, keyboard-only, and the Windows build (see the W1 shortcut defect below) |

Order: SB-0 → SB-1 (independent, can ship first; it closes D189 / #416) → SB-3 → SB-2 / SB-4.

## 6. Acceptance Criteria

- [ ] At window widths 1512, 960, 756 and 504 CSS px the sidebar renders at the stored width (220 by default), measured in a real webview.
- [ ] A button at the bottom-left of the bottom tab bar hides and shows the sidebar; it does not move between the two states.
- [ ] The button's accessible name and tooltip read "Hide Sidebar" / "Show Sidebar" with the platform shortcut, and `aria-expanded` matches the sidebar state.
- [ ] Button, View → Toggle Sidebar and ⌘⇧L produce the same state and exactly one preference write per toggle; the SB8 single-writer pin stays green.
- [ ] Hiding and showing the sidebar has no animation.
- [ ] Dragging the sidebar edge resizes it between 180 and 480 px; releasing writes the width once; relaunching restores it.
- [ ] The resize handle works from the keyboard (arrows, Shift+arrows, Home/End, Enter reset) and shows the rule-33 focus outline.
- [ ] Below the narrow-window threshold the rendered width clamps while the stored width is unchanged; widening the window restores it.
- [ ] Both themes match the prototype; no new icon dependency; DESIGN.md and the ADR are updated in the same effort.
- [ ] `docs/feature-ledger.md` rows rewritten in the commits that change behaviour; `pnpm ledger:check` passes.

## 7. Open questions for review

1. **Narrow-window clamp (4.3):** clamp the *rendered* width when the main column would go
   below 320 px, or never clamp (the user's sidebar always wins, the editor can get very
   narrow)? The plan proposes the clamp.
2. **Range:** 180–480 (VMark) or tighter, e.g. 180–360, given mdpro's sidebar is only the TOC?
3. **Default visibility:** stays shown (mdpro today). VMark defaults to hidden.
4. **Shortcut:** keep ⌘⇧L, or add ⌘B like the Codex app? ⌘B is bold in the editor today, so
   the plan keeps ⌘⇧L.
5. **Windows:** the tooltip shows Ctrl+Shift+L, but on Windows 0.3.1 *no* app shortcut fires
   (`useKeyboardShortcuts.ts:84-86`, from the 2026-10-12 Windows audit). The button is the only
   keyboard-independent route there until that is fixed. Track separately or fold in?
6. ~~Issue #416 correction~~: posted 2026-10-13 ([comment](https://github.com/anzchy/mdpro/issues/416#issuecomment-6135384009)).

## 8. Not in scope

- Per-window sidebar width, sidebar views other than the TOC (file tree, search), and a
  collapsible icon rail as in VMark's activity bar.
- Animation of the sidebar width (DESIGN.md DR12 forbids it).
