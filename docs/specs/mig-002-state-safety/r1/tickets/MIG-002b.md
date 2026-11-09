## Parent

#733 (MIG-002 spec r1); row #702.

## What to build

**MIG-002b: row b (tab and view-mode switch).**

Clauses (spec #733):
- b-C1: a tab switch reads the state after the flush.
- b-C2: a quick WYSIWYG → Source → WYSIWYG keeps every edit, with undo and selection pinned.
- b-C3: when the outgoing document's flush fails, both stores refuse the switch and neither changes.
- b-C4: a failed flush in an unrelated document doesn't refuse the switch.
- b-C5: targeted and aggregate results stay distinct (ADR-0071).
- b-C6: the scroll anchor is captured and restored across a mode switch.
- b-C7: a switch during IME composition is pinned.

Plus row b's serializer-throws journey.

StrictMode clauses: b-C2, b-C6. Reused suites to cite: `d92-*`, `d95-flush-refusal-scope`, `d95-*open-activation`, `d97-tab-close-after-failed-flush`, `d255-switch-documents`, `wysiwyg-flush-sites`. Likely MIG-005 host sites at 7bb42efb: `scrollAnchor/capture`, `editorStore`, `milkdownFocusCarry`, `focusActiveEditor`; confirm by grep.

Corpus categories: a, g, h, n. Each journey cites its case-ids.

## Acceptance criteria

- [ ] The card `docs/test/cards/MIG002-b.md` is written in the ADR-0144 format (model: `D326-identity-check.md`), with steps tagged `cli`, `computer-use` or `human`, each with its proof, a failure condition, and a log line plus effect. It covers: a tab switch immediately after typing; a WYSIWYG → Source → WYSIWYG round trip with undo; a refused switch after a failed flush (if reproducible on device, otherwise `cli` log evidence); **scroll-anchor retention across a mode switch** (carried from MIG-001n, ADR-0144); a switch during a Pinyin composition.
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

#735 (MIG-002a1), #712 (MIG-001g), #713 (MIG-001h), #719 (MIG-001n)
