# 0136. Source mode gets an opt-in prefix navigation layer

## Status

Accepted, 2026-10-23. Decided by the user, recorded by herdr-delegator. The user's words: 「接受 (Recommended)」.
Proposed the same day. Revision 2 answers both round-one reviews
(`~/.mdpro-redesign/herdr-spike/delegator/ADR-0136-r1-merged.md`); revision 3 answers both round-two reviews
(`ADR-0136-r2-merged.md`); revision 4 fixes the two Highs of Opus's round 3 (a held prefix; backward heading search).
Codex's round 3 on revision 4 counted C0 H0 M2; Opus did not review revision 4, the round cap (ADR-0120) having
been reached. Implementation is queued after the 0.3.6 lock.

The user's requests that led to it:
1. The survey: 「let gpt-auditor to do a survey: add vim style navigation,which use `prefix + *`, so that we can
   quickly navigate through characters/ words/ paragrahps, select words/a paragraph etc. to avoid conflicts with current
   keyborad shortcuts in WYSIWYG mode, just enable vim style keyboard in Source mode. just like herdr」.
2. A recommendation on each of its seven open decisions: 「what do you recommend for each questions」.
3. This record: 「write an ADR from these seven answers, put it through the two-reviewer review」.

Evidence: [`docs/reference/20261023-vim-style-navigation-survey.md`](../reference/20261023-vim-style-navigation-survey.md).
Nothing is scheduled. Accepted, the work queues after the 0.3.6 lock.

## Context

- **The request.** Keyboard navigation by character, word, line, paragraph and heading, and selection of a word or a
  paragraph, without leaving the keyboard. It is limited to Source mode, where CodeMirror 6 owns the text, so that it
  cannot collide with WYSIWYG's shortcuts.
- **The model.** herdr's keyboard layer: a prefix chord, then one key that names an action, with a visible pending
  state.
- **Prior art** (survey § 2):
  - full modal Vim emulation: Obsidian's Vim mode, VSCodeVim, IdeaVim, Joplin's CodeMirror Vim, Zed;
  - leader or prefix layers over a normal editor: VSpaceCode, Spacemacs, herdr;
  - Logseq's `g`-prefixed block navigation.

  None of the Markdown editors surveyed has a Source-only text-navigation prefix layer.
- **mdpro's constraints:**
  - one owner per chord and platform (ADR-0114, K4/K5);
  - **one applied shortcut snapshot per run, with rebinds taking effect on the next launch** (ADR-0114 Decision 4,
    accepted);
  - the printable-AltGr guard;
  - CJK input methods;
  - a line caret, not a block cursor.

  The user's own messages and rulings are mostly Chinese, so CJK text is a first-class case.
- **The prefix.** Ctrl+; has no owner among the v2 defaults, the editor keymaps or the reserved chords (survey § 4).
  Ctrl+B, Ctrl+K, Ctrl+O, Ctrl+Alt combinations, Alt+Space and the function keys are taken or unsafe. Ctrl+; does
  have known clashes:
  - on a German layout `;` is Shift+`,`;
  - on Linux, IBus's default emoji hot key includes Ctrl+;.
- **The dependency.** `@replit/codemirror-vim` (MIT) depends on `@replit/codemirror-vim-core` 0.1.0, which is
  pre-1.0 and was published 2026-07-28. Together they add about 73 KiB gzip. A scratch experiment reused their word
  and paragraph objects through a transient compartment, with no upstream change. Their word rule treats a run of CJK
  characters as one word, and so does CodeMirror's own `wordAt`.

## Options considered

1. **Full Vim emulation in Source mode.**
   - Lost: modal editing changes what every key does. It collides with the applied snapshot and the AltGr guard, and
     brings operators, registers and an undo model to reconcile.
   - It answers a bigger request than the one made.
