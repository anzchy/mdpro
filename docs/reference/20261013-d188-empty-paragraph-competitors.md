# D188 / ADR-0091: how competitors persist an empty paragraph (research, 2026-10-13)

Research by an Opus subagent dispatched by mdpro-delegator on 2026-10-13, after the user cancelled a first-hand Typora run (「cancel 本机器typora实测，改为看看竞品(typora,marktext)是怎么处理的」). No Typora GUI run was made; MarkText byte counts are read from its source, not run. Evidence record for [ADR-0091](../adr/0091-an-empty-wysiwyg-paragraph-is-saved-as-blank-lines-and-read-back-by-count.md).

Scope: Typora (closed source), MarkText (source read, not run), plus brief notes on Obsidian, GitHub, Milkdown, skysa-notes.
"Empty paragraph" means the block that Enter creates on an empty line in WYSIWYG mode. `P` = text paragraph.
No Typora GUI run was done. Every Typora byte claim below comes from someone else's run.

## Summary table

| Editor | Bytes between `A` and `B` with 1 / 2 empty paragraphs | Gap survives reopen? | List / quote / end of doc | Source quality |
|---|---|---|---|---|
| **Typora** | 1 → `A\n\n\n\nB` (4 newlines, i.e. 3 blank lines); 2 → `A\n\n\n\n\n\nB` (6 newlines). The rule is two newlines per empty paragraph on top of the normal separator | **Yes, per third-party fixtures.** Typora reads a run back as floor-based pairs, and an odd leftover newline is dropped (`A\n\n\nB` reopens as 2 paragraphs, no gap) | Quote: `> A\n>\n> \n>\n> B`, where the empty paragraph's line is `> ` and the separators are `>`. List item: Enter+Backspace in `- a` gives `- a\n\n  \n\n- b`, the item goes loose, and the empty paragraph is an indent-only line. End of doc: `a\n\n`, `- a\n\n`, `> a\n\n` (no final terminator) | **Third-party fixtures and user reports.** Typora's docs only say "one blank line" per Enter. No first-party statement covers empty-paragraph bytes or reading them back |
| **MarkText** (v0.17.1 and current master) | 1 → `A\n\n\n\nB\n`; 2 → `A\n\n\n\n\n\nB\n`. Same arithmetic as Typora, derived from the code | **No.** The importer discards marked's `space` tokens, so every blank-line run collapses to a plain paragraph break. Maintainer: the model "does not record how many blank lines" | Quote: each line gets the `> ` prefix (master trims it to `>`). End of doc: `A\n\n\n`. No setting exists | **Source code**, plus a maintainer statement |
| **skysa-notes** (Milkdown, PR #211) | 1 → `A\n\n\nB` (2 blank lines); 2 → `A\n\n\n\nB`. Its rule is "n blank lines = n−1 empty paragraphs" | Yes, between blocks only. Empty paragraphs at the start or end of a container are written as nothing and dropped | Rule applies inside a quote and a list item too, between blocks only | First-party PR text (that project's own decision) |
| **Milkdown upstream** | `<br />` line (`remarkPreserveEmptyLinePlugin`) | Partly (the `<br />` is read back) | — | Maintainer reply |
| **Obsidian reading view / GitHub** | n/a (source editors write what you type) | Rendered view collapses any run of blank lines (CommonMark) | — | Spec plus user forum |

## Q1. Typora

### First-party statements (support.typora.io, Typora maintainer `abnerlee`)

- Markdown Reference, "Paragraphs and line breaks" (https://support.typora.io/Markdown-Reference/):
  - "In Typora, you only need one blank line (press Return once)…"
  - "paragraphs are separated by two or more blank lines."
  - This covers the paragraph separator. It says nothing about empty paragraphs.
- Whitespace and Line Breaks (https://support.typora.io/Line-Break/):
  - "when you press `Enter` key, a new paragraph is created."
  - Default: "Preserve line breaks in editing view and ignore them when print or export"; whitespace is preserved the same way.
  - The page says nothing about empty paragraphs or how blank-line runs are written or read. Settings live at Preferences → Markdown → Whitespace / LineBreak.
  - No "preserve blank lines" option is documented.
- typora-issues #324 (https://github.com/typora/typora-issues/issues/324), abnerlee: "Press "Return" for new paragraph. (one blank line)".
- typora-issues #5477 (https://github.com/typora/typora-issues/issues/5477), abnerlee, about a gap the cursor cannot enter:
  - "They are rendered as two paragraphs, not line 1, empty line line 2."
  - This is first-party and shows that a blank-line run in the file is not always an empty paragraph in Typora's view. The exact bytes of that file are not in the thread.
- typora-issues #73 (https://github.com/typora/typora-issues/issues/73), 2016:
  - Reporter: "empty lines after a list may be deleted… in the opening file process".
  - abnerlee: "Typora will try to keep the current formatting, so that should be a bug", then "fixed in latest version".
  - Shows intent to keep blank lines. Says nothing about how they are encoded.
- typora-issues #945 (https://github.com/typora/typora-issues/issues/945): trailing blank lines in fenced code were stripped on load. abnerlee: "should be fixed in new release". This concerns code blocks, not paragraphs.
- Changelog: searches found no release note that mentions empty paragraphs or blank-line runs.

### User reports showing Typora's own output

- typora-issues #5228 (https://github.com/typora/typora-issues/issues/5228), Typora 2022:
  - Gesture: on `- a` in a tight list, press Enter then Backspace, then save.
  - Saved file: `- a\n\n  \n\n- b\n\n- c\n\n- d`. The empty paragraph inside the item is an indent-only line (`  `) between two separators, and the whole list goes loose.
  - abnerlee replied "It can be discussed" and did not dispute the bytes.
- typora-issues #5787 (https://github.com/typora/typora-issues/issues/5787): the user says Enter in write mode produces `some text\n\nnew text`, i.e. one blank line, except before a math block, where it is removed.
- typora-issues #5772 (https://github.com/typora/typora-issues/issues/5772): Typora "will sometimes add unwanted whitespace on blank lines" on save (inside a code block).

### Third-party fixtures (loomou/markdown-editor-rs PR #66)

PR #66 (https://github.com/loomou/markdown-editor-rs/pull/66) was merged 2026-10-08. I verified it from the PR body and from commit messages on its branch (`pr66` head `86a105c`). The PR says Typora "wrote the files this work was measured against". The fixture files themselves (`docs/tests`) are **not committed** in the repo; `git ls-tree` on the PR head shows none. So the byte strings below are quoted from commit messages and cannot be re-checked.

- Commit `75350b6`: "Two newlines per empty paragraph is what Typora does".
  - "`甲\n\n\n乙` is two paragraphs rather than three"
  - "A run with an odd newline count therefore loses its lone newline on save, which the Typora fixtures had already shown."
  - Fold rule: a run between blocks holds `newlines/2 − 1` empty paragraphs; a run at the head or tail holds `newlines/2`.
- Commit `9418f55`: "`甲\n\n\n` loads as three paragraphs where Typora reads two". This is the read-back side.
- Commit `cb2b1fd`:
  - Gestures ⇧⏎⇧⏎ on `a`, ⏎⏎ on `- a` and ⏎⏎ on `> a` all leave an empty paragraph, and "Typora writes `a\n\n`, `- a\n\n` and `> a\n\n`".
  - `SB-BLK-p-rule-2` is `甲\n\n\n\n---\n\n`: one empty paragraph between `甲` and a rule is 4 newlines.
- Commit `614c232`: "`CT-IN-1` is `> 甲\n>\n> \n>\n> 乙`, so one blank paragraph between two quoted paragraphs is five lines". The empty paragraph's line is `> `; the separators are `>`.
- Commit `728c8db`: separators use the marker alone. `SB-IN-9` is `> 甲\n>\n> 乙`, and `list-sh` is `- 甲\n\n  乙`.
- PR body: Typora "leaves the last line unterminated when the document ends with a paragraph".
- The SE3-A claim (`甲\n\n\n` for three ⇧⏎) appears in the PR summary I fetched. ⇧⏎⇧⏎ merges into a paragraph break ("Typora merges the two into a single paragraph break"), so it is a soft-break case rather than an Enter case.

### Other third-party reports

- marktext/marktext #3455 (https://github.com/marktext/marktext/issues/3455): "marktext won't show empty lines of files that created by 'Typora'". This implies Typora files carry extra raw blank lines that Typora itself displays.
- Joplin forum (https://discourse.joplinapp.org/t/how-to-insert-an-empty-line/12233): "Blank lines inserted in a Typora edit are also discarded when returning to Joplin." Also implies raw blank lines on disk.

## Q2. MarkText (source read at two commits; nothing run)

Commits read:
- Tag `v0.17.1` = `c8aa33ddcd41184ecac3bd5e67451569b32d8e38` (2022-03-07), legacy Muya under `src/muya/lib`.
- `master` = `b7e0124e163070828c90d547f7c9487278d2cc51` (2026-10-12), rewritten Muya under `packages/muya/src`, desktop `0.22.0-dev`.

### Writer

v0.17.1, `src/muya/lib/utils/exportMarkdown.js`:
- L46–51: `case 'p': case 'hr':` calls `insertLineBreak` and then serializes the children.
- L171–174: `insertLineBreak` pushes `${indent}\n` unless the output is empty.
- L176–180: `normalizeParagraphText` returns `lines.map(indent+line).join('\n') + '\n'`.
- An empty paragraph (`text: ''`) is therefore `indent + "\n"` after a `indent + "\n"` separator: two newlines per empty paragraph, plus the separator before the next block.
- Result: `A\n\n\n\nB\n` for one empty paragraph and `A\n\n\n\n\n\nB\n` for two. This is my derivation from the code, not from running it.

master, `packages/muya/src/state/stateToMarkdown.ts`:
- L153–157: `case 'paragraph':` falls through to `'thematic-break'`, which calls `_insertLineBreak` and then `_serializeTextParagraph`.
- L304–312: `_insertLineBreak` pushes `indent` with trailing spaces trimmed, plus `\n`. Inside a quote the separator is `>`, not `> `.
- L353–361: `_serializeTextParagraph` gives `''` → `indent + "\n"`.
- Same arithmetic as v0.17.1.

### Reader

- v0.17.1 `src/muya/lib/utils/importMarkdown.js` L415–417 and master `packages/muya/src/state/markdownToState.ts` L442–444 both have `case 'space': { break }`. marked's blank-line tokens are discarded.
- `paragraph` tokens (v0.17.1 L325–333, master L432–440) become paragraphs only for non-blank text. No count of blank lines is kept, so on reopen the gap is gone.

### Settings and maintainer statement

- No preserve setting. The only blank-line preference is `trimUnnecessaryCodeBlockEmptyLines` (code blocks only): `packages/desktop/static/preference.json` L26 on master, and `static/preference.json` L21 at v0.17.1.
- Maintainer Jocs, closing #3455 as a duplicate of #1354 ("[Compatibility] Automatic Removal of Empty Lines", still OPEN, https://github.com/marktext/marktext/issues/1354): the model "does not record how many blank lines sat between blocks".

**Net:** MarkText writes raw blank lines (two newlines per empty paragraph, the same as Typora) but cannot read them back. A save-and-reopen drops the gap. This is the asymmetry #3455 reports.

## Q3. Brief notes

- **CommonMark / GitHub.** Spec §4.9 (https://spec.commonmark.org/0.31.2/#blank-lines): "Blank lines between block-level elements are ignored". GitHub's GFM renderer follows it, so any run of blank lines renders as one paragraph break. A Typora file with an empty paragraph renders on GitHub with no visible gap.
- **Obsidian reading view.** Reading view collapses blank-line runs, per forum threads, not a first-party doc:
  - "Respect Blank Lines in Preview Mode": https://forum.obsidian.md/t/respect-blank-lines-in-preview-mode/2417
  - "Support multi line breaks like Typora": https://forum.obsidian.md/t/support-multi-line-breaks-like-typora/43434
  - Users work around it with `<br>`. I found no staff statement and no setting.
- **Editors that count blank lines back into empty paragraphs on load:**
  - (a) **Typora**, per the markdown-editor-rs fixtures. Encoding is two newlines per empty paragraph, read back by pairs, and an odd newline is dropped.
  - (b) **skysa-notes PR #211** (https://github.com/skysa-org/skysa-notes/pull/211, merged), built on Milkdown:
    - Writes one extra blank line per empty paragraph and reads "a gap of *n* blank lines between two blocks… as *n − 1* empty paragraphs".
    - Applies only between blocks, so empty paragraphs at a container's start or end are not kept.
    - Old `<br />` lines are kept as inline HTML.
    - This is a different encoding from Typora's.
  - (c) **markdown-editor-rs PR #66** itself, which copies Typora's fold.
  - **Milkdown upstream** keeps `<br />` (`remarkPreserveEmptyLinePlugin`). Maintainer on milkdown #2379: "Just call `editor.remove(remarkPreserveEmptyLinePlugin)`". milkdown #1579 ("Empty nodes are not preserved") was answered "on the roadmap".
  - **Zettlr** is a CodeMirror source editor, so it writes the user's blank lines verbatim with no paragraph model. Not checked further.

## What this means for option E ("raw blank lines written, read back by counting blank lines")

**The claim "Typora writes raw blank lines and reads them back" is partially supported. It is not contradicted, but nothing first-party confirms it.**

**Writes raw blank lines: well supported.** Four independent sources agree:
- the markdown-editor-rs fixtures (byte strings in commit messages);
- typora-issues #5228 (a user's saved Typora file);
- MarkText #3455 and the Joplin report (Typora files carry extra blank lines other apps drop);
- Typora's docs, which describe Enter as producing blank lines and never mention `<br>` for empty paragraphs.

No source shows Typora writing `<br />` or `&nbsp;` for an empty paragraph.

**Reads them back: third-party only.** The evidence is markdown-editor-rs's fixture round-trips ("where Typora reads two", 73 of 109 fixtures as fixed points). Those fixtures are not published, so I could not check them.

One first-party remark (#5477, "rendered as two paragraphs, not … empty line") shows that some blank-line runs do not come back as empty paragraphs. That fits the "odd newline dropped" fold but is not proof of it.

**The encoding detail matters for E.** Typora's apparent rule is **two newlines per empty paragraph** between blocks:
- one empty paragraph is `A\n\n\n\nB`;
- `A\n\n\nB` (one extra blank line) reopens with **no** gap.

skysa-notes chose **one** extra blank line per empty paragraph (n−1). The two are not byte-compatible:
- A file mdpro writes the skysa way (`A\n\n\nB`) would show no gap in Typora (per the fold).
- A Typora file (`A\n\n\n\nB`) read the skysa way would show **two** empty paragraphs.

If ADR-0091 cites Typora parity, it should name the 2-newline encoding and its odd-run rule. The quote and list prefixes matter too: the empty-paragraph line is `> ` or the item indent, and the separator is `>` or empty. It should also mark the evidence as third-party fixtures plus user reports, not Typora documentation.

**Every rendered surface collapses the gap anyway.** Export, GitHub and Obsidian reading view show no gap, so E keeps the gap only in WYSIWYG editors that adopt the same counting rule. MarkText writes the same bytes but drops them on load.

**Cheap way to firm this up:** a 5-minute Typora run. Make one and two empty paragraphs between `A` and `B`, `hexdump` the saved file, then reopen `A\n\n\nB` and `A\n\n\n\nB`. That would settle both halves first-hand.
