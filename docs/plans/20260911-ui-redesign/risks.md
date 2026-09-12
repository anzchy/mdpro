# UI redesign plan — Risks

Part of [the UI redesign plan](../20260911-plan-ui-redesign.md), which holds the sources of truth, decisions, open questions, acceptance criteria and tasks.

## Risks

Each mitigation names the decision or work item that owns it (E24). A mitigation that has no evidence behind it yet is marked **proposed** and stays that way until the evidence exists.

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
| No keyboard behavior is covered anywhere in the suite | E28 corrects the earlier framing: Testing Library's absence never made keyboard testing impossible, because native `dispatchEvent` was always available — the fact is that the suite dispatches **no keyboard event anywhere**. The devDependencies land in WI-0.0 and are pinned by its seeded `.test.tsx` and the WI-1.0 smoke test |
| Existing users see mono for a moment before preferences load | Accepted (E8); checked in Stage 5 acceptance |
| The manual upgrade check overwrites the developer's real preferences | Temp `HOME` plus a before/after checksum of the real file (Stage 5) |
| The main bar adds a row above the editor when the sidebar is shown | It uses `--title-bar-height`, the sidebar strip's height, so the top edges align; the lost editor height is judged at Stage 4 sign-off |
| Enter in the Discard confirmation discards unsaved edits until Stage 4 lands | Accepted in DR8. WI-4.6's regression test fails on today's dialog |
| A failed save looks like "Saved" and disappears after 3 seconds until Stage 4 lands | Accepted in DR9. WI-4.13's save-failure regression test fails on today's store |
| A later info toast replaces an error toast before it is read | Accepted: rule 32 allows one toast at a time, and each failure path also logs its own `fail` event |
| The drop target stays visible if Tauri never sends `leave`, for example when a drag is cancelled with Esc | Clearing on `drop` and window blur is **not sufficient** (E13): an Esc cancel does not blur the window. WI-4.12 adds a capture-phase `Escape` listener mounted only while the target is shown. A cancel followed by inactivity can still strand it, so a real Esc-cancel check in `pnpm tauri dev` is an **acceptance gate**, not an assumption note |
| Re-opening or dropping an open file discards its unsaved edits until Stage 4 lands | Accepted in DR6. WI-4.11 runs first in Stage 4, and its regression test fails on today's open path |
| Enter in the external-change dialog discards unsaved edits until Stage 4 lands | Accepted in DR5. WI-4.10's regression test fails on today's dialog, and rule 60 treats the path as a blocker for any earlier release |
| Not mounting an editor with no document breaks the launch view-mode effect or the first Milkdown mount | WI-4.9 preflight reads both paths; a component test opens a document after the empty state and asserts the editor mounts |
| Word count stalls typing on large files | Pure util off the keystroke path with a debounce; checked against a file near the 10MB limit (WI-4.8) |
| Typing after Reload or an image drop in WYSIWYG writes the old text back, and ⌘S saves it, until Stage 4 lands | Accepted in DR11. WI-4.14 runs right after WI-4.11, and its regression test fails on today's editor |
| Pushing outside text into Milkdown marks a reloaded document modified or rewrites its Markdown | WI-4.14 tests that `isModified` stays false after Reload and that the editor's own write-back causes no push |
| Re-throwing open failures shows errors that launch opens used to hide | One toast per batch, with the count; raw messages go to the log only (WI-4.13) |
| A narrow threshold drifts as labels or values change, and a field clips instead of hiding | Thresholds come from the widest realistic values and live in one partial; the 400×640 and 959px screenshots are retaken at each Stage 4 stop (DR16) |
| In a narrow window VoiceOver no longer reads the hidden status fields | Accepted in DR16: they return when the window widens, and the cursor position always stays |
| Typing and then reloading inside 200 ms writes the pre-reload text back over the reloaded file | E9: the plugin-listener debounce is replaced by an owned observer; a push cancels the pending write-back. Fake-timer test: type, push inside 200 ms, advance, assert the store holds the pushed text and `isModified` is false |
| Typing and then pressing ⌘S inside 200 ms saves stale content, because the save reads the store | E9: the write-back is flushed synchronously before every dirty read, and the save re-reads `getState()` after the flush |
| ⌘Z after a Reload restores the stale pre-reload text and schedules a write-back | E9: fresh-open sources use `replaceAll(md, true)`, which resets history instead of dispatching an undoable replace |
| The drop-target listener leaks when the component unmounts before registration resolves (C5) | E19: WI-4.12 registers through the WI-4.19 cancellation-safe primitive rather than its own `await` |
| Selecting Source mode fails to persist and shows "Failed to save preferences" on every switch | E21: Rust gains a `Source` variant plus the fields TS already declares. Round-trip test per enum value, from the TS literal through Rust and back |
| A rapid external change is lost because the watcher drops it rather than deferring it | E18: `file_watcher.rs:113-123` retains and delivers the trailing event, preserving rename and delete information |
| Mutation testing reports a healthy score while the code holding the known bugs is out of scope | E29: four bug-holding files are excluded explicitly at `stryker.config.json:14-21`, and `App.tsx` is excluded **structurally**, because `mutate: ["src/**/*.ts"]` never matches a `.tsx` file (40 files, 36.4% of source). Stryker is also wired to no script and no workflow. It is scoped to an explicit allowlist and run only after those modules have behavior tests; E11's test-**selection** audit still applies |
| A new regression test is written as `.test.tsx` and never runs | E11: `vitest.config.ts:6` widens to `.test.tsx` in the tooling PR, before any new test is written |
| An MCP tool call creates one document per open window, all sharing one UUID | E23: Rust resolves one destination and uses `emit_to` with a non-null label; the frontend guard compares a concrete label |
| A rejected `save_file` path logs nothing, so an attack or a bug is invisible | E20: `loggedOperation` logs Start before validation and exactly one terminal outcome |
| Moving to UUID ids makes reload or encoding reopen upsert a second entry for one file | E10: reload and encoding reopen carry the owner id forward; `file.rs:1408-1410` builds a fresh `Document` today |
| `App.tsx` keeps growing while the 300-line rule is treated as advisory | E22: the ratchet baselines the 19 existing production offenders and rejects unexplained growth; the lifecycle seam lands before the drop-target extraction |
| Every test is skipped on the merge path, so a regression lands green | E25: the `ci.yml` triggers are restored for pull requests and pushes to master, Linux-only, with `cargo-audit` split out of the test job (WI-0.0) |
| A threshold is set from a coverage number measured against the wrong denominator | E27: the corrected `include` lands first and all four metrics are re-read; no floor is carried across populations |
| A new `.test.tsx` and its setup file are never type-checked | E28: `tests/` is added to a tsconfig in the same PR that widens the Vitest include; a seeded `.test.tsx` proves both discovery and type checking |
| A source-text assertion passes while the behavior it names is broken, or fails on a rename that broke nothing | E26: assertions migrate to executable contracts in the same commit that changes the implementation they describe |
| The watcher fix passes a test that never exercises the deadline | E30: the coalescer takes injected time and is driven through `onDeadline(now)` with no further event, plus one real-watcher tempdir test |
| A `ViewMode` round trip passes because both sides share the same wrong representation | E30: each variant asserts its literal serialized value, and Rust and TS consume one shared JSON fixture |
| WI-4.14 passes in jsdom while real Milkdown still writes stale text back | E31: the acceptance sequence runs against real Milkdown in browser mode, and G0 is expanded so the suite cannot be skipped |
| E10, E12, E14 and E15 stay as index rows with nothing executing them | WI-4.23 (E10), WI-4.24 (E12) and WI-4.25 (E14) are work items with tasks T27–T29; E15's disposition is recorded at the end of stage-4b |
| The status strip is mounted into a tree where one store write re-renders everything, making every keystroke a full-tree render | E32: render isolation is a **prerequisite** of WI-4.8, expressed as an ownership contract and asserted by commit counts — not a companion optimization |
| The word count is debounced, and typing still stalls because the debounced task itself scans the whole document on the main thread | E33: the count is a derived scalar computed in a **worker**, tagged by document id and generation, with superseded results discarded. A `useMemo` and a derived selector are both rejected — equality suppresses the re-render, not the scan |
| Word-count work is layered on Milkdown's 200 ms listener debounce and coalesces nothing | E33: verified at `@milkdown/plugin-listener/lib/index.js:116-143` — `debounce(…, 200)` is constructed **inside** `apply`, so every transaction gets its own timer and every keystroke still runs a full `serializer(doc)`. No scheduler may depend on it; E9/WI-4.14's owned observer is the replacement |
| WI-4.22 relocates code but leaves the render topology unchanged, forcing a second split later | E35: the controller is not a hook called from App's render body; the item carries a render-ownership table naming an owner per subscription, and it lands before WI-4.8 as well as before WI-4.12. App also calls `useMcpSync` and `useTOC`, so moving `useDocument` alone is insufficient |
| An equal-length edit in an already-dirty document never syncs, and MCP tools silently read stale content | E37: `useMcpSync.ts:139` keys the change hash on `content.length`. WI-4.26 keys on a revision or digest, and no later scheduler may key on length |
| Typing discards the TOC collapse state the user set | E38: `tocStore.ts:86-88` clears `collapsedIds` and `activeEntryId` on every `setEntries`. WI-4.26 reconciles by heading identity |
| A performance gate is flaky on shared CI, gets disabled, and the plan ends with no perf coverage at all | E39: CI asserts only deterministic commit counts and task counts. FPS, heap and tight millisecond thresholds are **never** blocking; timing evidence lives in the browser-mode suite against named fixtures, and the budgets are targets to verify on a named machine, **not** measurements of today |
