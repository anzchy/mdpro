# 0015. TOC staleness is closed by cancellation, not by a revision number

## Status

Accepted — 2026-09-19

## Context

Plan M (`docs/plans/20260912-plan-markdown-source-consolidation.md`) lays down three
red lines for the migration. The third reads:

> 异步结果必须携带文档 ID 与修订号，过期结果不得覆盖新内容。

The outline (TOC) path is the one this was aimed at. A survey on 2026-09-13
(plan M `:603-621`) found the hazard shape absent — parsing was synchronous, the
repo held zero revision guards — and converted the red line from an **entry**
measurement into a **step-3 exit condition**, to be discharged in whatever commit
first makes parsing genuinely asynchronous. That conversion was right: the original
wording demanded a measurement of a danger that only step 3 creates, which no one
can take before step 3.

Two work items have since moved the ground under it, and the survey's own wording
is now partly wrong.

**What is true today, measured 2026-09-19:**

- Parsing is still fully synchronous. `parseHeadingsFromContent(content)` is a pure
  function; there is no Worker, no IPC, no promise. The only asynchrony in the path
  is a 300 ms `setTimeout` debounce.
- The result now carries a document ID. WI-3.5 changed the signature to
  `setEntries(entries, documentId)`, which makes plan M `:616`'s "既不带 document id
  也不带修订号" half stale.
- **But the document ID does not gate the write.** `tocStore.setEntries`
  (`src/stores/tocStore.ts:151-203`) computes `switching = documentId !== state.documentId`
  and, on a mismatch, **archives the outgoing document and accepts the incoming
  write** through `swapDocument`. There is no rejection path anywhere in it. The ID
  buys *attribution and isolation* — document A's collapse state never leaks into
  document B — it does not buy *freshness*. Any claim that the red line is half-met
  because "the ID is checked" is false, and this record exists partly to kill that
  claim before it is repeated.
- Staleness is therefore closed by **cancellation alone**. The effect in
  `src/hooks/useTOC.ts:91-125` depends on `[content, documentId, debounceMs, setEntries]`
  and its cleanup clears the pending timeout, so any change to either input cancels
  the in-flight parse before it can fire. `tests/use-toc-document-scope.test.ts`
  (law U-L1) asserts the strong form: after A → B → A inside the debounce window,
  `byDocument.has("doc-b")` is `false` — B never landed at all, as distinct from
  "B landed and then A landed again."
- There are zero revision or generation counters in the repo outside an unrelated
  content hash in `useMcpSync.ts`. A generation-counter precedent does exist for a
  genuinely async path (`src/utils/cursorSync/table.ts:205-235`).
- `src/main.tsx` renders `<App />` bare — there is **no `<StrictMode>`** — and `src/`
  contains zero `startTransition`, zero `useDeferredValue`, and zero `AbortController`.
  `App.tsx:136-140` feeds `useTOC` from `activeDocument?.content` and
  `activeDocument?.id`, both read from the same object in the same render.

The question put to an external reviewer (Codex) was whether to (A) record the red
line as discharged by cancellation, or (B) implement a revision counter now to match
the literal wording. The review returned A, and supplied the argument that decided
it — see Decision.

## Decision

**Red line #3 is discharged for the TOC path by cancellation plus document-ID
attribution. No revision number is added.**

Three reasons, in order of weight.

1. **A revision counter as it would actually be written does not close the hazard
   it is imagined to close.** The only interleaving anyone could name that defeats
   cancellation is one where a deferral layer keeps feeding `useTOC` the *old*
   `(content, documentId)` while the document has moved on: the effect never
   re-runs, so cleanup never fires, and the pending timer publishes under a document
   ID that still matches. A generation counter incremented inside that same effect
   is captured in the same stale closure as the content — it holds the old
   generation too, and compares equal. A revision number only wins if it is minted
   at the **authoritative source** (the document store) and compared at publication,
   independently of the delayed effect. Adding a counter to `useTOC` would be
   machinery that looks like a guard, passes review, and protects nothing.

