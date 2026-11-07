# 2026-11-07: Windows is preserved inside the Tiptap migration; no new Windows features

- **Decided:** by the user, in three steps.
  - 2026-11-06: 「Skip all windows related feature, 接下来所有的精力专注于MacOS平台相关功能」.
  - 2026-11-07: 「20261107-mdpro_tiptap_windows_plan_v1-1.md，这是更新之后的Plan，考虑了Windows相关部分迁移，重新让两个model评估一下，特别是更新部分」.
  - 2026-11-07, choosing this record's kind: 「decision log only.Windows 相关决定，以 v1.3 Plan 为主」.
- **Decision:** inside the Milkdown → Tiptap migration, Windows work is limited to preserving its verified behaviour and
  adding no data-safety risk. Its scope, order and gates are those of
  [`docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md`](../../plans/20261107-mdpro_tiptap_windows_plan_v1-3.md)
  (§0A, WIN-000…WIN-006, §15). New Windows features and polish stay paused, and work outside the migration stays
  macOS-only, as 2026-11-06 said.
- **Why:** the 2026-11-06 instruction stopped Windows feature work. The migration replaces the shared editor that the
  Windows build also runs, so a Windows build left untested would lose verified behaviour silently. The 2026-11-07
  plan therefore brings Windows back for preservation only. The user named v1.3 as the authority for Windows
  decisions, which closes PL-1 of the v1.0 review and TP-6 of the v1.1 review.
- **Costs:** Windows needs device batches (WIN-B2/B3/B4, WIN-005) on the one `win-desktop`, run by the same
  `gpt-auditor` that audits every PR, and #582 is still open. The macOS cutover does not wait for them (v1.3 §15).
- **Why not an ADR:** the user chose a log entry. ADR-0164 D4 (Windows ships again only after #582 exits) is kept, so
  no release control changes; publishing a Windows Preview before #582 would still need an ADR that supersedes D4.
- **changes:** none (a ruling; the plan carries the detail).
- **supersedes:** the 2026-11-06 instruction, only for Windows preservation work inside the migration.
- **gate-sensitive:** no. It changes no landing or CI condition, auditor set, receipt contract, release control or
  user-data control, and ADR-0164 D4 stands. Classified by herdr-delegator, 2026-11-07, as the user chose.
