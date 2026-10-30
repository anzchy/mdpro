# D50 spec snapshot r2 (2026-10-31)

A frozen copy of the issue bodies for the user to approve (rule 12, ADR-0148). r2 revises r1 after r1's plan review: the
merged verdict was NOT READY, with X1–X5 plus Mediums. `changes-from-r1.md` maps each finding to where it is resolved.
Any later normative edit to an issue below is `r3`, which needs re-approval and a plan review of its diff against this
revision.

| File | Issue | File SHA-256 |
|---|---|---|
| `spec.md` | [#553](https://github.com/anzchy/mdpro/issues/553) | `ae43c1d78e3c266394483b8a09b419713f317bdb7aa9de2f095aeb34b49759e6` |
| `tickets/T-01.md` | [#554](https://github.com/anzchy/mdpro/issues/554) | `34a88ae533ce32abd6c9fce9328c9ff355e7c012f58153f1bf96769ddcb5a35d` |
| `tickets/T-02.md` | [#555](https://github.com/anzchy/mdpro/issues/555) | `3d9f01113691bc0f0d09e497d904ee1193d621b704e94be30924298538e8c1ea` |

## Approval words
- r1 (user, 2026-10-30):
  - route: 「New Windows default (gated)」;
  - grill: 「全部同意」 (Q1–Q6, `~/.mdpro-redesign/planner/D50/grill.md`);
  - seams: 「对的」;
  - ticket breakdown: 「1.yes 2.yes 3. no」;
  - release: 「Fix in 0.3.6」.
- After r1's plan review (user, 2026-10-30/31):
  - on X5: 「Probe the IME first (Recommended)」;
  - after the IME probe: 「Pick a different chord (Recommended)」. Ctrl+Shift+F is dropped: Microsoft Pinyin binds it to
    its Simplified/Traditional switch on win-desktop, and Sogou does the same by default;
  - on the chord: 「Ctrl+Shift+1 (Recommended)」. The Windows v2 primary is Ctrl+Shift+1, Ctrl+Shift+L stays the
    secondary, macOS keeps ⌘⇧L and Linux keeps Ctrl+Shift+L.
- r2 approval (user, 2026-10-31): first 「Show me the spec first」, then, after reading it, 「Approve r2 (Recommended)」.
  It covers Ctrl+Shift+1 on Windows, AZERTY Heading 1 kept inside the editors (spec Further Notes, "Open for the
  user", accepted as written), the Ctrl+Shift+L secondary independent of the primary, the off-Mac menu showing
  defaults, and the widened seams.

## Blocking edges
- T-01 (#554): none.
- T-02 (#555): T-01, as a native GitHub dependency; D336–D338, the Windows driver fix (sequencing rows), named in the body.

## Open for the user
- AZERTY, recorded in spec Further Notes: inside the editors, Ctrl+Shift+& stays Heading 1 and does not toggle the
  sidebar. Recommended: accept.

## Related
- ADR-0158 (Proposed, revised for r2): the per-platform default, the options considered, and the partial supersession of
  ADR-0114 Decisions 1 and 2.
- Terms: `GLOSSARY.md` § Keyboard shortcuts, with an "Owned elsewhere" edit proposed for r2.
- Evidence:
  - `~/.mdpro-redesign/device/D50-probe-report.md` (P1 lastError 1409);
  - `~/.mdpro-redesign/device/D50-ime-probe-report.md` (classification B);
  - `~/.mdpro-redesign/device/D50-chord-candidates.md`.
- The r1 plan review:
  - `~/.mdpro-redesign/herdr-spike/delegator/D50-spec-r1-plan-verdict.md`;
  - `~/.mdpro-redesign/herdr-spike/gpt-auditor/D50-spec-r1-plan.md`;
  - `~/.mdpro-redesign/herdr-spike/opus-auditor/D50-spec-r1-plan.md`.

The hashes are of the committed files. The issue bodies are these files, and GitHub may normalise the trailing newline.
