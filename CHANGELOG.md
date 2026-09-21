# Changelog

All notable changes to mdpro will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Math / LaTeX rendering (Typora-parity Phase 1, WI-1.1): `$inline$` and `$$display$$` math now render. The canonical Rust renderer emits `.math-inline` / `.math-display` wrappers carrying raw TeX; the preview typesets them with bundled KaTeX (offline), failing soft on invalid TeX (raw source kept, never blank). HTML export pre-renders math to **MathML** (KaTeX `output:'mathml'`), which renders natively in the browser with zero JS and — unlike KaTeX's styled HTML — needs no inline `style`, so it survives the server-side sanitizer (which forbids `style` to close the `url()` exfiltration vector) with its structure intact. Exported math therefore uses the browser's native MathML rendering (the inlined KaTeX stylesheet styles any KaTeX-HTML wrappers that remain), which is layout-correct but not pixel-identical to the preview's KaTeX-HTML typesetting. Math inside code spans/fences stays literal. Math inside a table cell renders via pulldown-cmark's default `math math-inline` class, which the KaTeX/MathML pass still matches (the `span.math-inline` selector matches the double-class element), so in-cell math typesets in both preview and export
  - Known degradation (accepted, plan decision A1): the `exportService` `marked` fallback path — used only when the Rust `render_markdown` IPC throws — renders neither math nor footnotes. The canonical Rust path is the supported export route; the fallback is a last-resort plain-Markdown render
  - Deferred to Phase 2 (B3): Milkdown WYSIWYG mode does not yet typeset `$…$` math or render footnotes — in source mode these stay visible as raw `$…$` / `[^1]` text (readable, not broken). The canonical Rust render surface (preview + export) is the supported math/footnote path for Phase 1
- Footnotes (Typora-parity Phase 1, WI-1.3): `[^1]` references and definitions render with working return ("↩") back-links; the reference gets a stable `fnref-` anchor and the definition links back to it. Undefined references stay literal
- Auto-link + emoji (Typora-parity Phase 1, WI-1.4): bare `http(s)://` URLs are linkified, and a curated set of `:shortcode:` emoji render as glyphs. Both skip code spans/fences and existing links; unknown shortcodes stay literal
- In-app update checker: Settings → About page with version display, update check, download progress, and one-click install via `tauri-plugin-updater`
- Pre-relaunch save guard: automatically saves all modified documents before restarting, blocks if untitled docs exist or saves fail
- CI release workflow: `latest.json` generation with dynamic GitHub asset discovery via `jq`, signing env vars for updater artifacts

### Security
- Sanitizer policy redesign (Typora-parity Phase 0, WI-0.1): the Rust `sanitize_html` and frontend DOMPurify config now share one per-feature allow-list matrix that preserves legitimate KaTeX math, footnote anchors, and Mermaid inline-SVG output while neutralizing script/`on*`/`<foreignObject>`/`url(http…)`-in-style payloads on every render surface. `style` is never allowed (no exfiltration), href schemes are restricted to the safe set, and in-doc `#anchor` links pass through. Mirrored tag/attr lists are regression-tested on both surfaces
- `name` is no longer an allowed attribute in the export sanitizer ([ADR-0011](docs/adr/0011-remove-name-from-export-sanitizer-allowlist.md)). With the DOM-clobbering defence switched off for export (see the export-anchor entry under Fixed), an allow-listed `<img name="body">` surviving into the exported HTML could shadow `document.body` — or `document.createTreeWalker` — inside the syntax-highlighting pass that re-parses the sanitizer's output with `DOMParser`, because a `DOMParser` result is a real document tree. ADR-0003's original analysis applied its "must be in a document tree" test to only one of the two post-processors; this closes the one reachable instance it missed. The Rust/ammonia path never allowed `name`, so this also removes a drift in which the JavaScript allow-list was the more permissive of the two
  - **Behaviour change**: legacy `<a name="x">` anchors written as raw HTML no longer survive export. `id="x"` is the supported form and is what every generated heading anchor already uses. Nothing in the renderer emitted `name`, so only hand-written raw HTML is affected
  - **What the regression test does and does not prove**: it asserts the attribute is gone, not that clobbering fails. jsdom does not implement the named-property behaviour this defends against, so a clobbering reproduction would pass in the test suite while the condition stayed live in the shipping WebKit engine — a green test asserting nothing. Only a WKWebView probe could prove the defence, and this change does not build one
  - **Not closed, and it is the larger hole**: the Rust↔JS parity test compares the math, SVG and URI-scheme sets but **not** the base attribute set, which is why this drift was invisible to the test that exists to catch drift. The next base attribute to drift will be equally invisible. Closing it honestly means comparing against the union of ammonia's generic set and its per-tag grants, which is its own design task — deliberately deferred, not overlooked
- Upgraded DOMPurify from `^3.2.7` to `^3.3.2` (resolved to `3.3.3`), patching GHSA-h8r8-wccr-v5f2 and GHSA-v2wj-7wpq-c8vv — both Moderate XSS CVEs affecting the HTML paste-sanitization path in the WYSIWYG editor
- Link opening in the WYSIWYG editor now enforces a scheme **allow-list** rather than blocking three named prefixes (ADR-0001). A clicked link is handed to the system opener only when the URL it actually resolves to carries one of `http`, `https`, `mailto` or `tel`. Anything else is blocked and logged instead of opened. Two gaps closed: the scheme is now read after whitespace and control characters are removed, so a link whose displayed target and actual navigation target differ can no longer slip through; and the editor now opens exactly the value it validated instead of re-reading the element afterwards, which could change in between
  - **Behavior change**: links with other schemes stop working, including `file:`, `blob:`, `sms:` and Windows drive-letter paths such as `c:/Users/…`. If you need one of these, it must be added to the shared scheme list, not special-cased
  - `ftp` is a deliberate exception, and the one place the two scheme lists diverge: it remains in the shared Rust/JS **sanitizer** list, so `ftp://` links still render and export normally, but it is **not** handed to the system opener. The app's `opener:default` capability grants only `mailto:`, `tel:`, `http://` and `https://`, so an `ftp://` link was never actually openable — it previously failed silently at the IPC authorization layer, and now blocks visibly with a log entry
  - The browser-window fallback used when the system opener refused a link was removed. A link the OS declines to open now does nothing visible; the only record is one `editor.milkdown.link.open` entry in `~/.mdpro/mdpro.log`
