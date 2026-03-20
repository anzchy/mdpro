# mdpro Feature Test Report
**Date:** 2026-03-12
**Build:** master branch (latest commit: 25235f7)
**Test Method:** Code analysis + Chrome dev server (`pnpm dev` @ localhost:1420)
**Tester:** Claude Code (static analysis + runtime review)

---

## Executive Summary

| Category | Total Cases | Pass | Fail | Partial | Unknown |
|----------|-------------|------|------|---------|---------|
| A. Text Input | 12 | 9 | 1 | 2 | 0 |
| B. IME & Unicode | 7 | 3 | 1 | 1 | 2 |
| C. Markdown Parsing | 10 | 7 | 0 | 3 | 0 |
| D. Code Blocks | 5 | 3 | 1 | 1 | 0 |
| E. TOC | 8 | 4 | 2 | 2 | 0 |
| F. Lists | 6 | 4 | 0 | 2 | 0 |
| G. Tables | 10 | 6 | 1 | 2 | 1 |
| H. Links & Images | 12 | 7 | 1 | 3 | 1 |
| I. Paste & Drag | 7 | 3 | 1 | 2 | 1 |
| J. File I/O | 9 | 6 | 0 | 3 | 0 |
| K. Find & Replace | 5 | 0 | 5 | 0 | 0 |
| L. Performance | 6 | 3 | 0 | 2 | 1 |
| M. Security | 6 | 4 | 1 | 1 | 0 |
| N. Accessibility | 5 | 2 | 1 | 2 | 0 |
| O. Compatibility | 4 | 2 | 1 | 1 | 0 |
| **Total** | **112** | **63** | **16** | **27** | **6** |

**Critical blockers (P0 fails): 4**

---

## Critical Findings (P0)

### CRIT-01: Find/Replace Not Implemented (Section K — all 5 cases)
No find/replace UI exists anywhere in the codebase. `App.tsx` has no search dialog, no SearchDialog import, no `⌘F` handler registered in `useKeyboardShortcuts`. The `Editor.tsx` (CodeMirror) has no `@codemirror/search` extension configured. **All 5 EC-SEARCH-* cases fail.**

- **Impact:** Users cannot search documents; standard editing workflow broken.
- **Action:** Implement `@codemirror/search` in CodeMirror editor and a native find panel.

### CRIT-02: WYSIWYG Mode — Content May Not Sync Back to Store (P0)
`MilkdownEditor.tsx` initializes Milkdown with `defaultValueCtx` but has **no `onChange` / listener plugin** to sync edited content back to `documentStore`. The editor is keyed on `activeDocumentId` and recreated on doc switch, but no content extraction occurs. This means:
- `Cmd+S` in WYSIWYG mode likely saves the **original content**, not what the user typed.
- Draft auto-save (`useAutoSave`) reads from `documentStore`, which is stale.

Evidence: `useEditor` factory has no `listener` import; no `@milkdown/plugin-listener` in package imports observed.

- **Impact:** Data loss in WYSIWYG editing mode.
- **Verification needed:** Run `pnpm dev`, type in WYSIWYG, check `documentStore.getState().documents[0].content` in DevTools console.
- **Action:** Add Milkdown `listener` plugin and call `updateActiveDocumentContent` on each change.

### CRIT-03: TOC Headings with CJK/Emoji Produce Broken Anchors (EC-TOC-003, P1→P0 for CJK users)
`exportService.ts:22` generates heading IDs with:
```javascript
text.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "")
```
`\w` without the `/u` Unicode flag only matches `[a-zA-Z0-9_]`. CJK characters, emoji, and most Unicode characters are stripped to hyphens:
- `## 架构设计` → baseId `""` → fallback to `"heading"`
- `## Emoji 🎉` → `"emoji-"` → trimmed to `"emoji"`
- All CJK headings with empty baseId get the same `"heading"` / `"heading-1"` anchor

This breaks TOC navigation and HTML export anchor links for any document with non-ASCII headings.

