# 0089. The feature ledger records Windows state in a per-area difference table, not a second state column

**Status**: Accepted (2026-10-13). Decided by the user, answering the delegator's three-option question on the ledger layout: 「C Part 1 保持 macOS，另加「Windows 差异」表」. Recorded by mdpro-delegator. Implementation is [D191](../plans/20260912-frontend-backend-sequencing-order.md#d191).

## Context

`docs/feature-ledger.md` Part 1 has one `状态` cell per capability, and since
the ledger was first written (2026-09-17) that cell has meant the macOS build:
the only target the project shipped. On 2026-10-12 the user installed 0.3.1 on
a Windows 11 desktop and two audits
([`docs/feature-ledger-windows-audit-claude.md`](../feature-ledger-windows-audit-claude.md),
landed `54d33c9`) walked all 180 rows there: 49 pass, 13 Windows-only
failures, 10 not applicable, 62 not verified, 1 ledger error. Those results
live in a separate dated document, so a reader of the ledger cannot see that
「保存」 is Shipped on macOS and broken on Windows without opening a second file
and matching rows by position.

Forces, as understood at the time:

- The ledger's contract is machine-checked (`pnpm ledger:check`): the
  inventory table is recognised only by its exact four-column header, the
  state enum is closed, `Partial` must carry `限制：`, `Absent` ⇔ `—` in 在哪.
  Any layout change is a change to `scripts/ledger/parse.mjs` and its tests.
- The ledger refuses implicit claims (`Unknown` exists so that a row can say
  "never tested here"). A layout that lets a Windows state be *inferred* from
  silence works against that.
- Rows have no ids; the Windows audit numbered them 001–180 by position, which
  breaks on the next insertion.
- Windows is a secondary target with its own open defect list (D190); its
  column will churn for weeks while macOS rows stay still.

## Options considered

- **A. Two state columns** (`| 能力 | macOS | Windows | 在哪 | 怎么确认 |`), the
  same enum plus `N/A` in the Windows column, Windows limits written as
  `Windows 限制：` in 怎么确认. Most direct, two badges per row in the HTML.
  Lost: every one of the 182 rows is rewritten and widened for a secondary
  target, the audit's 62 unverified rows become 62 `Unknown` cells in the main
  table, and the header change invalidates the parser's only recognition rule
  for every tool and reader that knows the four-column shape.
- **B. One column with a platform token in the cell** (`Shipped · Win: Partial`,
  no token = same as macOS). Smallest diff. Lost: "no token means the same"
  is exactly the implicit claim the ledger exists to refuse, and the cell
  grammar becomes a second enum nobody can read at a glance.
- **C. Part 1 stays macOS; each area gets a `#### Windows 差异` table**
  (`| 能力 | Windows | 说明 |`) listing only rows whose Windows state differs
  from macOS or is unverified. Part 1 is untouched; Windows churn stays in its
  own tables; the gate checks that every 能力 in a difference table names a
  row of the inventory table above it. Lost: a reader cross-references two
  tables, and matching is by capability text, so a rename must touch both.
  **Chosen.**

## Decision

Part 1's `状态` column is defined as the macOS state. After each area's
inventory table, a `#### Windows 差异` table with the header
`| 能力 | Windows | 说明 |` lists every capability whose Windows state differs
from its macOS state **or has not been verified on Windows**. The `Windows`
cell uses the ledger's five words plus `N/A` (the capability has no Windows
counterpart, e.g. Finder association). A capability absent from the
difference table claims: same state as macOS, **and** verified on Windows.
That claim is deliberate and is the one cost of option C over `Unknown`
everywhere; the first fill therefore lists all 62 unverified rows as
`Unknown` rather than omitting them.

`pnpm ledger:check` gains three checks: every 能力 in a difference table
matches exactly one row of the inventory table immediately above it; every
`Windows` cell is in the enum plus `N/A`; a `Partial` Windows cell has a
non-empty 说明. `pnpm ledger:build` renders the Windows cell as a chip with
the same colours as the macOS badges.

The commit that changes a Windows behaviour (each D190 WI) rewrites the
difference row in the same commit, as Part 1 rows already require.

## Consequences

- Readers see both platforms in one document and one scroll, at the price of
  reading two tables per area.
- Capability text becomes a key. Renaming a row without its difference row
  is a gate failure, not a silent drift, but the rename now costs two edits.
- Silence in a difference table is a claim. A future audit that finds a
  Windows difference on a row that was omitted has found a ledger error, to be
  fixed in the row and recorded in the audit pass.
- Adding a third platform (Linux) repeats the pattern as `#### Linux 差异`
  rather than reopening the column question; if two platforms ever diverge
  on most rows, this ADR should be superseded by option A.
- Position-numbered audits (001–180) remain a dated record and are not
  linked from the difference tables.