- Closed a critical link-click bypass in the WYSIWYG editor (finding C1, ADR-0002). A link written in protocol-relative form (`//evil.com/x`) carries no scheme, so under the application's own `tauri://localhost` origin it resolved to `tauri://evil.com/x` — the app's own scheme wearing an attacker-chosen host. The previous check compared only the protocol, accepted the match, and handed that URL to the system opener. Protocol-relative links are now rejected outright, along with the backslash variants (`\\host`, `/\host`, `\/host`), and the application's own scheme is never treated as an external handoff
  - **Behavior change**: protocol-relative links no longer open, at any origin. Write an explicit `https://` scheme instead
  - **Behavior change**: links to the application's own origin — relative paths such as `./other.md` and `#fragment` anchors — are no longer sent to the system opener. They are now recognized as in-document navigation: the click is cancelled and recorded at `debug` level. In-document navigation is not implemented yet, so these links are currently **inert** rather than opening an external window. This replaces the previous behavior, in which a `#fragment` click sent the application-origin URL to the external opener

### Changed
- The large-document WYSIWYG guard now judges **source structure**, not file size ([ADR-0016](docs/adr/0016-large-document-guard-predicate-is-a-source-structure-score.md)). The old rule — degrade any document over 500 KB — was measured wrong on 2026-09-20: a 471,880 B table document blocked the main thread for **12.0 seconds** and was let through, while file size alone decided the outcome for everything above 500 KB regardless of what was in it. The new score is `newlines + (pipes - table-row-starts)` — roughly lines plus table cells — computed in one forward pass over the content with no Markdown parsing and constant extra memory; documents scoring above **25,000** switch to Source mode. Across the five perf-corpus fixtures the score sorts strictly with the measured block time (57,190 → 12,004 ms; 32,657 → 7,409 ms; 20,664 → 1,793 ms; 3 → 0 ms), and the threshold sits between the 1.8 s and 7.4 s cases
  - **Behaviour change**: a zero-table document is no longer safe by default — a 32,658-line prose file now degrades where it previously opened in WYSIWYG. Conversely a very large file with almost no line breaks was **allowed** into WYSIWYG where file size previously blocked it. That reversal was accepted at the time on the strength of a 471,862 B fixture measured at 0 ms — but the reasoning generalised from a fixture to a whole shape of document, and when a real 10 MB single-line file was finally measured it took **259 seconds** to mount. The longest-line trigger below closes it
  - The toast text changed from "Document exceeds 500KB. Switched to Source mode for performance." to "This document is too complex for WYSIWYG. Switched to Source mode for performance.", because the old copy named a threshold that no longer exists
  - **Known limits, accepted**: the threshold is fitted on five fixtures that are all ~472 KB, one measured run each, on one machine. Pipe counting errs in both directions — `|` inside a fenced code block counts as a cell (over-count), a table row written without outer pipes is under-counted. A degrade writes nothing to `~/.mdpro/mdpro.log`, so a false positive leaves no trace beyond the toast
  - `fileSize` was removed from the predicate's input type outright rather than left unused, so there is no longer a second, staleness-prone source of truth for the guard to disagree with
- The large-document WYSIWYG guard gained a second trigger: **longest line** ([ADR-0019](docs/adr/0019-large-document-guard-adds-a-longest-line-trigger.md), which extends ADR-0016 rather than replacing it). A document now degrades to Source mode when **either** its structure score exceeds 25,000 **or** its longest single line exceeds **1,000,000** UTF-16 code units. The same forward pass computes both — two more integers, no second scan, no parsing — so every constraint ADR-0016 froze still holds
  - **This fixes a measured defect, not a hypothetical one.** ADR-0016 explicitly accepted that a 9,961,475 B, 4-line document scored 3 and would be let into WYSIWYG. Measured on real hardware, that document takes **259,483 ms** to mount and leaves the UI unresponsive for over two minutes. The limitation was argued for in the abstract and turned out to be the worst case the guard had
  - **Behaviour change**: a file whose longest line exceeds one million characters now opens in Source mode instead of WYSIWYG, whatever its size or line count
  - The toast text is unchanged — "too complex for WYSIWYG" was already true of both triggers
  - **Known limits, accepted**: the new threshold is **not fitted**. The largest measured allow is 359,285 units (155 ms) and the smallest measured refuse is 7,583,742 units (259,483 ms); `1,000,000` is a round number chosen in the unmeasured order of magnitude between them. The guard is still blind to everything except line breaks and line length — a document of twelve 900,000-character lines passes both triggers while carrying 10.8 MB of inline content. `\r` counts as an ordinary character, so a CRLF file measures one unit longer per line than the same text in LF; correcting for it would need a lookback, and a lookback is the parsing rule ADR-0016 forbids