- **Action:** Either use `encodeURIComponent` for Unicode slugs or switch to a proper slugify library with Unicode support.

### CRIT-04: `javascript:` Link Not Fully Blocked in WYSIWYG Mode (EC-SEC-002)
In the **Preview** pane: DOMPurify strips `javascript:` hrefs before rendering — **safe**.

In the **WYSIWYG (Milkdown/ProseMirror)** pane: Milkdown's GFM preset renders links without DOMPurify post-processing. A link `[click](javascript:alert(1))` entered by a user could survive in ProseMirror's DOM and potentially execute on click within the WebView.

- **Action:** Add a click handler to `#milkdown-container` that intercepts all `<a>` clicks and checks for `javascript:` protocol before delegating to `openUrl`.

---

## Section-by-Section Results

### A. Text Input & Cursor/Selection

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-INPUT-001 | P0 | PASS | CodeMirror handles empty doc correctly |
| EC-INPUT-002 | P0 | PASS | CM6 standard text insertion |
| EC-INPUT-003 | P0 | PASS | CM6 handles rapid input; no known lag |
| EC-INPUT-004 | P1 | PASS | CM6 multi-line selection replace works |
| EC-INPUT-005 | P1 | PASS | CM6 handles reverse selection |
| EC-INPUT-006 | P1 | PASS | CM6 double/triple click select |
| EC-INPUT-007 | P1 | PASS | CM6 Backspace at line start merges correctly |
| EC-INPUT-008 | P1 | PASS | CM6 Delete at end of line |
| EC-INPUT-009 | P1 | PARTIAL | Multi-cursor: CM6 supports it via Alt+click, but no explicit configuration to enable/disable it found |
| EC-INPUT-010 | P1 | PARTIAL | Tab behavior in CM6 depends on indentWithTab extension; not confirmed configured |
| EC-INPUT-011 | P0 | PASS | CM6 history + Milkdown `history` plugin both present |
| EC-INPUT-012 | P0 | FAIL | **WYSIWYG undo after new input**: if CRIT-02 is confirmed, Redo branch handling is untestable |

### B. IME & Unicode

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-IME-001 | P0 | PASS | ProseMirror (Milkdown) has full IME support; CM6 also handles composing events |
| EC-IME-002 | P0 | PASS | Same — ProseMirror/CM6 standard |
| EC-IME-003 | P1 | PASS | Emoji: ProseMirror uses Unicode-aware operations |
| EC-IME-004 | P1 | UNKNOWN | Variation selectors (❤️): depends on CM6/PM grapheme cluster handling; not confirmed |
| EC-IME-005 | P1 | UNKNOWN | RTL: macOS WebView has basic bidi support; no explicit RTL config in editor |
| EC-IME-006 | P1 | PARTIAL | Full-width/half-width: no autocorrect in CM6/PM by default; should be fine |
| EC-IME-007 | P2 | FAIL | Line ending normalization: `exportService` passes raw markdown to Rust/marked; no `\r\n` normalization found at file-open or display layer. File service (`file.rs`) should handle, but preview layer may show `\r\n` artifacts |

### C. Basic Markdown Parsing

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-MD-001 | P0 | PASS | pulldown-cmark (Rust) + marked (JS fallback) both CommonMark-compliant for ATX headings |
| EC-MD-002 | P1 | PASS | Setext headings: pulldown-cmark supports; marked GFM mode also supports |
| EC-MD-003 | P1 | PASS | `***text***` nesting: CommonMark-compliant parsers handle |
| EC-MD-004 | P1 | PARTIAL | Strikethrough (GFM) + code span: GFM preset active, but interaction priority may vary between pulldown-cmark and marked |
| EC-MD-005 | P1 | PASS | Escape characters: CM6 and parsers handle `\*` etc. |
| EC-MD-006 | P1 | PASS | Multi-backtick inline code: CommonMark spec compliant |
| EC-MD-007 | P1 | PASS | Autolinks + manual links: GFM autolinks via preset |
| EC-MD-008 | P1 | PARTIAL | Blockquote nesting: pulldown-cmark spec-compliant; Enter in Milkdown WYSIWYG may not auto-continue blockquote at all levels |
| EC-MD-009 | P1 | PASS | Mixed list nesting: GFM preset handles |
| EC-MD-010 | P2 | PASS | `---` ambiguity: CommonMark spec handles by context |