2. **Written today, any such guard is unreachable code.** No input sequence can make
   it fire, so it cannot be tested except by mocking a state the application cannot
   enter — which proves the guard rejects under the mock, not that any real race was
   caught. Unreachable branches with mock-only tests rot, and worse, they read to the
   next person as evidence that the hazard is handled.

3. **The red line's own shape is wrong for the hazard that remains.** It is scoped to
   *asynchronous results*. The interleaving above is produced by *deferred inputs with
   synchronous parsing* — the opposite shape. Satisfying the letter of the red line
   would leave that case exactly as exposed as it is now.

**The precondition attached to this discharge is broader than plan M's.** Plan M ties
the revision guard to "解析移入 Worker 或改为异步". That trigger is too narrow. The
binding form is:

> If anything is introduced that **yields between reading `(content, documentId)` and
> publishing to `tocStore`** — a Worker, an IPC round-trip, an `await`, a promise — **or
> that defers `useTOC`'s inputs relative to the authoritative document** —
> `useDeferredValue`, `startTransition`, a second store read, an intermediate memo fed
> from a different source — then the source-minted revision guard becomes mandatory
> **in that same commit**, and this ADR is superseded rather than amended.

**The precondition is kept alive by a test that passes today**, not by this document:
`tests/toc-parse-synchrony-invariant.test.ts`. It asserts that the parser returns a
plain array rather than a thenable, and that publication to the store is complete the
instant the debounce timer fires with no microtask flush. Both assertions go red the
moment the first half of the precondition is breached. A deliberately-failing or
skipped test was rejected: a red build on `main` gets disabled, and a skipped test
gets deleted. A grep or lint gate on `Worker`/`await`/`invoke` was also rejected — it
is evaded by any helper function.

## Consequences

### What this gives up

- The literal wording of plan M red line #3 is not met, and will not be. Anyone
  auditing the migration against the plan text will find a gap; this record is the
  answer, and plan M `:603-621` is corrected to point here.
- The second half of the precondition — deferred inputs — has **no** automated guard.
  The synchrony test cannot see it, because an intervening `useDeferredValue` breaks
  nothing the test can observe: parsing stays synchronous and publication stays
  immediate. That half rests on this ADR and on the comment at `useTOC.ts:110-114`
  being read. That is a real weakness and it is stated rather than papered over.
- The repo now holds two different answers to "how do we avoid publishing stale
  work" — a generation counter in `cursorSync/table.ts` and cancellation here. That
  inconsistency is deliberate (the table path is genuinely async and cannot cancel),
  but it costs a reader an explanation every time.

### What it buys

- No unreachable branch, and no test that can only assert against a mock.
- The cancellation invariant is testable against real behaviour, and is tested: law
  U-L1's negative archive assertion is the one that distinguishes "never landed"
  from "landed and was overwritten," which is precisely the distinction a revision
  guard would be bought to make.
- Milkdown-style accidents aside, the failure this path is exposed to is now named
  precisely enough to be searched for, instead of being assumed handled.

### The failure condition that outlives this record

Someone inserts a deferral between `documentStore` and `useTOC` — most plausibly by
wrapping `activeDocument?.content` in `useDeferredValue` to keep typing smooth in a
large document — and does not wrap `activeDocument?.id` the same way. That produces
a **torn pair**: content from one revision published under the document ID of
another, with every dependency looking internally consistent so cancellation never
triggers. Today this is impossible only because both values come off the same object
in the same render (`App.tsx:137-138`). If that line ever reads the two fields from
two sources, this ADR is void.

### Not decided here

- The separate, still-unowned `activeDocumentId` race recorded at plan M `:611-612`
  ("点了 B 却停在 A"): a late `setActiveDocumentId` wins. Plan M already says this is
  **not** red line #3, and it is not folded in here either. It needs its own work item.
- Whether `tocStore.setEntries` should gain a rejection path at all. It deliberately
  has none — archive-and-accept is what makes document isolation work — and changing
  that is a contract change to `src/types/toc.ts`, not a guard.