- The `micromark-extension-gfm-table` override is pinned to the exact measured version `2.1.2` instead of the open range `>=2.1.2`. [ADR-0006](docs/adr/0006-bump-micromark-gfm-table-for-quadratic-edit-map.md) scoped its G0 exception to "this package and this reason" and required any further bump to carry its own justification, but an open range grants exactly that on the next lockfile regeneration. Resolution is unchanged (`2.1.2` before and after), so this is a guard against future silent drift, not a version change
- Encoding-safe save round-trip (Typora-parity Phase 0, WI-0.3): files opened as UTF-16LE/BE are now saved back in their original encoding (BOM preserved) instead of being silently rewritten as UTF-8. `save_file`/`save_file_dialog` accept the document's encoding; the open path detects encoding with a confidence level and refuses to guess (no blind Latin-1) for non-UTF-8 files with no BOM, surfacing an encoding error rather than corrupting content. CRLF line endings survive the round-trip
- ⌘/ now cycles view modes from any context, including when the CodeMirror source editor has focus. The line-comment shortcut moved from ⌘/ to ⌘⌥/ to free up the cycle binding (split via a `Prec.highest` keymap in `Editor.tsx`)

### Fixed
- Packaged builds no longer spray Content-Security-Policy errors into the console at launch (defect D5). `src-tauri/tauri.conf.json` declared `default-src 'self'` and no `connect-src`, so the webview refused Tauri's IPC custom protocol: the injected bridge issues a real `fetch()` to `ipc://localhost/<command>`, which `connect-src` governs, and `'self'` resolves against the document origin `tauri://localhost` — a different scheme, so it never matched. The policy now grants `connect-src 'self' ipc: http://ipc.localhost`; `default-src` is unchanged
  - **The app was never broken by this.** Tauri catches the rejection and falls back to `window.ipc.postMessage`, so every command and event worked. What it cost was a burst of console output on every launch — each blocked request logs both a WebKit refusal and Tauri's own warning — which buried real errors, plus one wasted failed round-trip for each command already in flight at startup. The fallback is latched (`customProtocolIpcFailed` is set once, permanently), so the noise was a startup burst rather than a per-call tax
  - **Only reproducible in a packaged build.** `pnpm tauri dev` serves the frontend from the Vite dev server, which never receives this header — which is why the defect survived this long. The regression test therefore asserts at the config level: it reimplements Tauri's own `convertFileSrc` to derive the real IPC URL and resolves it against the parsed policy, and it pins both directions — the IPC scheme must be permitted, and the fix must not be made by loosening `default-src` or by opening `connect-src` to `*`, `http:`, `https:`, `data:` or `blob:`
  - **Not verified in a packaged build.** The observable claim — a clean console after launching the bundled `.app` — has not been checked; no automated suite in this repo can reach that surface
- The outline highlight follows your scrolling in **Source mode** again. Scroll the CodeMirror pane and the current heading lights up in the sidebar — **upward and downward alike, about the same anchor**; until now only *clicking* an entry could move the highlight, and scrolling did nothing at all. This was not a recent break — it has been dead since `4570de3` (`feat(editor): cut ViewMode from 4 to 2`), which deleted the Preview pane. That pane was the only non-WYSIWYG surface that rendered real `h1`–`h6` elements, so when it went, the scroll-spy was switched off for the whole non-WYSIWYG side rather than re-homed onto CodeMirror. Three layers had to change, because flipping the switch alone fixes nothing: the observer's element scan is rooted at `.ProseMirror` and returns an empty list for the source container, and `IntersectionObserver` is structurally the wrong instrument for CodeMirror, which renders every line as a `div.cm-line` — no headings to observe — and virtualizes its viewport so off-screen lines are not in the DOM at all
  - `App.tsx` no longer passes a spy master switch. That one argument was doing two jobs — "spy at all" and "not Source mode" — and the second job silently disabled the first. `viewMode` alone now selects the mechanism, so no caller can turn both off by accident
  - **WYSIWYG behaviour is unchanged, deliberately and verifiably.** Its IntersectionObserver effect was moved verbatim into its own file; the two existing outline test suites that exercise it through the public surface pass untouched, and that is the move's only acceptance evidence
  - Source mode picks the heading by **line number** — the last heading at or above the line sitting 40px below the top of the scroller — which is the same coordinate the click-to-navigate path already used. Two headings with identical text and level are therefore distinct, because they sit on different lines
  - **The highlight does not blink off.** Scrolling above the first heading keeps the previous entry lit rather than clearing it, matching what WYSIWYG's `rootMargin: -66%` already did, so the two modes feel like one product
  - Scroll handling is `requestAnimationFrame`-throttled to at most one store write per frame, and logs exactly one event on attach and one on detach — a per-scroll log line would flood `~/.mdpro/mdpro.log`
  - **Known cost, recorded rather than hidden**: scrolling to the very bottom of the document leaves the highlight on the *second-to-last* heading; the final one lights up only if you click it. The document ends before the anchor can reach that heading's line. Three requirements cannot hold at once — selection depends only on viewport geometry, scrolling to the bottom always selects the final heading, and clicking the second-to-last heading preserves it when its destination is that same bottom position — and identical geometry cannot yield two different answers without extra state. The accepted policy is that ordinary scrolling selects the section at the anchor, while a heading you explicitly clicked survives at a clamped destination ([ADR-0017](docs/adr/0017-source-scroll-spy-bottom-of-document-asymmetry.md))
