# D50 spec r2: changes from r1

Each finding of the r1 plan review (merged verdict `~/.mdpro-redesign/herdr-spike/delegator/D50-spec-r1-plan-verdict.md`;
gpt-auditor `D50-spec-r1-plan.md`, opus-auditor `D50-spec-r1-plan.md`), and where r2 resolves it. "Spec" is `spec.md`,
and the section names are its headings.

| Finding | Sources | Resolved in r2 |
|---|---|---|
| **Chord change** | user, after X5 | Ctrl+Shift+F becomes Ctrl+Shift+1 everywhere: spec Problem, Solution and Stories 1–5, 8–10, 12, 17–18; T-01 and T-02; ADR-0158 title, Decision 1 and Options |
| **X1**: a Windows-only secondary needs a builder change, the hook needs a Windows secondary that logs the pressed chord, and the Linux = Windows tests need named replacements | gpt F1, opus H4, M4 | Spec Implementation Decisions: "row builder learns a three-platform value", "two table invariants are narrowed", "the keydown hook". The replacement tests are named in Testing Decisions Seam 1: `tests/command-table.test.ts:241` becomes an exact exception list (`["view.sidebar"]`), `:187` adds `view.sidebar/windows` only, plus `:79`, `:160` and `tests/support/bindingV2Defaults.ts`. T-01 AC-1 and AC-2 |
| **X2**: the migration map and Rust host default are one off-Mac cfg arm, untestable for Windows on any CI host | gpt F2, opus H1, M5 | Spec Implementation Decisions: "Rust host defaults become platform-valued", "v1→v2 migration becomes platform-valued" (the plan carries its platform, and the Windows map is the off-Mac map plus one new entry, so no existing entry is edited), "applied-shortcuts resolution". Seam 3 runs every Windows case on any host; the host-only parity test becomes a check over all three platforms. T-01 AC-5 |
| **X3**: the device AC covers neither both editors nor non-editor focus | gpt F3 | Spec Testing Decisions, Device "Presses (config A)"; T-02 AC-3: WYSIWYG editor, Source editor, non-editor focus, each one toggle, one log, no other action, unchanged bytes. The unit half is T-01 AC-3 (composed editors) |
| **X4**: win-desktop's config is v2-stamped with Ctrl+Shift+L, so the device AC fails on correct code | opus H2 | Spec Device "Starting config": a snapshot, then config A (v2, sidebar field removed: the fresh-install path) and config B (v1 with the v1 default: the real migration), with stamps and values recorded and the snapshot restored. T-02 AC-1, AC-5, AC-6 |
| **X5**: Ctrl+Shift+F may be Microsoft Pinyin's Simplified/Traditional hotkey | opus H3 | Resolved by the chord change. IME evidence is recorded in spec Problem and Further Notes, ADR-0158 Context and Options. The device AC records HKL, input method and input-language hotkeys (T-02 AC-1). WeType's residual risk is in ADR-0158 Consequences |
| **Windows native menu ignores the layout** (`specs_for_app` returns `None` off-Mac; a literal `CmdOrCtrl+Shift+L`) | delegator brief; gpt CHECKS; opus H4 | Spec Implementation Decisions, "Windows native menu takes the chord from the table". The accelerator comes from the layout's v2 primary for the platform and is spelled `CmdOrCtrl`, because the menu library reads `Cmd` as the Windows key off-Mac (checked in muda 0.20.0, `accelerator/mod.rs:251-256`). Seam 3 and T-01 AC-5 test the exact string and the Windows/Linux tree baselines |
| **AZERTY**: Ctrl+Shift+& reaches Heading 1 through the relaxed pass, so an exact Ctrl+Shift+1 would win | delegator brief, from the candidate study | Checked by reading the code, not by running it. The premise does not hold inside the editors: CodeMirror's and ProseMirror's keymaps look the chord up without Shift and run `Mod-1` first, and the hook skips a consumed keydown. Decided behaviour: Heading 1 in both editors, the sidebar outside them (spec "Editor keymaps keep their precedence"; Story 13; T-01 AC-3; ADR-0158 Decision 2). The trade-off is listed under Further Notes, "Open for the user" |
| **M (Reset at the TS seam)** | gpt M1, opus M2 | Reset moves to Seam 1 (`resetDefaults` per platform and version). T-01 AC-4 |
| **M (T-02 negative needs a passing control)** | gpt M2 | T-02 AC-4: the Ctrl+Shift+L negative stands on AC-3's Ctrl+Shift+1 presses and the Ctrl+Shift+N control, same route, same run. It is conditional on the AC-2 probe result |
| **M (semantic-find plan proposes Ctrl+Shift+F)** | gpt M3 | No collision remains with Ctrl+Shift+1. T-01 AC-6 adds the IME note to the plan's S-U6. Spec Out of Scope; ADR-0158 Options |
| **M (ADR-0114 partially superseded)** | opus M1 | ADR-0158 Status line; spec Further Notes, "Supersession" |
| **M ("real press", interactive task)** | opus M3 | Spec Device "Terms"; T-02 "What to build" |
| **M4 (relaxed invariants)** | opus M4 | Folded into X1 |
| **M5 (no existing map entry)** | opus M5 | Folded into X2: "one new entry", and the Linux map is not edited |
| **H4 (platform-collapse sites)** | opus H4 | The launch conflict notice reads the Windows-aware platform (spec Implementation Decisions; T-01 AC-4). The other `"linux"` sites stay unchanged, because the `:241` exception list proves their fields are equal on Windows and Linux |
| **H4 (M1b device chord input not in scope)** | opus H4 | T-01 AC-6: two rows, header, and the row-count test goes from 74 to 76 |
| **L1 (manifest column label)** | opus L1 | `manifest.md` column renamed "File SHA-256" |
| **L2 (stale ADR draft pointer)** | opus L2 | Spec cites ADR-0158 |
| **L3 ("Owned elsewhere" too narrow)** | opus L3 | Proposed GLOSSARY edit (delegator, scratchpad `d50-r2-glossary.md`), cited in spec Further Notes, "Terms" |
| **L4 (ADR options: inverse arrangement, WebView2, the named host)** | opus L4 | ADR-0158 Options lists the inverse arrangement and names Chrome for W. WebView2 stays a device question, under T-02 AC-3 |

## Other changes
- Stories 11 (conflict notice), 12 (fresh install), 13 (AZERTY) and 21 (Windows values testable on any host) are new.
  r1 stories 11–17 are r2 stories 14–20, and r1 story 18 is r2 story 22.
- Out of Scope adds: the off-Mac menu showing custom chords, the hard-coded F6, the unchanged collapse sites, and Typora's
  open-on-Outline behaviour.
- The seams are still three unit seams plus the device AC, but two have moved. Seam 1 now includes Settings, and Seam 3
  covers all the platform-valued Rust values. The r2 approval covers this, which r1's 「对的」 did not.
