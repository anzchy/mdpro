# ADR-0136 placement: third mode, Source layer, or both editors (2026-10-23)

The user asked: 「请opus-auditor 和gpt-auditor，同时评估一下：adr0136 是单独生成一个mode (和source mode, WYSIWYG mode 并列），还是说依托于source mode or WYSIWYG mode，从UX、操作便捷性、带来的代码复杂度等方面评估」.
Both auditors assessed it blind, at `c07702d0`. The user's ruling afterwards: 「Stick to B, based on opus and codex audit」.
This record keeps the two options ADR-0136 never listed, so they are not proposed again from scratch. The ADR is
Accepted and its body stays as written.

## Options

- **A. A third editor mode** beside Source and WYSIWYG. Both reject it.
  - `ViewMode` is the rendering surface (`src/types/editor.ts:1`, `src/App.tsx:926`), not an input state. It has
    about 33 readers in `src/` and three Rust mirrors (`menu_availability.rs:19-39`, `models/preferences.rs:146`,
    `menu.rs:300,363`).
  - Either typing still works, which makes it Source under another name, or it doesn't, which makes it Vim Normal
    mode. ADR-0136 Decision 3 forecloses that sticky mode.
  - Getting in and out is a full mode switch, which flushes the document, can be refused (ADR-0071) and is
    persisted (ADR-0053). Off macOS, the Ctrl+/ cycle grows to three steps (ADR-0096).
  - It needs a new ADR superseding ADR-0136 Decision 3, plus amendments to ADR-0096 and ADR-0053.
- **B. A layer in Source mode only**, as ADR-0136 decides. Both recommend it. It needs no new ADR.
- **C. One controller in both Source and WYSIWYG.** Both see it as the best end state and a later project.
  - In WYSIWYG, "paragraph", "word", "line end" and selection mean different things: block nodes, hidden Markdown
    syntax, table cells and atom node selections.
  - A selection landing inside hidden syntax or at a cell edge can make the next keystroke edit the wrong node.
  - It needs a second implementation of every motion. `MilkdownEditor.tsx` (299 lines) must be split first.
  - It needs a new ADR superseding ADR-0136's "Foreclosed: WYSIWYG navigation keys" and the prefix row's `S` scope.

## Size estimates (not measured)

| | Opus | Codex |
|---|---|---|
| B | 12–18 files, +1.2k–1.8k lines | 30–45 files, 2.5k–4.5k lines |
| A | 40–55 files, +2k–3k lines | 55–80 files, 3.5k–6.5k lines |
| C | B + 10–15 files, +0.9k–1.4k lines | 45–65 files, 4k–7k lines |

Codex counts the Settings, preference, migration and multi-window work more fully. Plan with its figures.

## Carried into B's implementation brief (no change to the ADR)

1. **Shared parts stay host-free.** The key classifier, the CJK word model, the action table, the indicator and the
   help do not import CodeMirror. Only the motions and the keydown hook do. C then adds to B rather than rewriting it.
2. **What WYSIWYG shows when the prefix is pressed.** With the feature on, Ctrl+; in WYSIWYG does nothing. Whether
   it shows a one-line "navigation works in Source mode" hint is decided in the indicator's design contract and
   prototype (ADR-0136 Decision 6). The hint never arms the layer.
3. **A cost the ADR does not name.** Coming from WYSIWYG, a writer pays a mode switch (⌃2). They lose the rendered
   view while navigating, and the switch is a user choice that sets the next launch's `lastViewMode`
   (`editorStore.ts:79-85`, ADR-0053). The device batch checks this round trip.
4. **MCP.** MCP sync reads only CodeMirror's caret (`useMcpSync.ts:81-87`). B is consistent with that. C must not
   promise WYSIWYG caret tracking.

## Sources

The full reports, not committed: `~/.mdpro-redesign/herdr-spike/gpt-auditor/ADR-0136-mode-assessment.md` and
`~/.mdpro-redesign/herdr-spike/opus-auditor/ADR-0136-mode-assessment.md`.