- Clicking the second of two identically-titled headings in the outline now scrolls to *that* heading, and the scroll-spy highlights it as you pass it. Both entries used to send you to the first heading, and the highlight could never leave it. The outline had been locating headings in the WYSIWYG DOM by id — but nothing on that surface ever writes the `data-heading-id` it asked for first, and the ids Milkdown does write are deduplicated with a different suffix scheme than ours (`intro-#2` where we mint `intro-1`), so the id lookup missed every duplicate by construction and an undocumented first-text-match fallback was silently doing all the work. The outline now pairs entries to heading elements by document-order correspondence — recomputed on every pass, never stored, each element claimed at most once, so two entries pointing at one element is impossible by construction rather than by a check ([ADR-0014](docs/adr/0014-toc-addresses-headings-by-document-order.md))
  - **No heading DOM id is read or written any more.** Milkdown's id namespace is theirs again; their patch releases can change the suffix scheme freely and nothing here notices
  - **Known cost, recorded rather than hidden**: when the outline and the editor disagree about how many headings the document contains, the entries that cannot be paired do nothing when clicked instead of scrolling somewhere plausible. Two known cases — a heading containing inline markup (`## [x](url) tail` can never text-match the rendered `x tail`), and `> #⇥Title`, which Milkdown renders and our parser misses. A dead click is visible to you and reportable; a silent jump to the wrong heading is neither
  - Source mode is unaffected — it navigates by line number through CodeMirror and never enters this path
- Collapsed outline sections and the scroll-spy highlight no longer vanish while you type. Every keystroke re-parsed the document and rebuilt the sidebar from scratch, and the rebuild reset both — so collapsing a long section and then typing one character in a paragraph gave the section back, fully expanded, about a third of a second later. The outline now recognises the same heading across revisions by an opaque, document-scoped **coordination key** rather than by its anchor slug, so state survives ordinary editing
  - A **rename** keeps the state too: change a heading's text and the section stays collapsed, while its `#fragment` anchor follows the new text. Key and slug are now separate things, which is the whole point — nothing may derive the key from heading text
  - **Duplicate headings behave independently.** Two sections both called "Notes" get their own keys; collapsing one no longer collapses or highlights the other
  - **State does not leak between documents.** Keys are scoped to a document id and evicted when the document closes, so two files that both contain "Intro" share nothing — including when they slug to the same anchor
  - **Still resets, deliberately**: reloading the file from disk, an external file-watcher reload, and an MCP `write_document` / `create_document` all replace the content wholesale, and wholesale replacement resets rather than guesses. Saving and ordinary typing do not reset
  - **Known cost, recorded rather than hidden**: deleting a heading and inserting an unrelated one in the same slot at the same level is byte-identical, on the input, to renaming it. The matcher reads it as a rename, so the new heading inherits the deleted one's collapse and highlight state. The alternative — resetting on every unmatched heading — would have thrown away the rename case, which is the common one. The rule and its cost are written into the contract in `src/types/toc.ts`
- The table-of-contents sidebar listed the wrong set of headings, because it found them with a line regex that only ever understood `#`-style headings and had no idea what the rest of the document was. Three consequences, all user-visible, all now gone:
  - A **Setext heading** — `Alpha` with `=====` (or `-----`) on the line below — produced no sidebar entry at all. It now appears, at the level its underline gives it. Its export anchor was already correct, so until now the exported HTML and the sidebar disagreed about which headings the document even had
  - A `#` line **inside a fenced code block** produced a phantom entry. Writing ```` ```\n# not a heading\n``` ```` added "not a heading" to the outline and clicking it jumped into the middle of your code sample. Fenced and indented code are now skipped, because the parser knows they are code
  - In a **CRLF document** every jump target after the first line was short by one character per preceding line, so clicking a sidebar entry landed progressively further above the heading the further down the document it was. Offsets are now correct on CRLF and LF alike
  - The replacement is the Lezer Markdown parser that `@codemirror/lang-markdown` already runs for Source-mode syntax highlighting, walked headlessly over the document string — no new dependency, no editor instance, no DOM ([ADR-0012](docs/adr/0012-lezer-parser-for-toc-headings.md))
  - **Added, as a side effect**: a heading nested inside a blockquote (`> # Quoted`) or a list item (`- # InList`) now appears in the sidebar. The old regex anchored on `^#` and so could not see either
  - **A sixth case, caught during this change rather than after it**: a heading opened with `#` followed by a **Tab** rather than a space — `#⇥Title` — briefly stopped appearing in the sidebar, because the Lezer grammar in `@codemirror/lang-markdown` 6.5.0 parses that line as a paragraph even though CommonMark §4.2 allows a Tab there and the Rust export renderer follows the spec (`#⇥Tabbed` exports as `<h1 id="tabbed">`). Left alone it would have closed four sidebar/export disagreements and opened a fifth. It is fixed: the Tab is rewritten to a space in a parse-only copy, which is length-preserving and so moves no jump target. All four faces — sidebar, Rust export, canonical export and the `marked` fallback — are held together on this shape by a `tab-heading` case in the shared corpus. Known residual: a tab-opened heading nested inside a blockquote or list item is still missed
  - **Not fixed, and deliberately out of scope**: inline markup inside a heading is still not stripped, so `## [Anchor spec](https://example.com) tail` shows in the sidebar as the literal `[Anchor spec](https://example.com) tail` rather than `Anchor spec tail`. This was equally true of the old parser — it is a pre-existing limit this change does not close, not a regression. Stripping it changes `HeadingInfo.text` for every consumer and is tracked separately; it is pinned by the `link-in-heading` case in the shared heading-identity corpus so it cannot drift unnoticed
  - **Cost, recorded as an observation and not as a gate**: a full Markdown parse is roughly two orders of magnitude more expensive than a line regex. On an Apple M4, parsing the 9.96 MB / 3,007-heading performance-corpus document goes from ~7 ms to ~2.07 s median; the 474 KB / 143-heading document goes from ~0.28 ms to ~35 ms. The sidebar parses on a 300 ms debounce, so on a multi-megabyte document the parse now runs well past its own debounce window. The numbers and their method are in `docs/plans/20260912-frontend-backend-sequencing-order.md` row 3.3
