# Escapes

Every defect found on a device, or after landing, in code that had passed an
audit ([ADR-0121](../adr/0121-audit-effort-follows-risk-pre-existing-findings-do-not-block-and-auditors-are-measured.md)
Decision 6). The delegator is the only writer, and reconciles this file with
each batch of device-check records.

This is the replay set. Before an auditor's model, its agent definition or its
request template changes, the current and the proposed auditor both run on
each escape's audited range at its pre-fix SHA, with the fix and every later
report withheld. An escape counts as caught when a finding names the same file
and the same fault. Below five rows the result is "insufficient evidence", and
the user decides without the numbers.

- **Audited range**: `base..head` as audited, from `audit-log.md`.
- **Found**: device record, user report or a later audit, with date.
- **Fault**: file:line and one sentence. It is what a replay must name to count as caught.
- **Fix**: the D row whose fix confirms the defect.

| # | Audited range | PR | Found | Fault | Fix (D row) |
|---|---|---|---|---|---|
