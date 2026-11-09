## Parent

#733 (MIG-002 spec r1); row #702.

## What to build

**MIG-002d: row d (draft timer and recovery).**

Clauses (spec #733):
- d-C1: the draft timer writes the store's Markdown.
- d-C2: target, claim (ADR-0127) and revision ownership hold.
- d-C3: the source draft stays until a successful re-key.
- d-C4: recovery into an open tab flushes only that tab.
- d-C5: a stale recovery is refused.
- d-C6: no draft is written after close.

Plus row d's serializer-throws journey. Category l cases carry the draft bytes.

StrictMode clauses: d-C6. Reused suites to cite: `d146-recover-into-open-tab`, `d146-wi2-rekey-delete-audit`, `d241-recovery-waits`, `d151-rekey-keeps-existing-draft`, `draft-recovery-outcome`, `draft-service`, `draft-command-contract`, `d291-recovery-*`. Likely MIG-005 host sites at 7bb42efb: none direct; confirm by grep.

Corpus categories: a, l. Each journey cites its case-ids.

## Acceptance criteria

- [ ] The card `docs/test/cards/MIG002-d.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It covers: type, wait for the draft interval, then force-quit and recover; recover over newer content is refused; a closed document leaves no draft.
- [ ] The PR lands with a waiver that quotes the user's ruling and names the single M0 Mac batch run at the SHA after the last MIG-002 sub-PR lands.

## Shared acceptance criteria (every MIG-002 ticket)

- [ ] Every clause listed above has at least one passing App journey and at least one negative journey, and its existing suites are cited by name in the handoff. No existing suite is moved or rewritten.
- [ ] Every distinct guarded path has one temporary-mutation receipt `MIG002-<row>-<clause>-<n>`, recorded by MIG-001's procedure. The handoff has the mutation diff, the failing assertion and the restore, and lists "replay passes at base" under Known qualifications.
- [ ] Each journey asserts the document id, the expected delta of every token its clause touches through `readTokens`, "unchanged" for the rest, the write log's bytes and order, and that no `failed` flush is reported as success.
- [ ] Documents are opened by MIG-001 case-id. An unedited write is byte-equal to the case's untouched bytes; an edited write equals bytes the journey states.
- [ ] The StrictMode clauses listed above run with StrictMode on.
- [ ] Unsafe current behaviour is pinned and named by a known-limitation record (`<row>-KL<n>`: clause, current, desired, reason, ref), and is sent to the delegator as a finding. No `ref: pending` remains at landing. No production fix is made.
- [ ] Nothing under `src/` changes, apart from receipt mutations that are restored. A clause that can't be observed without a production seam becomes a known limitation and a finding.
- [ ] The harness and the boundary change only by addition (after a1), and a1's harness tests and the corpus suite stay green.
- [ ] Each journey takes under 5 s under coverage and each file under 60 s. The handoff reports this row's times and the MIG-002 running total against the 5-minute ceiling.
- [ ] No feature-ledger change, unless a known limitation proves a `Shipped` row false; that row then becomes `Partial` + `限制：` in the same commit.
- [ ] The handoff names this row's MIG-005 host sites from `git grep -n 'getEditor()' src` at its base.
- [ ] Journeys are in `tests/state-safety/<row>-<slug>.journey.test.tsx` and follow rule 10's placement rules.

## Blocked by

#735 (MIG-002a1), #717 (MIG-001l)