2. **A prefix layer on CodeMirror's own commands and small mdpro scanners.** Recommended for v1.
   - Once v1's word motion and word selection are CJK-aware (decision 2), they are mdpro's own code whichever option
     is chosen.
   - What a package would still add is paragraph motion and paragraph selection. Both are blank-line scans.
3. **A prefix layer that reuses `@replit/codemirror-vim`.** Lost for v1: a pre-1.0 core, about 73 KiB, and a transient
   compartment with its own focus, scroll and selection risks, all for two blank-line scans. The package returns to the
   table only with the full-Vim option.
4. **Do nothing; rely on the OS's native text keys.** Lost: they have no paragraph or heading motion and no word or
   paragraph selection, and they differ by platform.

## Decision

1. **The prefix.**
   - The prefix is a **command-table row with its own keyboard-shortcut field**, `editor.navPrefix`, Source only.
     Its default is **Ctrl+;** on macOS, Windows and Linux.
   - Like every configurable binding (ADR-0114 Decision 4):
     - it is ownership-checked by the shared resolver and its Rust twin;
     - a rebind is stored and shown as **pending until restart** (M7);
     - it joins the stored-key migration.
   - **The row owns its chord whether the feature is on or off.** When the feature is off, the key is not consumed.
     The suffixes are a separate action table, never stored as chords.
   - **First release:** macOS with US/ABC and the Chinese input method in its **ASCII mode** (see decision 4), and
     Windows with US. Linux is best-effort: IBus's Ctrl+; emoji key is a known clash and needs a remap.
   - **German and French layouts are not supported for the suffixes in v1.** Their `[ ] { }` are AltGr characters, so
     those suffixes are unreachable there. The help says so; later aliases can fix it.
2. **Word and paragraph rules.**
   - **Words.** The unit is a **script run within one line**:
     - Latin and other non-CJK runs use Vim's word classes: word characters, punctuation groups, whitespace;
     - CJK runs use `Intl.Segmenter` with word granularity and `isWordLike`. Han, Hiragana, Katakana and the prolonged
       sound mark ー together form **one** CJK run, so 食べる is segmented whole. Hangul is its own run. The locale is
       `zh` for a run containing Han only, `ja` when it contains kana, and `ko` for Hangul;
     - characters with Unicode `Script=Common` or `Inherited` (punctuation, fullwidth forms, combining marks) join the
       run they touch. CJK punctuation (。「」，) is never a word;
     - the edge between two runs is always a word edge;
     - `w` and `e` always advance and `b` always retreats. At the end of a line they continue on the next or previous
       line; an empty line is one stop. Offsets are UTF-16, and a surrogate pair or combining sequence is never split.
   - **The same model** drives `w`, `b`, `e` and select-word.
   - **Without `Intl.Segmenter`**, each CJK grapheme is a word.
   - **Cost.** A very long CJK line is segmented only in a window of 512 code units around the caret, never the whole
     line.
   - **Engine differences.** Segmenter boundaries come from each engine's ICU, so they may differ between WebKit and
     WebView2. Tests pin boundaries mdpro computes itself, and assert CJK boundaries only where the engines agree.
   - **Paragraphs.** A separator is a line that is empty or contains only whitespace.
     - `P }` moves to the start of the next separator line after the current paragraph, or to the end of the
       document.
     - `P {` moves to the start of the previous separator line, or to the start of the document.
     - A run of consecutive separator lines counts as one separator: `P }` and `P {` skip the whole run and land on the
       first line of the run they reach. From a caret already on a separator run they move to the next or previous
       run, so repeated presses always progress to the document's edge.
     - Select-paragraph selects the half-open range from the first character of the paragraph's first line to just
       after the last character of its last line. Separators and the trailing newline are excluded. On a separator
       line, or in an empty or all-blank document, it does nothing and shows the "not a navigation key" style hint.