- Exported HTML and the table-of-contents sidebar could give two different headings the **same anchor**, so one of the two `#fragment` links in an exported document silently jumped to the wrong heading. Two causes, both in the duplicate-heading counter that all three slug generators (`tocService.ts`, `exportService.ts`, `markdown.rs`) each maintained separately: the counter handed out `base-N` without checking whether a *later* heading's own literal text already slugged to `base-N`, and it registered the pre-substitution empty string for a heading that normalizes to nothing (an emoji-only heading, say) instead of substituting `heading` first. All three generators now allocate from a taken-set — the two TypeScript ones by importing one shared module, `src/utils/headingIdentity.ts`, and the Rust one as a hand port whose agreement is enforced by the shared corpus rather than by a comment asking the next reader to keep them in sync
  - **Anchor change, user-visible**: in a document with `# x`, `# x`, `# x-1`, the third heading's anchor moves from the duplicate `#x-1` to `#x-1-1`. A document with `# heading` followed by an emoji-only heading gets `#heading` and `#heading-1` instead of `#heading` twice, and an emoji-only heading no longer emits a base-less id such as `#-1`. Links into previously-exported HTML that relied on a duplicated or malformed anchor need re-pointing; every anchor that was already unique and well-formed is unchanged
  - The DOM-clobbering defence that used to strip these anchors is now gone as well — see the entry immediately below, which landed in the same change
- Exporting a heading called "Title", "Name", "Body", "Location" or "Forms" produced HTML in which that heading had **no anchor at all** — the `id` was silently removed, so a link to `#title` in the exported file jumped nowhere and the heading could not be linked to from outside either. This was a live defect on the only export path the app has, not a latent risk. The cause was DOMPurify's `SANITIZE_DOM`, a DOM-clobbering defence that drops any `id` colliding with a built-in `document`/`form` property name. It is switched off for the export sanitizer ([ADR-0003](docs/adr/0003-export-fragment-sanitizer-scope.md) decision B′). The Rust renderer and its ammonia pass never stripped these ids, so this closes a divergence between the two sanitizers rather than opening one, and the same heading now exports identically on both paths
  - The defence is dropped **only** for the export fragment, which is written to a file and never inserted into the app's live DOM; the exported artifact carries zero JavaScript. To keep that constraint visible at every call site rather than in a comment nobody reads, the function is renamed `sanitizeRenderedHtml` → `sanitizeExportFragment`. The rename is the actual control here — the risk was never today's behaviour but a future caller reusing a generically-named sanitizer on live DOM, where clobbering does apply
  - Every other restriction is unchanged: the tag, attribute and URI-scheme allow-lists, the forbid list, and the Rust-side ammonia pass, which remains the authoritative boundary. `<form>` staying out of the allow-list is a precondition of this decision and is now enforced by a test instead of a comment
  - **Since fixed, in this same unreleased cycle**: at the time of that change, `# Title` written as a Setext heading (`Title` over `=====`) still produced no entry in the table-of-contents sidebar, because the sidebar had its own ATX-only parser. The sidebar now uses the Lezer parser and lists Setext headings — see the table-of-contents entry above. This note is kept rather than deleted so the export-anchor fix is not misread as having covered the sidebar too; it did not

- An external client editing a table through the MCP interface could destroy a heading instead. Source mode counted three shapes as tables that the GFM reference parser does not treat as tables at all: a single-column header over a `---` line (which is a setext heading underline — setext wins), a delimiter row indented 4 or more columns, and a delimiter **or** header row indented with a Tab (the indent check counted only spaces, so a Tab measured as no indent and escaped the rule entirely). Because those phantom tables were counted alongside the real ones, a client that counted correctly and asked to edit "table 0" reached a different table than the one it meant. Measured, not inferred: in a document whose first "table" was a two-line setext heading, `delete_row` on table 0 deleted the heading and left the real table untouched. The HTTP layer returns `202` before the frontend applies anything, so the call reported success either way — silent data loss. Source-mode detection now follows GFM on all three shapes. See [ADR-0009](docs/adr/0009-narrow-source-table-detection-to-gfm.md)
  - **Behaviour change**: those three shapes are now not tables *anywhere* in Source mode — no right-click table menu, no column-count diagnostic, no cell highlight, and Tab does not navigate between their cells. If you were using `| a |` over `---` as a one-column table, it becomes a heading, which is what it always was in the rendered output and in WYSIWYG mode. `:-:`, `--- | ---`, and up-to-3-space indents are unaffected and still parse
  - **Not fixed, and the larger remaining half**: mdpro still *misses* tables GFM finds — specifically a table that begins on the line immediately after a paragraph, with no blank line between. Over a measured corpus, agreement with the reference parser went from 40 of 74 positions to 44. This is a display and editing gap, not a data-loss one: a table the scanner never enumerates cannot be edited by index
  - **Also not fixed**: the frontend still cannot tell an MCP client that a table index did not exist. The Rust `202`-before-apply contract is unchanged; a refused edit is recorded in `~/.mdpro/mdpro.log` and nowhere else
- Typing in Source mode no longer stalls in a long document that contains a broken table. The table scanner probed the document at essentially every position and re-split the whole document on each probe, so the moment any table stopped parsing the scan went quadratic in document length: at 2000 rows, deleting a single `|` from a header row made one scan **317×** more expensive. This reached users through the CodeMirror lint timer, which re-scans shortly after each keystroke — so the stall arrived while typing, in exactly the document you had just broken. The scanner now walks the document once and attempts each run of table-like lines a single time, and in Source mode it reads the editor's own text buffer instead of copying the document into a string first
  - **This changes what counts as a table on a narrow class of documents**, deliberately and with the change measured rather than assumed: where a table-like block was followed by a second delimiter line, mdpro previously reported overlapping tables and now reports one. Every affected shape is one that the GFM reference parser does not treat as a table at all — mdpro over-detects them, which is a separate recorded defect. See [ADR-0008](docs/adr/0008-non-candidate-delimiter-class-measured-against-gfm.md). That over-detection has since been fixed — see the MCP table-editing entry above
