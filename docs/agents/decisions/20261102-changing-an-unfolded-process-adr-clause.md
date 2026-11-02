# 2026-11-02: Changing a process ADR clause that is not yet folded in

- **Decided:** 2026-11-02, by the user: 「Change = fold it in (Recommended)」.
- **Decision:** A change to a clause of a process ADR (ADR-0164 or earlier) that is not yet folded into a rule is made
  by folding it in: the change moves the clause into its rule, and a decision-log entry records the new decision, with
  both auditors' plan review when that entry is [gate-sensitive](README.md#gate-sensitive-entries). The old ADR gains the
  dated Status line "Current text: `<rule>#<anchor>`; folded and changed by `docs/agents/decisions/<file>`", naming
  that entry; no new ADR is written. A clause moved unchanged keeps ADR-0165's "Current text: `<rule>#<anchor>`; folded
  by ADR-0165".
- **changes:** `CLAUDE.md` § Architecture Decision Records, the "An accepted ADR's body is immutable" and "Existing
  records" bullets.
- **supersedes:** for process ADRs ADR-0001…ADR-0164 only,
  [ADR-0165](../../adr/0165-adrs-record-architecture-and-product-decisions-only.md) decision 4's "Reversing or replacing
  a decision still takes a new ADR", and decision 5's move-only reading of a fold-in ("a move is not a change of
  mind"). Decision 4's sentence still binds repository-wide ADRs, and a clause moved unchanged still takes decision
  5's line.
- **gate-sensitive:** yes, by the delegator's classification under "doubt means review": it decides how rule
  clauses change, gate clauses included (herdr-delegator, 2026-11-02).