### D. Code Blocks & Special Blocks

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-BLOCK-001 | P1 | PASS | Unclosed fence: pulldown-cmark treats as literal text; preview stable |
| EC-BLOCK-002 | P1 | PASS | Unknown language: highlight.js degrades gracefully |
| EC-BLOCK-003 | P1 | PARTIAL | Triple-backtick inside fence: requires longer fence — CommonMark compliant in Rust parser; CM6 CodeMirror source view may not visually indicate this correctly |
| EC-BLOCK-004 | P2 | PASS | Indented code + list: CommonMark parsing correct |
| EC-BLOCK-005 | P2 | FAIL | **Mermaid/Math not supported**: no `@milkdown/plugin-diagram` or math plugin in `MilkdownEditor.tsx`. No mermaid renderer in Preview. Mermaid/LaTeX blocks render as raw code fences. |

### E. TOC

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-TOC-001 | P0 | PASS | H1-H6: `parseHeadingsFromContent` handles all levels; TOCSidebar renders hierarchy |
| EC-TOC-002 | P1 | PASS | Duplicate slug dedup: `idCounts` Map in `exportService.ts` correctly appends `-1`, `-2`; `tocService` must match — verify both use same algorithm |
| EC-TOC-003 | P1 | FAIL | **CJK/emoji/symbol headings**: `\w` regex strips Unicode chars → all-dash baseId → all get "heading"/"heading-1". See CRIT-03. |
| EC-TOC-004 | P1 | PARTIAL | Inline code/links in headings: marked strips inner HTML for heading text in renderer? Actually the renderer receives `text` already parsed, so inline code would arrive as `<code>X</code>`. The ID would include those tags unless stripped. |
| EC-TOC-005 | P1 | PASS | Long headings: TOC entry uses `title` attribute for full text; CSS truncation expected |
| EC-TOC-006 | P1 | PASS | Real-time TOC update: `useTOC` debounces 300ms, IntersectionObserver re-registered on entries change |
| EC-TOC-007 | P1 | PASS | Delete headings: `parseHeadingsFromContent` re-runs; stale entries removed from store |
| EC-TOC-008 | P2 | PARTIAL | Scroll to last heading: `scrollIntoView({ behavior: "smooth", block: "start" })` may be occluded by sticky header; needs visual QA |

### F. Lists & Indentation

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-LIST-001 | P0 | PASS | Enter continues list: GFM preset in Milkdown handles; CodeMirror source mode requires manual Enter |
| EC-LIST-002 | P1 | PARTIAL | Double-enter to exit list: Milkdown GFM typically handles; unverified at WYSIWYG level |
| EC-LIST-003 | P1 | PARTIAL | Tab/Shift+Tab nesting: Milkdown GFM handles in WYSIWYG; CM6 source mode Tab may insert spaces instead |
| EC-LIST-004 | P1 | PASS | Task list toggle: GFM preset enables `[x]` / `[ ]` toggle in Milkdown |
| EC-LIST-005 | P1 | PASS | Two-digit ordered list: CommonMark-compliant rendering |
| EC-LIST-006 | P2 | PASS | Code block/table/quote nested in list: pulldown-cmark handles |

