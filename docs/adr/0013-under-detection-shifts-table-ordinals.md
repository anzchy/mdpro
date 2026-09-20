# 0013. Under-detection shifts table ordinals: withdraw ADR-0009's harmlessness claim

## Status

Accepted — 2026-09-18

Supersedes **ADR-0009's "What is deliberately not decided here" paragraph in
part**: the sentence *"It cannot cause a bad write (you cannot edit a table you
never enumerated)"* only. ADR-0009's Decision points 1–3, its Context and its
Consequences stand unchanged; that fix was correct and is not reopened.
[ADR-0009](./0009-narrow-source-table-detection-to-gfm.md) is not edited beyond a
dated forward pointer in its Status — it remains the record of why the earlier
reasoning looked right at the time.

## Context

ADR-0009 narrowed Source-mode *over*-detection on three shapes and recorded
*under*-detection as the larger remaining half: GFM interrupts a paragraph with a
table, mdpro does not (positional agreement 44/74 after the fix). It declined to
fix that half, on an explicit premise — you cannot edit a table you never
enumerated, so a miss cannot cause a bad write.

The premise holds for the table that is missed. It does not hold for the tables
**after** it, because MCP and HTTP table actions address tables by **ordinal**,
and a miss renumbers every table that follows.

Reproduced against the shipped code, read-only, 2026-09-18 — the
`NARROW-underdetection-remains` U1 fixture with an ordinary table appended:

```
const doc =
  "| b0 | b1 |\n| h0 | h1 | h2 |\n| :-- | :-: | :-- |\n| r0 | r1 | r2 |\n" +
  "\n| c0 | c1 |\n| --- | --- |\n| v0 | v1 |\n";

GFM                -> 2 tables; table 0 starts at offset 12
findAllTables(doc) -> 1 table;  tables[0] starts at offset 67
```

`applyMcpTableAction` takes the caller's ordinal straight off the payload —
`const table = tables[tableIndex]`, `src/utils/tableMcp.ts:202`. A client that
counts as GFM counts and asks for `delete_row({ tableIndex: 0, index: 0 })` means
the first table; mdpro deletes the **second** table's header row.
`guardTableWrite` does not object, because the wrongly targeted table is
structurally valid — the guard checks the shape of what it writes, not whether it
is the table the caller meant. And per ADR-0009's own final Consequence, the Rust
layer has already returned `202` at `http_server.rs:834` before the frontend
applies anything, so the caller is told it succeeded.

This is the failure mode ADR-0009 itself rated **BLOCK** — data loss plus silent
failure — arrived at from the other direction. A phantom shifts every later
ordinal by +1; a miss shifts it by −1. ADR-0009 measured the phantom direction
and reasoned about the miss direction, and the reasoning did not survive being
measured.

## Decision

1. **Withdraw the harmlessness claim.** Under-detection is a write-safety defect,
   not a read-only annoyance. Nothing in the tree may cite ADR-0009 as authority
   for the proposition that a missed table is write-safe.
2. **Pin the defect; do not fix it in this record.** The two-table ordinal-shift
   case goes into `tests/table-gfm-narrowing.test.ts` asserting the **wrong**
   current behaviour, by the same device ADR-0009 used for
   `NARROW-underdetection-remains`: the day identity is fixed, the test fails and
   is rewritten deliberately rather than drifting green.
3. **The fix is table identity, not another detector patch.** Closing the
   remaining 30/74 positional gap would narrow the window, not shut it — any
   residual disagreement reproduces this bug. The defect is that a
   position-addressed operation is carried over an ordinal that two parsers
   compute independently. A real fix makes the client, the renderer and the
   editor agree on which table is table N — stable identity, or operations
   addressed by offset rather than ordinal. That crosses the HTTP/MCP contract
   and needs its own plan and ADR.
4. **This is an accepted known defect, not an unknown one.** It ships. The cost
   is recorded below rather than discovered by a user.

## Consequences

- **mdpro ships a silent wrong-target write path.** Any MCP or HTTP table action
  against a document that contains a paragraph-interrupting table before the
  intended one will hit the wrong table and report success. How often that shape
  occurs in real documents is **unmeasured**: the corpus records that 30/74
  documents disagree positionally, not how many of those have a further table
  after the disagreement. Naming the exposure without sizing it is the honest
  state, and sizing it is the first thing the follow-up plan should do.
- **Rule 60 is knowingly violated, with a receipt.** Rule 60 lists silent
  failure and data loss as BLOCK. This record is the explicit exception; without
  it, the next reviewer is entitled to treat the path as an unreviewed bug.
- **The pinned test locks in behaviour we know is wrong.** It will read as an
  endorsement to anyone who skims it. Its comment must say it is a defect
  receipt, and whoever fixes identity has to rewrite it rather than delete it.
- **What this forecloses.** mdpro cannot claim GFM parity, and cannot claim the
  MCP/HTTP table surface is safe against arbitrary documents, until identity is
  fixed. Any future row in `docs/feature-ledger.md` describing table editing as
  `Shipped` without a `限制：` contradicts this record.
- **What would reopen it.** A measured frequency high enough to make the defect
  routine rather than edge-case, or a second caller of the ordinal path, should
  promote the identity work ahead of whatever is queued.
- **The `202`-before-apply contract is still unowned.** ADR-0009 flagged it and
  this record does not fix it either. It is now load-bearing for two separate
  defects, which is itself an argument for giving it an owner.