- Opening a table-heavy document in WYSIWYG mode no longer freezes the window for the better part of a minute. A 471,880-byte file containing a single 45,744-cell table blocked the main thread for roughly 56 seconds. The cost was a quadratic in the transitive dependency `micromark-extension-gfm-table`, whose `2.1.1` edit map linear-scans its accumulated edit list before appending, so the scan grows with cell count — 1.36e10 array comparisons for that one file. Parse time scaled ×4 for every doubling of the table. Upstream fixed the algorithm in `2.1.2` (an index `Map`, O(1) lookup), which is now pinned via `pnpm.overrides`; the fix was confirmed by diffing the two installed versions rather than by taking the release note's word for it. Parsing that table drops from 15.8 s to 404 ms (**39×**) with byte-identical HTML output, and scaling goes from quadratic to linear; through the full editor mount path, wall clock drops from 58 s to 6.6 s. See [ADR-0006](docs/adr/0006-bump-micromark-gfm-table-for-quadratic-edit-map.md) for why this patch bump was taken despite the stage gate's no-new-dependencies rule, and for what the measurement does **not** cover (WebKit table layout is not modelled, so this does not by itself make a 472 KB single-table document usable in WYSIWYG)
  - **Not fixed by this change**: the separate Source-mode stall, which is in mdpro's own table parser (`findAllTables` / `parseTableAt`) and is reached through the CodeMirror lint timer. It is measurable below the 500 KB threshold that ships today and is tracked separately
  - The 500 KB WYSIWYG guard is unchanged and still active. Its mechanism was verified sound — it has never once admitted a document above the threshold — but its threshold is too permissive and it measures bytes, while the cost actually tracks cells in the largest single table
- Frontend structured logging no longer stops shortly after startup in the packaged desktop app. Roughly one second into a session the `ui.*` records stopped reaching `~/.mdpro/mdpro.log` and never resumed, while Rust-side records kept flowing all session — so the log looked healthy while silently recording only half the application. Cause: `preferencesService` detects the Tauri environment by testing for `window.__TAURI__`, but Tauri v2 injects that global only when `app.withGlobalTauri` is enabled, and it is not. Inside the real app `getPreferences()` therefore returned the browser-mode fallback constant without ever calling Rust; that constant declared logging disabled; `App.tsx` wrote it into the logging store; and every subsequent `logEventSync` returned early at its level check. Logging settings are now hydrated through `loggingService.hydrateSettings()`, which reaches the Rust `get_logging_settings` command directly and so does not depend on the environment detector at all
  - A user who explicitly turned logging **off** stays off. The backend value is applied verbatim rather than forced on — the fix restores the user's real setting, it does not re-enable logging behind their back
  - That guarantee originally held only on the success path; the error path is now covered too — see "Turning frontend logging off is no longer undone by a failed settings read" below
  - The browser-mode constant's own logging default was corrected from `enabled: false` to `enabled: true`, matching Rust's `LogSettings::default()`. The comment above that constant already required it to stay in sync with the Rust default; the constant had drifted from it
  - **Scope, deliberately narrow**: the `__TAURI__` environment detector itself is left unchanged. Correcting it would restore every preference at once and expose three separately-verified latent defects that need their own regression tests — window geometry saved in physical pixels but restored as logical units, `lastViewMode` written before it is read back, and the system-theme listener having no cancellation. Those belong to their own change
- Turning **frontend** logging off is no longer undone by a failed settings read. When the Rust `get_logging_settings` command returned an error, the frontend substituted a hard-coded `enabled: true`, silently switching logging back on for a user who had turned it off — contradicting the guarantee stated above by the same change. The failure was undetectable in practice because that substituted value was byte-identical to the logging store's own initial state, so nothing observably changed when it happened. The fallback now fails **closed**: if the settings cannot be read, frontend logging is off
  - **User-visible consequence, a deliberate trade**: an unreadable or unparseable `~/.mdpro/config.json` now means no frontend `ui.*` records until the file is repaired or removed. A silent violation of an explicit opt-out is worse than a silent gap in the log. A fresh install is unaffected — a missing config.json is created with defaults and returns successfully, so a first launch still arrives at `enabled: true` through the normal path
  - **Limited to the frontend, and this half is not fixed**: the Rust-side logger keeps its own settings cache, initialized once from the same config.json but falling back to `enabled: true` when that read fails. In exactly the scenario where the frontend now fails closed, Rust records therefore keep flowing. "Logging is off" would over-claim in the same way the original line-37 wording did; closing that gap needs its own change
  - The fail-closed value is a **read-side default only** and is never written back to config.json. Persisting it would turn a transient startup failure into permanent destruction of the user's real setting