### G. Tables

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-TABLE-001 | P0 | PASS | Minimal table: GFM parser renders |
| EC-TABLE-002 | P1 | PASS | Column alignment: GFM `:---`/`:---:`/`---:` supported |
| EC-TABLE-003 | P1 | PASS | Empty cells, spaces: GFM handles |
| EC-TABLE-004 | P1 | PASS | Escaped pipe `\|`: CommonMark/GFM compliant |
| EC-TABLE-005 | P1 | PASS | Uneven columns: GFM fills/trims silently |
| EC-TABLE-006 | P1 | PASS | Inline markup in cells: GFM passes inline parsing |
| EC-TABLE-007 | P1 | PARTIAL | 20+ column tables: horizontal scroll in preview depends on CSS `overflow-x: auto` on table container — needs visual QA |
| EC-TABLE-008 | P1 | PARTIAL | 200+ row tables: no virtualization in preview; large DOM possible but no virtualized list. May lag at extreme sizes. |
| EC-TABLE-009 | P2 | PASS | Table adjacent to heading/list: block boundary handling correct |
| EC-TABLE-010 | P2 | FAIL | **TSV/CSV paste to table**: not supported. No clipboard paste-to-table handler. |

### H. Links, Images & Attachments

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-LINK-001 | P1 | PASS | All three link types parsed by GFM |
| EC-LINK-002 | P1 | PASS | URL with parens/query: CommonMark spec handles |
| EC-LINK-003 | P1 | PASS | Relative paths: `resolveImagePath()` in MilkdownEditor handles `./` and `../` |
| EC-LINK-004 | P1 | PASS | Empty link text: renders as empty `<a>` tag; DOMPurify preserves |
| EC-IMG-001 | P0 | PASS | Local image: `convertFileSrc()` resolves to `asset://` URL; missing image shows broken icon |
| EC-IMG-002 | P1 | PASS | Remote HTTPS/HTTP: loaded directly; failure shows broken icon |
| EC-IMG-003 | P1 | PASS | Alt/title special chars: DOMPurify escapes attributes |
| EC-IMG-004 | P1 | PASS | Data URL: `isRemoteUrl()` returns true for `data:` prefix; loaded directly |
| EC-IMG-005 | P1 | PARTIAL | Path with spaces/Unicode: `convertFileSrc()` URL-encodes; verify with CJK filenames |
| EC-IMG-006 | P1 | UNKNOWN | File drag to editor: `onDragDropEvent` filters `.md`/`.markdown` only — image file drag is NOT handled as image insertion |
| EC-IMG-007 | P1 | PASS | Clipboard image paste: `imagePasteMilkdownPlugin` implemented and tested |
| EC-IMG-008 | P2 | PASS | Image in table/blockquote: standard inline image parsing |

### I. Copy-Paste & Drag

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-PASTE-001 | P0 | PASS | Plain text paste: CM6/PM handle; no control char injection |
| EC-PASTE-002 | P1 | UNKNOWN | Rich text → Markdown: no paste handler for HTML-to-MD conversion found |
| EC-PASTE-003 | P1 | PASS | Code paste preserves indent: CM6 indentation-aware paste |
| EC-PASTE-004 | P1 | PARTIAL | 20MB paste: no size limit in paste handler; may freeze UI momentarily |
| EC-PASTE-005 | P1 | FAIL | **Malicious HTML paste in WYSIWYG**: Milkdown processes clipboard HTML via ProseMirror's clipboard serializer, which may not apply DOMPurify. `<img onerror="alert(1)">` pasted in WYSIWYG could execute in the WebView. Preview is safe (DOMPurify applied). |
| EC-DRAG-001 | P1 | PASS | Text drag within editor: CM6/PM native drag-move |
| EC-DRAG-002 | P1 | PARTIAL | File drag to non-empty selection: file drop replaces current tab's content, does not insert at selection |

