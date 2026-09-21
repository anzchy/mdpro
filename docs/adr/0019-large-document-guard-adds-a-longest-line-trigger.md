# 0019. The large-document guard gains a longest-line trigger

## Status

Accepted — 2026-09-21

**Extends, does not supersede,
[ADR-0016](./0016-large-document-guard-predicate-is-a-source-structure-score.md).**
ADR-0016 Decision 1 reserves the right for later work to "add or reweight
counters within those invariants without superseding this ADR". This record adds
a counter and a second threshold, so ADR-0016 remains **Accepted** and its text
is untouched. The one thing here that goes beyond ADR-0016's reservation is that
the new counter gets its **own** comparison rather than being folded into the
score — see Decision 3 for why, and read that as the reason this is a record
rather than a commit message.

## Context

D6.3(c) shipped the structure score on 2026-09-21 (`703a6b4`). ADR-0016
Consequences named the predicate's blind spot openly:

> A 9,961,475-byte, 4-line document scores 3 and is ALLOWED, where the old byte
> predicate would have refused it.

That inversion was accepted. **It was accepted on a misattributed
measurement.** The only number available for "very-long-line" when ADR-0016 was
written came from the D6.1 sweep, which measured the **471,862-byte
`.wysiwyg` fixture** at 0 ms. The sentence in
`docs/plans/20260912-plan-markdown-source-consolidation.md` that justified the
inversion attached that 0 ms to the **9,961,475-byte `.source` fixture** — a
different file, 21x larger. Nobody had measured the source variant at all.

The 2026-09-21 real-device run measured it
(`docs/test/20260921-d5-d6-real-device-measurement.md`, `48eb97a`):

| | `very-long-line.source.md` |
|---|---:|
| Bytes | 9,961,475 |
| Structure score | **3** — ALLOWED by the shipped predicate |
| Milkdown `loading` -> `ready` | **259,483 ms (4 min 19 s)** |
| UI | not readable via accessibility for at least **120 s**; recovered |
| CPU at observation points | 98.5%–100% |
| `sample` top-of-stack | `JSC::JSObject::countElements`, 11,175 hits |

So the guard now permits a four-minute freeze on a shape the predicate it
replaced would have refused. This is a **protection regression that D6.3(c)
introduced**, measured, not hypothesised. It is also the shape behind
[ADR-0004](./0004-waive-gate-2-unresponsiveness-criterion-to-admit-stage-3.md)'s
criterion (1), which makes leaving it alone more expensive than it looks.

Measuring the whole corpus for longest line (UTF-16 code units, the unit the
scan actually iterates) shows the two shapes are not close together:

| Fixture | Bytes | Structure score | Longest line |
|---|---:|---:|---:|
| `very-long-line.source` | 9,961,475 | 3 | **7,583,742** |
| `very-long-line.wysiwyg` | 471,862 | 3 | **359,285** |
| `normal-prose.source` | 9,961,944 | 54,126 | 353 |
| `normal-prose.wysiwyg` | 473,540 | 2,574 | 351 |
| `dense-math.*` | 9.96 MB / 471,942 | 425,316 / 20,664 | 63 |
| `large-table.*` | 9.96 MB / 471,880 | 1,164,910 / 57,190 | 46 / 45 |
| `many-short-nodes.*` | 9.96 MB / 471,867 | 637,940 / 32,657 | 16 / 15 |

Every fixture except the two `very-long-line` ones has a longest line under 400
characters. The one that must be refused and the one that should be allowed are
**21x apart**. This is a far wider gap than the (20,664, 32,657) interval that
25,000 had to be sited inside.

## Decision

1. **A second counter is added: the longest line length**, in UTF-16 code units,
   tracked in the same forward pass as the structure score. Two additional
   integers (current run length, maximum seen) keep the scan single-pass and
   constant-auxiliary-space, so ADR-0016's invariant set is preserved intact: no
   Markdown parsing, no tokenizer, a decision made by comparing counts only.

   The unit is the UTF-16 code unit because that is what `charCodeAt` iteration
   counts. A line of astral-plane characters therefore measures twice its
   grapheme length. This is not a fidelity claim; it is what the cheap scan can
   see, stated so nobody later reads it as a bug.

