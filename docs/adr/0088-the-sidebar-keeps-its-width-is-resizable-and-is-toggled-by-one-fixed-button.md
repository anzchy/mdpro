# 0088. The sidebar keeps its width at every window width, is resizable, and is toggled by one fixed button in the bottom tab bar

**Status**: Accepted (2026-10-12). User's words: 「1. B 2. 好的」, answering "variant A or B?"
and "should the sidebar become resizable?" after reviewing the prototype
[`docs/design/mdpro-ui-new/prototypes/sidebar-toggle.html`](../design/mdpro-ui-new/prototypes/sidebar-toggle.html).
Decided by the user, recorded by mdpro-codex-audit. Amends
[`DESIGN.md`](../design/mdpro-ui-new/DESIGN.md) § Layout (sidebar) and adds two component
contracts; the plan is
[`docs/plans/20261012-plan-sidebar-toggle-and-resize.md`](../plans/20261012-plan-sidebar-toggle-and-resize.md).

## Context

- **No visible control.** The sidebar (the TOC) can be hidden only from View → Toggle Sidebar
  or ⌘⇧L. Nothing on screen shows it can be hidden, or how to get it back.
- **It collapses in narrow windows** ([#416](https://github.com/anzchy/mdpro/issues/416)).
  - When the window is 960 CSS px or narrower (½ or ⅓ of a Mac screen), the sidebar is
    squeezed to about 33 px and its content is clipped.
  - The cause is a leftover `@media (max-width: 960px)` rule in
    `src/styles/sections/responsive.css`. It sets `.app-shell` to one column but leaves its
    two-column grid areas.
  - `master` @ `b722653`, measured in headless Chrome:

    | Window width | Sidebar width |
    |---|---|
    | 961 px | 220 px |
    | 960 px | 180 px |
    | 756 px | 33 px |
    | 504 px | 33 px |

  - The same collapse was seen on the Windows 0.3.1 build at 270 % display scaling.
  - The user's requirement is the same sidebar width at full, ½ and ⅓ screen.
- **The width is fixed.** `DESIGN.md` gives the sidebar a fixed `--sidebar-width` of 220 px
  with no resize handle.
- **Reference app.** The user cited VMark's bottom-left sidebar button.
  - Its source (`xiaolai/vmark` @ `7916d41`) shows two separate buttons:
    - lucide `PanelLeftClose` at the right of the sidebar footer while the sidebar is open
      (`src/components/Sidebar/Sidebar.tsx:253-262`);
    - lucide `PanelLeft` first in the status bar while it is closed
      (`src/components/StatusBar/StatusBar.tsx:200-213`).
  - The second button was added after VMark issue #212: users could not reopen a collapsed
    sidebar.
  - VMark's sidebar is resizable (180–480 px, default 260), has no collapse animation, and
    never collapses because the window is narrow.
  - OpenAI's Codex app documents ⌘B for *Toggle sidebar*. How its button looks is not
    publicly documented.

## Options considered

**Toggle placement**

- **A. VMark's two buttons.** A close button in the sidebar footer and an open button at the
  window's bottom-left. Lost:
  - Each click moves the control about 200 px, so a second click to undo means finding it
    again.
  - There are two components and two accessible names to keep consistent.
- **B. One fixed button, first in the bottom tab bar, that swaps its icon and label.**
  Chosen. It stays in the same place in both states, so a second click undoes the first.
- **C. A button in the main bar, next to the breadcrumb.** Not prototyped:
  - The main bar's left edge moves when the sidebar hides, because it has to clear the
    traffic lights.
  - The user asked for the bottom-left.

**Sidebar width**

- **Keep it fixed at 220 px and only fix #416.** Lost: the user wants it resizable, and every
  editor compared (VMark, Obsidian, Typora) lets the user size the outline pane.
- **Resizable, with an auto-collapse breakpoint** (common in web apps). Lost: it is exactly
  the behaviour #416 reports as a bug. Hiding the sidebar is the user's choice, never a side
  effect of window size.
- **Resizable, keeping its stored width at every window width.** Chosen. The one exception:
  the *rendered* width clamps so the main column keeps 320 px, and the stored value is never
  changed by that clamp.

## Decision

1. **One toggle button** sits first in `BottomTabs`, before New Document.
   - Icons: `panel-left-close` while the sidebar is shown, `panel-left` while it is hidden.
     They are drawn to `DESIGN.md`'s icon contract: 24 viewBox, 1.75 stroke, `currentColor`,
     no new dependency.
   - The box is a `DESIGN.md` icon button.
   - Its accessible name and tooltip are "Hide Sidebar" or "Show Sidebar" plus the platform
     shortcut. `aria-expanded` and `aria-controls` are set.
   - It calls the same `useSidebarPreference().toggle()` as the menu and ⌘⇧L, so that hook
     stays the single writer of `showSidebar`.
2. **The sidebar keeps its width at every window width.**
   - The `.app-shell` override in the 960 px media query is removed.
   - The rules on `.split-view` / `.split-pane` in that block stay, because Source mode uses
     them.
3. **The sidebar is resizable** by dragging its right edge or from the keyboard.
   - Range 180–480 px, default 220.
   - Arrow keys step 8 px and Shift+arrow 32 px; Home/End go to min/max; Enter or
     double-click resets to 220.
   - The width is a new global preference, `sidebarWidth`, written once per drag or step and
     clamped on read.
   - The rendered width is `clamp(180, stored, windowWidth − 320)`.
4. **No animation.** Hiding, showing and resizing are instant (`DESIGN.md` DR12).
5. **The shortcut stays ⌘⇧L.** ⌘B is bold in the editor.

## Consequences

- **Gains:**
  - The sidebar can be found and restored without the menu or the shortcut.
  - #416 is fixed.
  - Users can size the outline.
  - The button does not move, so a second click undoes a misclick in place.
- **Costs:**
  - A new persisted preference (`sidebarWidth`): a Rust model field with its serde default,
    TS types, a hydration policy, and migration of existing config files (an absent field
    reads as 220).
  - Another separator-role control to keep accessible and covered by tests.
  - The bottom tab bar loses about 30 px to tabs.
  - A user who drags the sidebar to 480 px on a small window gets a clamped sidebar. The
    stored and rendered widths can differ, which a later reader has to know.
- **Forecloses:**
  - A responsive, auto-collapsing sidebar. Any narrow-window behaviour has to keep the
    sidebar's width.
  - VMark's two-button pattern.
  - A sidebar slide animation, unless `DESIGN.md` DR12 is superseded first.
- **Windows caveat:** in 0.3.1 no app shortcut fires on Windows
  (`useKeyboardShortcuts.ts:84-86`, Windows ledger audit W1). Until that is fixed, this
  button is the only keyboard-independent way to toggle the sidebar there.
- **Rule 33 and 31 obligations:**
  - The resize handle and the button follow the focus-indicator rule (33).
  - Any new token goes in both theme files (rule 31).
