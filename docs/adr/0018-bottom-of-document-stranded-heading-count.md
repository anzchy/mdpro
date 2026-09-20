# 0018. Bottom-of-document highlight: the number of stranded headings is not fixed at one

## Status

Accepted — 2026-09-20

Supersedes [ADR-0017](./0017-source-scroll-spy-bottom-of-document-asymmetry.md).

## Context

ADR-0017 accepted a product asymmetry at the bottom of a source-mode document:
selection follows viewport geometry, so a heading that cannot be brought to the
anchor cannot be selected by scrolling. That decision is not in dispute here and
is restated unchanged below.

What is in dispute is how ADR-0017 **described** the consequence. It says, twice:

> Scrolling to the very bottom leaves the highlight on the **second-to-last**
> heading; the final heading lights up when clicked.

and lists as a requirement it gives up:

> Scrolling to the bottom always selects the final heading.

The manual GUI acceptance pass that ADR-0017 itself named as its verification
obligation — WI-6, run on 2026-09-20 against a de-instrumented release bundle —
measured something different. With the 111-line fixture whose headings sit at
lines 1, 8, 22, 34, 46, 60, 74, 86 and 99, scrolling to the scroll limit put
line 111 on screen and left the highlight on **Middle marker two (line 74)** —
the **third**-to-last heading. Both `## Setup` (line 86) and `## Tail` (line 99)
were visible on screen and unhighlighted.

"Second-to-last" was not a conservative estimate that happened to be off by one.
It was a guess about a quantity that has no fixed value. The heading selected at
the scroll limit is whichever heading is last at or above the anchor once the
document has stopped scrolling, and the number of headings stranded below that
anchor is a function of **how many headings fit in the final screenful** — which
depends on viewport height, font size, line height, the user's content-width
preference, line wrapping, and how densely headings happen to be spaced near the
end of that particular document. A document ending in nine short headings
strands nine. A document ending in one long section strands one.

This is worth a record rather than a silent correction for two reasons. First,
ADR-0017 offered "second-to-last" as a concrete, checkable prediction, and a
future reader who measures three will reasonably conclude the implementation has
regressed and go looking for a bug that is not there. Second, ADR-0017's own
Context section states that manual QA "confirmed the clamp is load-bearing for
both the last and the second-to-last heading" — that sentence is about which
*click targets* need the clamp and remains true as measured, but sitting beside
the wrong scroll claim it invites the reader to fuse the two into a single false
invariant.

## Decision

The policy from ADR-0017 stands, verbatim and unamended:

> **Ordinary scrolling selects the section at the anchor. A heading the user
> explicitly clicked survives at a clamped destination.**

The retention predicate, the `clientHeight > 0` conjunct, the rejection of
`bottomLine === doc.lines`, and the trade-off analysis in ADR-0017 are all
unchanged. No code changes under this ADR.

What changes is the description of the consequence. The correct statement is:

> **At the scroll limit the highlight rests on the last heading at or above the
> anchor. Every heading below that anchor is visible and unhighlighted. How many
> that is depends on the final screenful and is not a fixed number.**

Where ADR-0017 lists the three mutually unsatisfiable requirements, requirement
(2) is correspondingly restated as "scrolling to the bottom always selects the
final heading" → still the requirement being given up, but the cost of giving it
up is larger than ADR-0017 implied: it is not one heading, it is a tail of them.

## Consequences

**Costs:**

- **The visible cost of ADR-0017's trade is larger than ADR-0017 stated**, and
  this ADR makes that worse-looking rather than better. On a document that ends
  with a dense run of short headings, the bottom of the outline will show several
  consecutive unhighlighted entries the user can plainly see on screen. If that
  is judged unacceptable, the remedy is the extra state ADR-0017 declined to
  introduce — remembering that a selection came from a click rather than a
  scroll — and that price still has to be paid in whatever ADR supersedes this
  one.
- **Two ADRs now describe one decision.** A reader who finds 0017 first gets the
  full reasoning and a wrong consequence; a reader who finds 0018 first gets the
  correction and a pointer back. That is the cost of the immutability rule, paid
  deliberately: editing 0017 in place would have been cheaper to read and would
  have destroyed the evidence that the claim was ever asserted and on what basis.
- **A number was consumed to correct a measurement, not to change a decision.**
  This is a real cost to the ADR log's signal-to-noise. It was chosen over an
  erratum in the plan document because the plan row is uncommitted, effort-scoped,
  and will not be read by someone who reaches for the ADR directory to find out
  why the bottom of the outline behaves this way.

**Benefits:**

- The recorded consequence now matches a measurement rather than an estimate, and
  names the measurement that produced it.
- A future QA pass that observes three stranded headings has a document saying
  that is expected, instead of an ADR saying it should have been one.
- The dependence on viewport height, font size, and wrapping is stated, so the
  behaviour is not re-derived as a defect the next time someone changes the
  editor's default type scale.

**What is explicitly not claimed:** this ADR does not assert a formula for the
stranded count, and no test pins one. The unit lane cannot — jsdom has no layout —
and the repo has no integration or e2e lane. The claim rests on a single manual
measurement with one fixture at one window size, which is enough to disprove
"second-to-last" as an invariant but not enough to characterise the general case.
