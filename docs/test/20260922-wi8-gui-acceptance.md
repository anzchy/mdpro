# WI-8 — Scroll position across Source/WYSIWYG switches, GUI acceptance (2026-09-22)

Closes the "GUI 验收未在 bundle 上执行" item of WI-8 (`c9a1698`) as far as one bundle
pass can. The question is whether the block visible at the top before ⌃2 / ⌃4 is still
at the top after the switch, whether every switch writes exactly one
`editor.scroll_anchor.capture` and one `editor.scroll_anchor.restore`, and whether
anything moves the position again afterwards.

Evidence is **line numbers and log-line counts**, not timings. The Source top line was
read from the CodeMirror gutter; the WYSIWYG top block was read from the fixture's
paragraph labels (`P001`…).

## Binary under test

| Field | Value |
|---|---|
| Build | `pnpm tauri build` (release) in a clean detached worktree at `c9a1698` |
| Bundle | `src-tauri/target/release/bundle/macos/mdpro.app`, id `com.mdpro.app`, v0.3.0 |
| `Contents/MacOS/tauri-app` sha256 | `bff15546642102ff504eb7e1c25aa76f68f4e72a344a22df004b1fb63b5e046d` |
| Control | The same build at `44607d8` (pre-WI-8), release sha256 `0440b48f…`. It was used only to decide whether a defect predates WI-8. |

Fixtures are scratch files outside the repo:

- `wi8-fixture.md`: 313 lines with YAML frontmatter. It has three `## Setup` headings (lines 8 / 110 / 212, so the heading text is duplicated), labelled paragraphs, `## Table 2` at 134 with row T2-01 at 138, `## Code 2` at 157 with a fence opening at 159, and a local image at 124.
- `wi8-nofm.md`: the same body without the frontmatter.
- A 9-line short document.

## Steps and evidence

| # | Check | Result |
|---|---|---|
| A | Source, top line 108 → ⌃4 → ⌃2 | WYSIWYG top block `P019`, then Source top line 107 / 108. **Within ±3.** |
| B | WYSIWYG, table row T2-02 at the top → ⌃2 | Source top line 138 / 139. The log says `tier: "block"`. **Within ±3.** |
| C | WYSIWYG, code line `line_2_04` at the top → ⌃2 | Source top line 163 = 159 + 4. **Exact.** |
| D | 10 round trips ⌃2 ⌃4 from mid-document, with no scrolling in between | **0 lines of drift** after the 10th trip. The log slice for the trips has 20 `view.mode.change` lines and 20 `capture` lines (10 from each mode). There are 10 `restore {surface: wysiwyg}` lines, all `frames: 2`, and 10 `restore {surface: source}` lines, all `tier: block`. There are **0** heading-tier restores and **0** `warn`/`error` lines. |
| E | Short document (fits in the viewport), ⌃2 / ⌃4 | No movement. |
| F | Image settle: Source top line 132 (below the image at 124) → ⌃4, then no input | WYSIWYG top block `P029`, the same after 0 s and after 3 s. The image-resolve line is written about 80 log lines after the restore, and **no second restore** follows it. No shift observed. |
| G | Double theme (light / dark) | **NOT VERIFIED.** Not run in this pass. |
| H | Large paste followed by a switch | **NOT VERIFIED.** Not run in this pass. |
| I | Outline highlight after a restore (risk ③) | **NOT VERIFIED, blocked** by the pre-existing defect below. The WYSIWYG highlight does not follow scrolling even without a mode switch, so it cannot tell whether a restore writes `activeEntryId` correctly. |

## Verdict

**DONE for position retention:** A–F pass, with 0 drift over 10 round trips and a 1 : 1
capture/restore count. **NOT VERIFIED:** themes (G), large paste (H), and outline
highlight after a restore (I). The ledger row stays `Partial`.

## Observations (not WI-8 failures)

- **The WYSIWYG outline highlight does not track scrolling. This predates WI-8.** It
  reproduces on a cold open with no mode switch, with and without frontmatter, and on
  the `44607d8` control bundle. With frontmatter, the log carries one
  `ui.toc.resolve.mismatch` `{entryCount: 10, domCount: 11, resolvedCount: 10}`. The
  frontmatter adds one heading-level element to the DOM that the outline parser does not
  count. Without frontmatter the highlight still sticks, so the mismatch is not the whole
  cause. Candidate: `useWysiwygScrollSpy.ts`, where the observer uses `root:
  #container` with `rootMargin: "0px 0px -66% 0px"`, and the scroller in WYSIWYG is
  `div.milkdown`. This was not investigated further. It needs its own follow-up.
- **The frontmatter renders in WYSIWYG as a horizontal rule followed by a
  heading-sized line.** This is the same extra DOM heading that the mismatch above counts.
- An apparent "image-load drift" seen early in this pass was caused by the tester's own
  10-notch scroll. A controlled re-run (F) found none. The claim was retracted.
