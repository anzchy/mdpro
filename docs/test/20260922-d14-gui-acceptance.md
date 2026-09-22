# D14 — WYSIWYG outline highlight follows scrolling, GUI acceptance (2026-09-22)

This pass checks the D14 fix (`00842dd`) on a release bundle. The question is
whether the WYSIWYG outline highlight follows scrolling in these situations:

- after a cold open;
- after a ⌃2→⌃4 switch;
- after a tab switch;
- after a heading edit;
- at two window shapes.

It also re-checks WI-8 criterion I, which D14 had been blocking.

It was run by the mdpro-agent-2 session, authorized directly by the user in that
session. The input source was switched to ABC by the user.

## Binary under test

| Field | Value |
|---|---|
| Commit | `00842dd` (worktree `wt-00842dd`) |
| Build | `pnpm tauri build`. It exits rc=1 at the updater signing step (no `TAURI_SIGNING_PRIVATE_KEY`); the `.app` is produced |
| `tauri-app` sha256 | `ee3c5407bfb1474b3c4593a8890475ec88370603645657721b2ec37511be1d67` |
| Control | `c9a1698`, `tauri-app` `bff15546…` |
| Fixtures | `d14-a.md`, `d14-b.md`: 216 lines, 12 `##` headings, 16,248 B, no frontmatter. Both were unchanged on disk afterwards |
| Input | Synthetic CGEvents (computer-use tool), no physical keyboard |

## Results

| # | Criterion | Result | Observed |
|---|---|---|---|
| G1 | Cold open in WYSIWYG, slow scroll | **PASS** | At 1200×800, the highlight stepped H01→H10, then H12. The cold open logged 0 `ui.toc.resolve.mismatch` lines |
| G2 | ⌃2 then ⌃4, scroll | **PASS** | H04→H05→H06 |
| G3 | Tab switch, both directions, scroll | **PASS** | B: H01→H02. A: H01→H02. B again: H01→H04 |
| G4 | Edit a heading in WYSIWYG, scroll past it | **NOT VERIFIED** | The WYSIWYG edit never reached the document store (D15 below), so the "new entries → re-arm" path was not exercised this way |
| G4′ | Stand-in: edit the heading in Source (`B H04` → `B H04 src`), ⌃4, scroll | **PASS** | The outline updated, the dirty dot appeared, and the highlight landed on `B H04 src` |
| G5 | Wide, short window | **PASS** | At 1512×643 (the screen is 1512 pt wide; 1800 was impossible), 3-tick steps went H01→H02→H04→H05→H06. H03 was skipped only on a 10-tick jump. This rules out the `rootMargin`-width hypothesis on real WebKit |
| G6 | WI-8 criterion I: highlight after a scroll restore | **FAIL (conditional)** | If the restore lands mid-section with no heading in the top ~34% band, the highlight sits on H01, the scrollTop=0 entry (3/3). If a heading is in the band, the highlight is correct |
| G7 | Log discipline | **Within limits** | `ui.toc.resolve.mismatch` went from 22 to 33 (+11). Every new line is `{entryCount:12, domCount:0}`, preceded by exactly one `editor.milkdown.mount`: 8 after ⌃4, 3 after a tab switch, 0 after a cold open. At most one per mount, as pinned by N-3/N-5 |

### G6 mechanism (inferred, not instrumented)

1. The spy arms while the fresh Milkdown view is at scrollTop 0, so H01 is intersecting and becomes active.
2. The WI-8 restore then moves the view mid-section.
3. H01 leaves the band, but no heading enters it, so the visible set is empty.
4. The retain-previous rule keeps H01.

This is the same band limitation as "scrolling up inside a long section keeps the heading below". It needs a geometric fallback when the visible set is empty.

## New findings (not D14)

- **D15: a WYSIWYG edit does not reach the document.** This happened with synthetic input under both WeType and ABC, on `00842dd` and on control `c9a1698`.
  - The text was displayed.
  - There was no dirty dot after 4 s.
  - ⌃2 Source lacked the text.
  - The log had no content or file event.
  - In the control, ⌘S saved a serialization without the typed letters. Only a lone space (`\xa0`) got through.
  - The earlier IME-composition explanation is **refuted** by the ABC run.
  - **Not reproduced with a physical keyboard.** An edit did reach the store on 2026-09-20 (log `contentLength` 5254→5255).
  - Code reading found no guard that drops `markdownUpdated`. No test pins the Milkdown transaction → `markdownUpdated` → `documentStore` path.
- **D16: quitting via AppleScript while a document is dirty gave no unsaved-changes prompt.** No file was written and no `app.quit` line was logged. Whether ⌘Q or the menu Quit behaves the same was not tested.

## Not covered

- G4 as specified: it depends on D15.
- Documents with frontmatter.
- Both themes.
- Physical keyboard input.