- Logging settings no longer overwrite a concurrent preferences change. `set_logging_settings` read `~/.mdpro/config.json`, replaced its `logging` field, and wrote the whole file back without holding the preferences lock — while `set_preferences` and `save_window_state`, which write the same file, both take it. Any preference saved during that unlocked read-then-write window was silently discarded (a lost update): the logging command wrote back a copy of the file from before the other change landed. The read-modify-write now holds `preferences_rw_lock` for its full span, including the in-process logger cache update, so the disk and the running logger cannot disagree
- Log records are no longer corrupted by concurrent writes. `logger::log_structured_event` emitted the JSON line and its trailing newline as two separate appends, so a second thread could land between them and produce a fused `{a}{b}` line followed by a stray blank one. 35 such records already exist in `~/.mdpro/mdpro.log`, every one containing `}{` and none truncated. Each record is now assembled in a single buffer and issued with one `write_all`. A corrupt record is worse than a missing one: it is silently unparseable, so the log misreports what happened instead of merely omitting it
- Preferences write-through no longer fails silently (Typora-parity Phase 0, WI-0.5): `preferencesService.setPreferences()` now catches a disk-write rejection, surfaces a "Failed to save preferences" toast (one signal per surface), logs the failure, and re-throws so awaiting callers can react. Previously the many `void setPreferences(...)` fire-and-forget call sites lost the error entirely
- Settings panel label/control vertical misalignment — `.settings-row-content` was missing `flex: 1` (preventing `space-between` from distributing width) and had `align-items: flex-start` instead of `center`, causing controls to top-align rather than vertically centre next to labels
- TOC click-to-navigate broken in all view modes
  - `editor-only`: `preview-container` was absent from the DOM, so `scrollToHeading` returned immediately with no effect
  - `split`: only the preview pane scrolled; the CodeMirror editor pane did not
  - All modes using CodeMirror: DOM-based heading search is fundamentally incompatible with CodeMirror's plain-text rendering — headings have no `<h1>`–`<h6>` elements in the editor pane
  - Fix: `useTOC` now accepts `viewMode`; for `editor-only` and `split`, navigation uses `EditorView.scrollIntoView` targeting the heading's line number (stored in `TOCEntry.lineNumber`)
- Heading anchor ID mismatch between Rust renderer and JS TOC parser
  - `markdown.rs` replaced each non-alphanumeric character individually (e.g. `. ` → `--`), while the JS algorithm collapses runs to a single `-` (e.g. `. ` → `-`), causing `data-heading-id` selectors to fail for headings like `"1. Introduction"`
  - Fix: `markdown.rs::generate_heading_id` now uses run-based collapsing, matching `tocService.ts` and the existing `commands/toc.rs` logic

### Added
- MCP (Model Context Protocol) Server for LLM integration
  - HTTP API server with token authentication (localhost only)
  - Shadow Store for syncing document state from frontend to Rust
  - `mdpro_mcp` binary for Claude Code, Codex CLI, and Gemini CLI integration
  - Tools: get_open_documents, read_document, write_document, insert_content
  - Write confirmation dialog when mdpro is not focused
  - Multi-window routing based on most recently focused window
  - Server config files at `~/.mdpro/server.port` and `~/.mdpro/server.token`
  - Quickstart guide at `specs/007-mcp-server/quickstart.md`
- TOC store (`src/stores/tocStore.ts`) with TOCEntry, TOCState interfaces and Zustand store
- Tab store (`src/stores/tabStore.ts`) with Tab, TabState, ClosedTab interfaces and MRU logic
- TOC service (`src/services/tocService.ts`) with IPC wrappers and frontend heading parser
- Image service (`src/services/imageService.ts`) with all interfaces and IPC wrappers
- Rust TOC commands (`src-tauri/src/commands/toc.rs`) with pulldown-cmark parser for heading extraction
- Rust image commands (`src-tauri/src/commands/image.rs`) for resolve, upload, batch upload, copy external
- AutoSaveConfig, TabBarConfig, ImageConfig structs in preferences.rs
- Multi-document support methods in documentStore (getDocumentById, setActiveDocument, getActiveDocument, getDocumentByPath)
- useTOC hook (`src/hooks/useTOC.ts`) with Intersection Observer for spy scrolling
- TOCSidebar component (`src/components/Sidebar/TOCSidebar.tsx`) with hierarchical rendering
- SidebarContainer component (`src/components/Sidebar/index.tsx`) for toggling between file list and TOC views
- Tab component (`src/components/TabBar/Tab.tsx`) with dirty indicator and middle-click close
- TabBar component (`src/components/TabBar/TabBar.tsx`) with horizontal scroll and new tab button
- CSS styles for TabBar and TOCSidebar components
- base64 dependency to Cargo.toml for image upload support
- Project constitution with changelog tracking rule (`.specify/memory/constitution.md`)

### Changed
- Extended UserPreferences schema to include autoSave, tabBar, and image configuration sections
- Updated `src-tauri/src/commands/mod.rs` to register toc and image command modules
- Updated `src-tauri/src/models/mod.rs` to export new config types

## [0.3.0] - 2026-04-10

