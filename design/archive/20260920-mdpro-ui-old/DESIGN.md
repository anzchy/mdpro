# Design System — mdpro

A local-first Markdown editor for macOS. Tauri 2.0 + React 19 + Milkdown +
CodeMirror 6.

> **Location.** Moved from the repo root to `design/archive/20260920-mdpro-ui-old/` on
> 2026-09-11. It is still the authoritative design system for the shipped UI
> until the redesign in `design/` lands. The root
> `DESIGN.md` is an index.

This file captures the **aesthetic register**, the user-facing posture, and
the why behind specific token / pattern decisions. Enforceable rules live
in `.claude/rules/30-34`.

| If you need… | Read |
|---|---|
| The aesthetic and why | this file |
| Tokens (colors, type, spacing, z-index) | `.claude/rules/31-design-tokens.md` |
| Component patterns (modal, menu, button) | `.claude/rules/32-component-patterns.md` |
| Keyboard focus indicators | `.claude/rules/33-focus-indicators.md` |
| Light + dark theme rules | `.claude/rules/34-dark-theme.md` |
| The 6 universal discipline rules | `.claude/rules/30-ui-consistency.md` |

## Product context

- **What this is.** A local Markdown editor with WYSIWYG (Milkdown) and
  Source (CodeMirror) modes, plus HTML export. Files live on disk;
  there is no cloud sync.
- **Who it's for.** Writers who treat plain-text Markdown as the canonical
  format and want a Typora-class editing surface without locking into a
  cloud product. CJK users are first-class — line-height, letter-spacing,
  and font fallbacks must work for Chinese / Japanese / Korean text.
- **Project type.** Desktop app. macOS 13+ on Apple Silicon. No mobile,
  no Windows-first patterns. The Tauri 2.0 webview is the rendering
  surface; macOS conventions (traffic lights, native menu, system
  appearance) apply.
- **Constraints.** Local files only. No plugin system. HTML export only
  (no PDF/Word). Max file size 10MB. See `CLAUDE.md` § Constraints.

## The memorable thing

> A markdown editor that **respects the file**. What you type is what gets
> saved. What gets saved is what other tools see. No proprietary syntax,
> no hidden state, no vendor lock-in.

Every design decision should serve this. When two visual options are
equally good, pick the one that makes the underlying file the more
obvious primary artifact.

Concrete consequences:

- The Source mode is not a "nerdy fallback" — it's a peer to WYSIWYG with
  the same scroll position and the same selection behavior where
  ProseMirror permits. It defaults to a monospace face on new installs so
  the file's structure (table pipes, indentation, whitespace) stays
  visible; users can switch it to follow the editor font (decided
  2026-09-11, see the decisions log).
