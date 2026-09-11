# UI redesign plan — Risks

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Risks

| Risk | Mitigation |
|---|---|
| The split breaks tests that read `globals.css` from disk | WI-1.1 helper before the move; assertions are unchanged |
| Vite changes CSS order across partials | One ordered `src/styles/index.css`, read by the app, the test helper and the pure-move proof (E2); built-CSS order check in Stage 1 |
| A translucent `--color-border` changes elements that use it as a fill | WI-3.0 retargets fills first |
| `color-mix()` is unsupported at the WebKit floor | Floor raised to macOS 13.1 in WI-3.4 (E1) |
| A 70% focus ring misses 3:1 on soft or tinted fills | Contrast table in Stage 3; flag, don't silently retune |
| Snapping sub-12px text overflows tight chrome (tab badges, TOC) | Screenshot matrix at the default window, at 400×640 (DR16) and with the 2× scale (DR17) |
| Undeclared fallback tokens hide intended colors | Q6 resolved in Stage 2 |
| First run cannot be told apart from an upgrade | File presence decides (observed). Serde defaults cover both the field and the `editor` block; Rust tests cover both plus first run (WI-5.1) |
| A zero-change stage drifts by 1px or one color without anyone noticing | Computed-style JSON diff instead of visual comparison (E5) |
| Replacing native checkboxes breaks a setting's persistence | Table-driven per-site regression test (WI-4.3) |
| A corrupt `config.json` is overwritten at launch (pre-existing) | The E6 fix must land before Stage 5 |
| Keyboard behavior (Space on a switch) cannot be tested with plain DOM events in jsdom | Test-only Testing Library devDependencies (E7), pinned by the WI-1.0 smoke test |
| Existing users see mono for a moment before preferences load | Accepted (E8); checked in Stage 5 acceptance |
| The manual upgrade check overwrites the developer's real preferences | Temp `HOME` plus a before/after checksum of the real file (Stage 5) |
| The main bar adds a row above the editor when the sidebar is shown | It uses `--title-bar-height`, the sidebar strip's height, so the top edges align; the lost editor height is judged at Stage 4 sign-off |
| Enter in the Discard confirmation discards unsaved edits until Stage 4 lands | Accepted in DR8. WI-4.6's regression test fails on today's dialog |
| A failed save looks like "Saved" and disappears after 3 seconds until Stage 4 lands | Accepted in DR9. WI-4.13's save-failure regression test fails on today's store |
| A later info toast replaces an error toast before it is read | Accepted: rule 32 allows one toast at a time, and each failure path also logs its own `fail` event |
| The drop target stays visible if Tauri never sends `leave`, for example when a drag is cancelled | WI-4.12 also clears the target on `drop` and on window blur; checked by hand in `pnpm tauri dev` |
| Re-opening or dropping an open file discards its unsaved edits until Stage 4 lands | Accepted in DR6. WI-4.11 runs first in Stage 4, and its regression test fails on today's open path |
| Enter in the external-change dialog discards unsaved edits until Stage 4 lands | Accepted in DR5. WI-4.10's regression test fails on today's dialog, and rule 60 treats the path as a blocker for any earlier release |
| Not mounting an editor with no document breaks the launch view-mode effect or the first Milkdown mount | WI-4.9 preflight reads both paths; a component test opens a document after the empty state and asserts the editor mounts |
| Word count stalls typing on large files | Pure util off the keystroke path with a debounce; checked against a file near the 10MB limit (WI-4.8) |
| Typing after Reload or an image drop in WYSIWYG writes the old text back, and ⌘S saves it, until Stage 4 lands | Accepted in DR11. WI-4.14 runs right after WI-4.11, and its regression test fails on today's editor |
| Pushing outside text into Milkdown marks a reloaded document modified or rewrites its Markdown | WI-4.14 tests that `isModified` stays false after Reload and that the editor's own write-back causes no push |
| Re-throwing open failures shows errors that launch opens used to hide | One toast per batch, with the count; raw messages go to the log only (WI-4.13) |
| A narrow threshold drifts as labels or values change, and a field clips instead of hiding | Thresholds come from the widest realistic values and live in one partial; the 400×640 and 959px screenshots are retaken at each Stage 4 stop (DR16) |
| In a narrow window VoiceOver no longer reads the hidden status fields | Accepted in DR16: they return when the window widens, and the cursor position always stays |