### Added
- **Two-mode editor** — ViewMode simplified to WYSIWYG (⌃4) and Source (⌃2); the old four-mode setup (split / editor-only / preview-only / wysiwyg) is retired. Stored preferences migrate automatically.
- **Inline source reveal** — in WYSIWYG mode, moving the cursor over a link, image, or code span reveals the raw Markdown inline. Press ⌃\` to force-reveal the element under the cursor on demand.
- **Draft migration** — legacy `~/.mdpro/drafts/` auto-save files migrate to the correct platform data directory on first launch.

### Fixed
- Cmd+S no longer causes a visible blink in the mode label (closes #377)
- Highlight toggle now works on existing selections in WYSIWYG mode (closes #376)
- Image src resolves immediately after paste; no more flash of broken image (closes #375)
- MCP `insert_content` checks window focus before injecting (closes #356)
- MCP shadow store rolls back on emit failure; rollback outcome now logged
- MCP insert panics on multi-byte (emoji/CJK) documents (closes #345)
- MCP `mcp_sync_documents` payload size enforced; `log_event` payload capped (closes #316)
- MCP TOML config path escaped correctly (closes #145)
- IPC commands `check_file_modified`, `reload_file`, `copy_external_image` validate paths (closes #351, #346, #266)
- HTML export sanitized with ammonia to prevent stored XSS (closes #246); heading IDs and task-list checkboxes preserved
- Split-view drag listeners cleaned up on unmount (closes #123)

### Changed
- Title bar row removed; mode label moved to the sidebar traffic-lights zone
- ⌃1 (Split) and ⌃3 (Preview Only) removed; ⌃2 now maps to Source

---

## [0.2.6] - 2026-04-02

### Added
- In-app update checker — Settings → About shows version, checks for updates, tracks download progress, and installs with one click

### Fixed
- File watcher no longer triggers on self-writes (closes #291)
- Stale closures eliminated in `useMcpEvents` (closes #284, #254)
- `save_file` validates file extension to prevent arbitrary writes (closes #279, #264, #245, #209)
- TOC heading parser handles CRLF line endings (closes #259)
- Auto-save reads active document ID from store instead of captured closure (closes #220)
- MCP server clears focused window on blur (closes #201)
- `export_html` theme param sanitized with allowlist (closes #193)

### Removed
- Dead `useMilkdown` hook (closes #239)
- Dead `getServerInfo()` from mcpService (closes #195)

---

## [0.2.5] - 2026-04-02

### Fixed
- Highlight and Export HTML shortcuts wired through preferences system (closes #207, #192)
- `dirs::home_dir()` replaces `env::var("HOME")` for portability (closes #176)
- Draft auto-save and deletion errors now logged instead of silently swallowed (closes #163)
- MCP binary path platform guard added for non-macOS builds (closes #185)
- Link modal callback guarded against destroyed editor view (closes #161)
- CRLF normalized before highlight preprocessing in CodeMirror (closes #182)

---

## [0.2.4] - 2026-03-31

### Added
- Settings panel redesigned with 9 sections (Editor, Markdown, Appearance, Export, Keyboard Shortcuts, Integrations, etc.)
- User-configurable keyboard shortcuts — bind any action in Preferences → Keyboard Shortcuts
- CodeMirror compartments for live preference reconfiguration (font size, line wrap, tab size)
- `==highlight==` syntax rendered in WYSIWYG mode (closes #40)
- React modal for ⌘K link insert, replacing `window.prompt` (closes #25)
- Atomic preferences writes with concurrent-save lock

### Fixed
- Settings panel label/control vertical misalignment (closes #78)
- ⌘/ view-cycle only intercepts when the editor is not focused (closes #32)
- Sidebar toggle shortcut documented and corrected to ⌘⇧L (closes #33)

---

## [0.2.3] - 2026-03-22

### Fixed
- ⌘1–6 heading shortcuts in Milkdown WYSIWYG mode (closes #37)
- Inline code and strikethrough keybindings restored (closes #36)
- ⌘0 paragraph shortcut uses `turnIntoTextCommand` correctly (closes #34)
- ⌘⇧H highlight routed to Milkdown command in WYSIWYG mode (closes #35)
- XSS, URL injection, path traversal, and token leak vulnerabilities patched
- TOC click-to-navigate restored in all view modes
- Stale-closure writes and cross-document dispatches guarded in editor store

---

## [0.2.2] - 2026-03-21

### Added
- Image paste into WYSIWYG editor (⌘V) — image saved to `assets/` folder beside the `.md` file, reference inserted automatically
- Find & Replace via ⌘F using CodeMirror search extension (closes #9)
- Drag-and-drop image files onto the editor inserts `![image](path)` (closes #12)

### Fixed
- YAML frontmatter stripped before rendering (closes #15)
- Pasted HTML sanitized; `javascript:` links blocked in WYSIWYG (closes #7, #10)
- Unicode-aware heading slugs for CJK characters and emoji (closes #8)
- CRLF line endings normalized on file read (closes #11)
- Milkdown listener wired to documentStore — fixes Cmd+S data loss after WYSIWYG edits
- Accessibility: DevToolbar `tabIndex=-1`, Escape closes dialogs (closes #13)

---

## [0.2.1] - 2026-02-04

### Added
- MCP Integrations settings panel — configure MCP server from inside the app

### Fixed
- MCP HTTP server stays alive between requests (shutdown sender now retained)
- TOC click-to-jump working in WYSIWYG mode
- MCP HTTP port hardcoded to 55045 for stability

---

## [0.2.0] - 2026-02-04

### Added
- **MCP (Model Context Protocol) server** — expose open documents to Claude Code, Codex CLI, and Gemini CLI. Tools: `get_open_documents`, `read_document`, `write_document`, `insert_content`. Server config at `~/.mdpro/server.port` and `~/.mdpro/server.token`.
- **Table of contents sidebar** — heading extraction via pulldown-cmark, click-to-navigate, scroll-spy highlighting.
- **Tab bar** — open multiple documents at once with configurable position, close behavior, and MRU tracking.
- **Bottom status bar** — mode tabs at the bottom of the editor window.
- Image service with base64 conversion for bundled assets.

---

## [0.1.8] - 2026-01-29

### Added
- Default view mode from preferences applied when opening files

### Fixed
- Windows close error

---

## [0.1.7] - 2026-01-29

### Added
- Structured JSONL logging to `~/.mdpro/mdpro.log` for debugging production builds

### Fixed
- WYSIWYG mode rendering issue

---

## [0.1.6] - 2026-01-25

### Added
- Multi-window support
- Table formatting in WYSIWYG editor
- Window state persistence across launches

---

## [0.1.5] - 2026-02-03

### Added
- Use default view mode from preferences for file opens (a3a8a5f)

### Fixed
- Windows close error (ee9eb79)

### Changed
- Automate version update in release workflow (601909e)

## [0.1.4] - 2026-02-02

### Fixed
- WYSIWYG mode rendering issue (aaf3c48)

### Added
- Structured JSONL logging for debugging (d5051bc)