2. **The threshold is 1,000,000 code units, and `<=` allows** — the same
   direction as the structure threshold, for the same reason: the guard exists to
   refuse, and a boundary document should be allowed to open.

   The evidence is **two points**: 359,285 allowed (155 ms mount, measured), and
   7,583,742 refused (259,483 ms mount, measured). 1,000,000 sits 2.8x above the
   allowed observation and 7.6x below the refused one. It is a round number
   chosen inside a measured interval, **not a measurement**, and the interval is
   defined by one observation on each side.

3. **The new counter gets its own comparison; it is NOT folded into the structure
   score.** Folding it in — `score += floor(longestLine / k)` — was the cheaper
   option and is the reading ADR-0016 Decision 1 most directly anticipated. It is
   rejected because it requires inventing an exchange rate between "characters on
   one line" and "structural elements" for which there is no evidence at all, and
   because a sum lets two individually-harmless quantities combine into a
   degrade that neither observation supports. Two independent counts, each
   compared against a threshold fitted to its own evidence, cannot produce that
   false positive. The cost is a second number to maintain and re-fit.

   ADR-0016 set the cell weight `k = 1` "by policy, not by measurement", so
   inventing a weight would not have been unprecedented here. The difference is
   that `k` was constrained by the five-point ranking to `k > 0.464`; a
   line-length divisor is constrained by nothing.

4. **Either trigger degrades.** The document is refused when the structure score
   exceeds 25,000 **or** the longest line exceeds 1,000,000. The payload reports
   both measurements and which trigger fired, so a degrade can be explained
   without re-running the scan.

5. **The toast text is unchanged.** "This document is too complex for WYSIWYG.
   Switched to Source mode for performance." is already true of both triggers —
   it names neither a byte count nor a structure count. No new user-facing copy
   decision is created by this ADR.

6. **No millisecond value here becomes a blocking gate** (E39 / G0). The times
   above justify a count-based threshold; the shipped predicate compares counts.

## Consequences

**What this gives up.**

- **The threshold rests on two measurements, one per side.** 25,000 was fitted on
  five fixtures with a monotone ordering; 1,000,000 has a single allowed
  observation and a single refused one, each measured once, on one machine, with
  `pmset -g therm` unavailable during the run. It is the weakest-evidenced number
  in the guard and should be the first one re-fitted when more data exists.
- **A new false-degrade class: large inline data URIs.** A base64 image embedded
  on one line crosses 1,000,000 characters at roughly a 750 KB image. Such a
  document will now open in Source mode, and **nobody has measured whether it is
  actually slow** — it may well be fine. This is a real behaviour change for a
  real Markdown pattern, accepted without evidence, in exchange for closing a
  measured four-minute freeze.
- **The blindness is narrowed, not eliminated.** A document of many 900,000-character
  lines passes both triggers: each line is under the line threshold, and few
  newlines keep the structure score low. That shape is contrived, but so was
  `very-long-line`, and it is in the corpus precisely because contrived shapes
  turned out to matter.
- **`very-long-line.wysiwyg` (359,285) stays allowed on one 155 ms measurement.**
  Its close-document time that same session was 13,141 ms, but that figure
  includes remounting the next document and is not a clean cost for this shape.
  If a clean close measurement later lands in the seconds, this threshold is
  wrong and the fixture, not the number, will be the thing that says so.
- **Two thresholds are harder to reason about than one**, and a future reader has
  to know that a degrade could come from either. Decision 4's payload is the
  mitigation, and it only works if someone reads it.

**What this does not fix.**

- **A degrade still writes nothing to `~/.mdpro/mdpro.log`.** The 2026-09-21 run
  confirmed this on a real machine: `view.mode.change wysiwyg→source` appears,
  but no event records the score, the threshold, or why. Out of scope here, still
  tracked separately.
- **This does not close D6.** ADR-0004 ties that to the per-surface 3.8 exit
  re-test, and the 2026-09-21 matrix left seven cells unverified. It removes one
  named reason D6 could not close; it does not substitute for the measurement.

**What this corrects in the record.** The sentence in plan M that attributed the
`.wysiwyg` fixture's 0 ms to the `.source` fixture is false and is rewritten in
the same commit as this ADR. ADR-0016's own text does not contain that error —
its "3 -> 0 ms" appears inside an explicitly-labelled table of five ~472 KB
fixtures — and is therefore left exactly as written.