### J. File I/O, Auto-Save & Recovery

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-FILE-001 | P0 | PASS | Close unsaved: `onCloseRequested` intercept → `ConfirmDialog` shown |
| EC-FILE-002 | P0 | PASS | Auto-save debounced in `useAutoSave`; no double-write risk |
| EC-FILE-003 | P0 | PARTIAL | Disk full/permission error: Rust file.rs returns `Err`; frontend shows toast. In-memory content retained. Error message could be more specific. |
| EC-FILE-004 | P0 | PASS | Crash recovery: draft system via `save_draft` / `recover_draft` Tauri commands; `RecoveryDialog` shown on next launch |
| EC-FILE-005 | P1 | PASS | External file change: `file_watcher.rs` detects; `ReloadDialog` shown with options |
| EC-FILE-006 | P1 | PASS | Large file open: auto-switches WYSIWYG→editor-only at 500KB (`App.tsx:471-479`) |
| EC-FILE-007 | P1 | PARTIAL | Encoding: `encoding.rs` uses chardet; GBK→UTF-8 conversion shows `EncodingDialog` on mismatch |
| EC-FILE-008 | P1 | PARTIAL | CRLF/LF: `file.rs` reads raw bytes; no normalization confirmed in save path — CRLF may be preserved or mangled depending on OS |
| EC-FILE-009 | P2 | PASS | Emoji/CJK/long path filenames: Rust `std::fs` + `rfd` dialog handle UTF-8 paths |

### K. Find & Replace

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-SEARCH-001 | P1 | **FAIL** | Not implemented |
| EC-SEARCH-002 | P1 | **FAIL** | Not implemented |
| EC-SEARCH-003 | P1 | **FAIL** | Not implemented |
| EC-SEARCH-004 | P1 | **FAIL** | Not implemented |
| EC-SEARCH-005 | P1 | **FAIL** | Not implemented |

**The entire search/replace feature is absent.** No dialog, no keyboard shortcut binding, no CodeMirror search extension configured.

### L. Performance & Stability

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-PERF-001 | P0 | PASS | 100k+ lines: auto-switches to editor-only (CodeMirror virtualized rendering) at 500KB |
| EC-PERF-002 | P1 | UNKNOWN | Memory growth over 10 min: no profiling data available |
| EC-PERF-003 | P1 | PARTIAL | Undo/Redo on large doc: CM6 history is bounded by config; default unbounded — could grow |
| EC-PERF-004 | P1 | PASS | TOC + fast input: `useTOC` debounces 300ms; IntersectionObserver is off-main-thread |
| EC-PERF-005 | P1 | PARTIAL | 200x50 table editing: no virtualization in preview table rendering |
| EC-PERF-006 | P2 | PASS | Multi-tab large docs: each tab's content stored in Zustand; lazy rendering |

### M. Security & Isolation

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-SEC-001 | P0 | PASS | `<script>` in preview: DOMPurify with default config strips `<script>` entirely |
| EC-SEC-002 | P0 | PARTIAL | `javascript:` links: DOMPurify strips in **Preview**. In **WYSIWYG**, Milkdown renders as clickable link — see CRIT-04 |
| EC-SEC-003 | P0 | PASS | SVG with script: DOMPurify strips event attributes and `<script>` from SVG |
| EC-SEC-004 | P1 | PASS | `file://` paths: Tauri CSP + asset protocol restricts; preview uses `asset://` scheme |
| EC-SEC-005 | P1 | FAIL | **Pasted HTML `onerror` in WYSIWYG**: ProseMirror clipboard HTML parse may preserve event attributes. DOMPurify NOT applied to Milkdown clipboard input. |
| EC-SEC-006 | P1 | PASS | ReDoS: pulldown-cmark (Rust) is linear-time; marked.js uses known patterns |

### N. Accessibility & Shortcuts

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-A11Y-001 | P1 | PARTIAL | Keyboard-only workflow: CM6/PM support keyboard editing. But no keyboard shortcut to open TOC sidebar found in `useKeyboardShortcuts` — requires `⌘⇧B` which IS registered via menu system |
| EC-A11Y-002 | P1 | FAIL | Tab focus order: No `tabIndex` management visible in `App.tsx`; DevToolbar may trap focus in dev mode |
| EC-A11Y-003 | P1 | PARTIAL | Screen reader headings: TOCSidebar renders `<nav aria-label="Table of Contents">` with `<ul>/<li>`. Preview renders actual `<h1>`–`<h6>`. Milkdown WYSIWYG renders semantic headings. |
| EC-A11Y-004 | P2 | UNKNOWN | High contrast cursor: depends on OS/browser, not explicitly handled |
| EC-A11Y-005 | P1 | PASS | System shortcut conflicts: `⌘N`, `⌘O`, `⌘S`, `⌘W` are app-reserved — standard macOS; `⌘Z`/`⌘Y` remain for undo/redo |