3. **One key per prefix.** v1 has no counts (`3w`), no sticky mode and no key repeat.
4. **Pending state.** There is no timeout. While the layer is pending, each keydown is classified in this order. The
   first matching rule decides, and every key has a rule:
   1. **Input-method safety.** An IME-processed keydown (`keyCode` 229) is passed through untouched and **cancels**
      the layer. That includes punctuation the IME commits directly, such as 【 or 」. Dead keys and printable AltGr
      input likewise pass through untouched and cancel.
   2. **Modifier-only keydowns** (Shift, Ctrl, Alt, Cmd) are ignored, and the layer stays pending.
   3. **The configured prefix** cancels, whatever its modifiers. This is checked before any suffix, so a rebound
      Shift-only prefix pressed twice cancels rather than running a suffix.
   4. **Any key that matches an applied or fixed owner** in the run's snapshot cancels the layer and passes through to
      that owner untouched. That includes Cmd/Ctrl/Alt chords, Shift-only and function-key bindings (F3 / Shift+F3
      find next and previous), Esc, Tab and Shift+Tab. The check uses the same resolver as the shortcut hook; there is
      no second registry and no event replay.
   5. **An unmodified or Shift-only printable key** not owned under rule 4 is consumed. If it is in the action table it
      runs; otherwise it cancels with a short "not a navigation key" hint.
   6. **Any other key** cancels and passes through untouched: Enter, Backspace, Delete, the arrows, Home, End,
      PageUp, PageDown, Space and unowned function keys.

   **Repeats.** A repeat of the prefix keydown neither arms nor cancels: it is ignored, so holding the prefix past
   the key-repeat delay leaves the layer pending. The arming path also ignores `event.repeat`. Any other repeat event
   is classified like its first keydown. After a key is consumed by rule
   5, whether it ran or was rejected, its own repeats are prevented (`preventDefault`) until its keyup, so a held key
   never types. The suppression is tracked per editor instance, and every cancel event clears it, so a keyup lost to a
   blur cannot strand it. Repeats of passed-through keys are never suppressed.

   **Other cancels.** The layer also cancels on:
   - a click;
   - loss of focus;
   - the start of composition;
   - any native `menu:action`;
   - a document, tab or view switch;
   - editor teardown;
   - the feature being turned off;
   - a paste.

   The layer arms only on the focused Source content surface. The find panel, dialogs, the shortcut recorder and
   WYSIWYG are out of scope.

   **The Chinese IME.** With Pinyin in Chinese mode, the suffix goes to the IME (rule 1) and the layer cancels. v1 asks
   the user to switch the IME to ASCII mode; the help says so, and the device batch checks it.
5. **Caret and selection behaviour.**
   - `P j` / `P k` move by **visual row**.
   - `P 0` / `P $` go to the **logical** line start and end.
   - End-of-word puts the caret **after** the last character.
   - A motion collapses an existing selection and moves from its **head**.
   - Select-word and select-paragraph replace the selection.
   - With several cursors, v1 acts on the main selection only and **drops the others**.
6. **Turning it on, and the indicator.**
   - **Off by default.** A switch under Settings › Editor takes effect at once in every open window. Only the switch
     is live; the prefix chord follows decision 1.
   - **The pending indicator and the `P ?` cheat sheet are new UI.** Each gets a `design/DESIGN.md` contract and a
     prototype the user picks from (rule 70 § Questions) before implementation. Until the status strip (WI-4.8)
     exists, the indicator sits in the Source editor. When the strip is built, its contract gains a slot for it.
   - **Announcements.** The pending state is announced once through its own polite live region, separate from the
     status strip, which stays non-live.
   - **The Keyboard Shortcuts page** lists the prefix row and the action table.
