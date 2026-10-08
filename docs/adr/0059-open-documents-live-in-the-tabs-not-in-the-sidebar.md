# 0059. Open documents live in the tabs, not in the sidebar

**Status**: Accepted (2026-10-08, user decision). Proposed 2026-10-08.

## Context

mdpro has two sidebar components. `TOCSidebarContainer`
(`src/components/Sidebar/index.tsx`) is the live one: the outline, the mode badge,
⌘⇧L. `Sidebar.tsx` + `FileItem.tsx` are a vertical list of open documents (select,
close, dirty marker, Discard confirmation) that `App.tsx` has never rendered; the
bottom tabs (`src/components/BottomTabs/BottomTabs.tsx`) do the same job.

Plan P A8 lists the pair as a dead-code candidate, "list them, do not delete them",
and says deletion is tracked in `TODOS.md`. It is not: `TODOS.md` has no entry, so
the files had no owner. The cost surfaced on 2026-10-07: D48's device retest could
not run F-3 (close from the Sidebar) because no path in the app reaches the
component, yet its unit test (DW-2) and CSS still had to be maintained.

A competitor survey (2026-10-08,
[`docs/reference/20261008-sidebar-competitor-research.md`](../reference/20261008-sidebar-competitor-research.md);
12 products, six read from source) found:

- Every product with always-on tabs (VS Code, VMark, Zettlr, Obsidian, SiYuan) shows
  open documents in one place only, the tabs. The sidebar is for navigation:
  outline, file tree, search.
- VS Code shipped an Open Editors list next to its tabs and hid it by default in
  1.53, because "its functionality … is covered … like tabs".
- MarkText is the one exception, and it hides its tab bar by default — the opposite
  of mdpro's premise.
- VMark, the closest stack (Tauri + React, tabs at the bottom), has Files / Outline /
  History in its sidebar and no open-documents list.

Reviving the list would also mean rewriting it: the close button is a text "x" with
no accessible name, there is no keyboard navigation, and the dirty marker is " *".

## Decision

1. **Open documents are shown in the bottom tabs only.** The sidebar is a
   navigation surface (outline today; a file tree if one is ever built), never a
   second document switcher.
2. **Delete `Sidebar.tsx`, `FileItem.tsx`, their CSS** (`.sidebar-empty`,
   `.sidebar-list`, `.file-item*` in `src/styles/globals.css`) **and the tests that
   exist only for them**: DW-2 in `tests/discard-dialog-focus-wiring.test.tsx` and
   the `.file-item.is-active` token case in `tests/design-tokens-accent-danger.test.ts`.
   This overrides plan P A8 for these two files only; A8's other candidates
   (`src/App.css`, `src/components/TabBar/`) are untouched.
3. **A file tree is not decided here.** Whether mdpro gets one (the archived
   workspace plan, or Typora's "load the file's parent folder") is a separate
   feature decision with its own plan and ADR.

## Consequences

- One fewer unreachable surface: no unit test guards a path no user can take, and
  device checklists stop carrying rows that cannot run.
- The D48 invariant (discard dialogs open on Keep editing) stays guarded by DW-1/DW-3
  (BottomTabs and App) and CD-11..13.
- Cost: a user who wants a vertical list of open files — long names, many documents
  — has no option; the bottom tabs must carry that load (overflow and long-title
  handling become the tabs' problem, e.g. in WI-4.x).
- Cost: if a file tree later wants an "Opened files" section (MarkText style), it
  is written fresh; nothing is kept to reuse, though there was little worth reusing.
- Cost: plan P A8 now has an exception that a reader must follow to this ADR.
- The sidebar keeps a fixed 220 px width and a single panel; competitors converge on
  a resizable, persisted width and a panel switcher. That gap is recorded in the
  survey, not decided here.