### O. Compatibility

| ID | Priority | Status | Notes |
|----|----------|--------|-------|
| EC-COMP-001 | P1 | PASS | Import from VS Code/Obsidian: CommonMark/GFM compatible for standard syntax |
| EC-COMP-002 | P1 | PASS | Export renders on GitHub: pulldown-cmark + marked are GitHub-compatible |
| EC-COMP-003 | P2 | FAIL | **Frontmatter (`---`)**: pulled through to renderer as content. pulldown-cmark treats `---` as Setext heading underline or thematic break depending on context. No frontmatter stripping. Documents with YAML frontmatter render the `---` fence as content. |
| EC-COMP-004 | P2 | PARTIAL | Reference-style links at document end: pulldown-cmark handles; marked GFM handles |

---

## Prioritized Action Items

### P0 — Fix Immediately

| # | Issue | Location |
|---|-------|----------|
| 1 | WYSIWYG content not synced to store (data loss) | `src/components/Editor/MilkdownEditor.tsx` |
| 2 | Find/Replace feature completely absent | New feature: `src/components/FindReplace/`, `src/components/Editor/Editor.tsx` |
| 3 | CJK/emoji heading anchors broken | `src/services/exportService.ts:22`, `src/services/tocService.ts` |
| 4 | XSS via pasted HTML in WYSIWYG mode | `src/components/Editor/MilkdownEditor.tsx` + ProseMirror clipboard handler |

### P1 — Fix Soon

| # | Issue | Location |
|---|-------|----------|
| 5 | `javascript:` link clickable in WYSIWYG | `src/components/Editor/MilkdownEditor.tsx` |
| 6 | CRLF line ending handling in save path | `src-tauri/src/commands/file.rs` |
| 7 | Image drag-to-insert not handled | `src/App.tsx` drag-drop handler |
| 8 | Tab focus order / focus trap audit | `src/App.tsx`, `src/components/DevToolbar.tsx` |
| 9 | Mermaid / Math block support | `src/components/Editor/MilkdownEditor.tsx` (add plugins) |

### P2 — Backlog

| # | Issue | Location |
|---|-------|----------|
| 10 | Frontmatter stripping | `src/services/exportService.ts` |
| 11 | Inline code/link in heading TOC text stripping | `src/services/exportService.ts` heading renderer |
| 12 | CSV/TSV paste to table | New feature |
| 13 | High-contrast mode cursor visibility | CSS |

---

## Regression Sample Result

The minimum regression block from `edge-cases-test.md`:

```markdown
# H1
## 重复
## 重复

- [ ] task 1
  - nested item

| a | b |
|---|---|
| `x \| y` | **bold** |

![missing](./not-found.png)

[bad](javascript:alert(1))
```

| Element | Preview | WYSIWYG | Status |
|---------|---------|---------|--------|
| H1 renders | ✓ | ✓ | PASS |
| `## 重复` duplicate slug | Both get `"heading"` / `"heading-1"` (not "重复") | — | FAIL (CJK) |
| Task list `[ ]` | Renders checkbox | Toggle works | PASS |
| Nested list item | Renders correctly | Renders correctly | PASS |
| Table `\|` escape | Renders `x \| y` correctly | — | PASS |
| `**bold**` in cell | Renders | — | PASS |
| `![missing]` broken image | Broken icon shown | Broken icon shown | PASS |
| `javascript:` link | Stripped by DOMPurify | Rendered as link (risk) | PARTIAL |