7. **Scope of v1.**
   - **Moves:**
     - character: `P h` / `P l`;
     - visual row: `P j` / `P k`;
     - word: `P w` / `P b` / `P e`;
     - line start and end: `P 0` / `P $`;
     - paragraph: `P {` / `P }`;
     - heading: `P [` / `P ]`.
   - **Selections:** the current word (`P W`) and the current paragraph (`P P`).
   - **Help:** `P ?`.
   - **Heading rule.** Heading motion reads the current CodeMirror syntax tree, not the debounced outline store.
     - It covers ATX and Setext headings, empty ones included, at every level.
     - It moves to the start of the strictly previous or next heading line, and does nothing at either end of the
       document.
     - **YAML frontmatter is skipped.** Nodes inside the frontmatter range are ignored; the range is measured with the
       same `stripFrontmatter` prefix length the outline uses. Otherwise the editor's plain `markdown()` reads
       frontmatter as a Setext heading.
     - **Bounded parsing.** The parsed tree covers a contiguous prefix of the document, `[0, tree.length)`.
       - Before searching backward from a caret past `tree.length`, `P [` first calls
         `ensureSyntaxTree(state, caretLineEnd, 50)`, so no unparsed range between the frontier and the caret is
         skipped.
       - `P ]` searches the parsed tree after the caret. If no heading is there, it calls `ensureSyntaxTree` up to the
         end of the document with a 50 ms budget. If that returns `null`, the motion does
       nothing and shows "still reading the document, try again". It never retries in a loop, and never treats an
       unparsed range as having no heading.
   - **Deferred:** sentence motion (it needs a rule for 。！？ and abbreviations), list-item motion, Markdown-block
     selection, counts and full Vim. Full Vim is the only option that reopens the package question.

### Work and tiers (ADR-0121)

| Package | Tier |
|---|---|
| Design contract and prototype for the indicator and cheat sheet | Low (design, docs) |
| Command-table row, preference field, resolver and migration | High (preference writes, `src-tauri`) |
| Prefix controller, key classification, motions and selections | Medium (`src/` editor code) |
| Settings switch and Keyboard Shortcuts listing | High (a preference write) |
| Device check: macOS US/ABC with the Chinese IME in ASCII mode, Windows US, with AltGr and repeat cases | Tests take the tier of what they protect |

## Consequences

- **Gained.**
  - Keyboard navigation by unit in Source mode, behind one ownership-checked prefix that cannot collide with the v2
    keys.
  - Chinese text moves and selects by word, not by sentence-long runs.
  - No new dependency.
  - The layer is invisible until it is turned on.
- **Costs.**
  - Every motion is mdpro's own code: the word model, the paragraph scanner and the heading walk. Their boundary rules
    need tests.
  - With Pinyin in Chinese mode the layer does nothing. The user must switch the IME to ASCII mode first.
  - German and French users lose the bracket suffixes until aliases exist. Linux users with IBus must remap.
  - CJK word boundaries can differ between WebKit and WebView2. The navigation's "word" also differs from the status
    strip's word count, which counts each CJK character.
  - A mistyped plain suffix is consumed, not typed.
  - With no timeout, a forgotten prefix stays pending until a cancel event; the indicator is the safeguard.
  - Visual-row `j` / `k` beside logical `0` / `$` is an asymmetry the cheat sheet must show.
  - Several cursors collapse to one when the layer is used.
  - Changing the prefix needs a restart (ADR-0114 Decision 4).
  - The prefix row reserves Ctrl+; even for users who never turn the feature on, and the resolver reports conflicts
    against it.
  - On a 10 MB document a heading far from the parsed region can answer "still reading" instead of moving. The device
    batch measures both directions on 10 MB fixtures: one whose only heading is at the end, and one with headings
    near the end and the caret at the end, for `P [`.
  - Rule 4 of decision 4 runs the shortcut resolver on every pending keydown. That is cheap, but it ties the layer to
    the applied snapshot's shape.
  - The preference plumbing is High tier.
  - Settings, help and DESIGN.md each grow.
- **Foreclosed for now.** WYSIWYG navigation keys, operators and editing commands, counts, a sticky mode, the IME's
  Chinese mode, and the Vim package until a full-Vim decision.