- Persistent state (image resize, table alignment) lives in standard
  Markdown syntax (GFM `:--` for table alignment) or in a documented
  inline marker (`{mdpro-width=N%}` for image width, see #389) — not in a
  sidecar JSON file or a database.
- Round-trip discipline is a design constraint, not just an engineering
  one: if a feature can't survive save → close → reopen, it doesn't ship.

## Aesthetic register

| Dimension | Choice | Why |
|---|---|---|
| **Direction** | Quiet, system-native, function-first | The editor disappears so the writing is foreground. The chrome is a frame, not a stage. |
| **Decoration level** | Minimal | One accent color, hairline borders, single soft shadow. Anything more competes with the content. |
| **Layout** | Grid-disciplined | Sidebar + main. Each pane has a job. No editorial / asymmetric layouts. |
| **Color** | Restrained: `#2563eb` (light) / `#60a5fa` (dark) accent on neutrals | Blue accent matches the macOS system blue family without copying it exactly. Single accent → no color-coded hierarchy. |
| **Typography (chrome)** | SF Pro Text → Avenir Next → Helvetica Neue | Native macOS register. Falls back gracefully on other systems. No `system-ui` (the "I gave up" signal). |
| **Typography (editor)** | User-controlled via Settings; default `-apple-system` | Editor body text is the user's call — they're reading and writing prose for hours. |
| **Spacing** | 4 / 8 / 12 / 16 / 20 / 40 px scale | Powers-of-two-ish, easy to remember, sufficient for the surfaces we have. Not over-systemized — the rule of three governs token introduction. |
| **Border radius** | 4 / 6 / 8 / 10 / 12 / 16 px | Smaller for chips and toolbar buttons, medium for inputs and popovers, larger for modals and file rows. |
| **Shadow** | Single `--shadow-soft` | One shadow keeps elevation consistent across modals, popovers, the recent-files dropdown, and toasts. |
| **Motion** | Minimal-functional | 0.1–0.2s transitions for hover and entrance. No scroll-driven motion. Respect `prefers-reduced-motion`. |
| **Theme** | Light + Dark + System (resolved to one of the two at runtime) | Class-based on `<html>`: `.theme-light` / `.theme-dark`. See rule 34. |

## What we deliberately don't do

- **No card grids.** mdpro has lists (file rows, tabs, TOC entries), not
  cards. A row is a row.
- **No icon-in-circle decoration.** The 3-column SaaS feature grid is the
  AI-slop signal we're farthest from.
- **No purple/violet gradients.** The accent is a flat solid blue.
- **No emoji as design.** Functional labels, no rocket-ship in headings.
- **No marketing-page surfaces.** mdpro is an app you open and use. There
  is no hero section, no testimonial block, no "designed for…" copy.
  The website (separate repo) handles that.
- **No "designed for X" / "built for Y" copy.** Functional naming. The
  Insert Table button says "Insert Table", not "Add a beautiful new table
  to your document".

## What other Markdown editors get wrong

(Calibration. We learn from these.)

- **Notion.** Beautiful but the file is not the artifact — the database
  is. Fundamentally different posture from mdpro.
- **Bear / iA Writer.** Right posture (file-first), but proprietary
  Markdown extensions break round-trip with other tools. mdpro stays in
  GFM where possible.
- **Typora.** Closest cousin. Reuse what works (cell-Tab, drag-resize
  images, right-click menus). Diverge on round-trip discipline (Typora's
  table widths don't survive standard markdown — mdpro documents this
  explicitly as session-local).
- **Obsidian.** Plugins-first, which we explicitly aren't. Different
  product class.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-02 | Initial DESIGN.md + `.claude/rules/30-34` created | Audit of vmark and claudepot-app rule sets; mdpro adopts the file-split structure with mdpro-specific tokens and patterns. Triggered by `/design-consultation` after table-CRUD plan-design-review surfaced the missing system. |
| 2026-05-02 | `.theme-light` / `.theme-dark` over `[data-theme]` | Already shipped in `App.tsx`. Pinning the convention; migrating away would cost more than it saves. |
| 2026-05-02 | Plain `outline` focus on buttons (not vmark's U-shape) | Matches macOS native button focus. mdpro's existing chrome relies on it. Migration would be coordinated, not piecemeal. |
| 2026-05-02 | Single accent (`--color-accent`) + soft variant (`--color-accent-soft`) | Multiple accents create implicit hierarchy. mdpro doesn't have categories of action that warrant it. |
| 2026-05-02 | No primitive spacing scale yet (`--space-*`) | Rule of three: introduce semantic tokens when 3+ unrelated sites share the value. Premature primitive scales are noise. |
| 2026-05-03 | Added `--color-accent-soft`, `--color-danger`, `--color-danger-soft` (table-CRUD WI-1.9) | Migrates 7 hardcoded `rgba(37, 99, 235, …)` and `#dc2626` sites to tokens. `*-soft` variants use `color-mix(in srgb, base N%, transparent)` so a future accent rebrand stays local. Unblocks the destructive-action treatment in WI-1.3 (table context menu) and the cell-highlight in WI-1.6. |
| 2026-09-11 | UI direction: canvas Direction A's register (Quiet paper) with Direction B's structure (Command surface) | Tone, space and hairlines keep the quiet register. B's mode switch, command palette and status readouts serve keyboard users without its 2px boxes or density. Concrete edits: `design/reviews/20260911-codex-ui-review.md` §1. |
| 2026-09-11 | Source mode defaults to monospace on new installs; a "Source font" preference (Monospace / Follow editor font) keeps existing profiles on the editor font | "Respects the file": aligned tables and visible whitespace. `fontFamily: "system"` can't tell an untouched default from an explicit choice, so an upgrade must not change fonts silently. CJK falls back to the system CJK face, so tables containing CJK still won't align exactly. Revises the "same fonts" clause under The memorable thing. Codex was consulted; see `design/reviews/20260911-codex-ui-review.md` item 3. |
| 2026-09-11 | No second hue in Source syntax highlighting: markers use the accent, meta uses muted, code uses text | Keeps the single-accent register (2026-05-02 entry). Green already signals success and diff additions, so a green code hue would carry two meanings. Code stays distinguishable through fences, the code background and the mono face. |
| 2026-09-11 | Keep the current cool neutral family; adopt only derived mechanics (text-mixed borders and hover) | The cool cast matches the blue accent, and "system-native" is about behavior, not equal RGB channels. Untinted grays would move from borrowing Codex's mechanics to copying its look, at a large QA cost. |
| 2026-09-12 | Removed `--color-preview-bg` from `globals.css` and both theme files | Its only reader was `ImageRenderer.tsx`, deleted with the Preview pane in the stage-2 dead-code cleanup (`15b9d35`). A token that is declared but never read invites a future surface to adopt a color chosen for a pane that no longer exists. Rule 31 requires both theme files to change together, so all three declaration sites go in one commit. Recover the values with `git show 15b9d35^:src/styles/themes/dark.css`. |

Append entries when making non-trivial design decisions. Future decisions
get rationale, not just "we chose X".

## When to read this file

- **Before** starting any UI work — confirm the surface fits the register.
- **During** review — flag anything that drifts from the register without
  a stated reason.
- **When you propose a new pattern** — write the decision down here so
  the next person inherits the reasoning, not just the result.
