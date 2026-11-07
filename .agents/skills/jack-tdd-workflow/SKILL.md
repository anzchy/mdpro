---
name: jack-tdd-workflow
description: The TDD method an mdpro implementor follows on Claude or Codex, from the test matrix through the matrix attack, RED receipts and cycles to /code-review and the handoff's self-acceptance table. Use whenever a brief names jack-tdd-workflow, or when you design a test matrix, get one attacked, record or verify a RED receipt, or write an implementor handoff.
---

# jack-tdd-workflow

The method an implementor follows from the test matrix to the handoff's self-acceptance table. The words below mean what `GLOSSARY.md` § TDD says: Test matrix, Matrix attack, RED receipt, Cycle. Use them, not their synonyms, in matrices and handoffs.

This is one method for both runtimes: a Claude implementor and a Codex implementor follow the same text for the same brief. Each uses its own installed Matt Pocock skills (`mattpocock-skills`, at least 1.3.1). Planning, audits, landing and device batches are outside this skill.

## RED receipts

Every RED and every `verify` goes through the receipt CLI, `node scripts/tdd/red-receipt.mjs`, by way of this skill's
thin wrapper, `.agents/skills/jack-tdd-workflow/scripts/receipt.mjs`. Run it from inside the repository: it takes the
repository as the git top level of the directory you run it from, runs exactly the command `.claude/rules/10-tdd.md`
states for its mode (the frontend modes through the heavy-lock guard), adds no argument or variable of its own, and
passes an interrupt on to the receipt command. Rule 10 stays the source of truth for those commands.

- A frontend RED: `node .agents/skills/jack-tdd-workflow/scripts/receipt.mjs frontend-record --id <ID> --test <file>`
- Its verify: `node .agents/skills/jack-tdd-workflow/scripts/receipt.mjs frontend-verify --id <ID>`
- A Rust RED: `node .agents/skills/jack-tdd-workflow/scripts/receipt.mjs rust-record --id <ID> --test <file>`
- Its verify: `node .agents/skills/jack-tdd-workflow/scripts/receipt.mjs rust-verify --id <ID>`

Run `cargo fmt` (it formats the whole crate) yourself before a Rust record, and never between record and verify: the
receipt fingerprints the file's bytes, a later reformat breaks it for good, and the entry refuses an unformatted
record. The wrapper never runs it.

## 1. Design the test matrix

Write the matrix to `<item>-test-matrix.md` in your report folder, in the shape of `references/matrix-template.md`.
For each AC, list cases in six classes: success; boundary (empty, max, CJK); invalid input; lifecycle and timing (close,
reopen, switch or replace during an `await`, a stale token, a queued or batched operation, a second event mid-way); every
caller or entry path that reaches the changed behaviour; and platform, where it applies. These are the classes whose
absence caused earlier Highs.

Each case names its assertion, a document, state or IPC effect, never a bare boolean or "it was called", and its test file.

## 2. Have the matrix attacked

Send the attack prompt, `.agents/skills/jack-tdd-workflow/references/matrix-attack-prompt.md`, filled in with your
brief and matrix paths.

The attacker is fresh: never a fork and never a resumed agent, so it shares none of your context. On Claude it is a new
Opus subagent at default effort (`Agent`, `model: "opus"`). On Codex it is a fresh Codex agent at its default model and
effort, started as a new `codex exec` process with no resumed session. Either way it gets
only the attack prompt, the brief and the matrix, plus read access to the code the brief's Scope names. There is no
routing by difficulty.

The attack runs once per grant, with at most one re-attack after you add cases. Copy the attacker's report verbatim to
`<item>-attack.md`. If the attacker cannot run, write `ATTACK-NOT-RUN` and the reason there, and stop.

## 3. Amend the matrix

Add each gap the attacker reports as a case, or reject it with a counter-proof: an existing case that catches it, or a line of the brief's Out of scope. Record each disposition under the matrix's Amendments.

Stop and ask the delegator about a gap the attacker marks NEEDS RULING (closing it asks for more than the brief), and about any gap still open after the re-attack, which goes to the delegator too. You never decide scope yourself.

## 4. Optional: the acceptance check first

The item's acceptance check is one exit-condition test, such as a bug's reproduction or an end-to-end check. You may write it and record its RED as `<ID>-ACC` before the first cycle, and run its `verify` when the last cycle settles. It is the exit condition, not the design, so it is the one test allowed to exist ahead of the cycles.

## 5. Cycles

Build the item in cycles, one matrix case each. A cycle is: write the case's test; check it; record its RED receipt as `<ID>-S<n>`; make the minimal change that turns it green; run `verify`; then a small refactor with tests green. Each cycle settles before the next starts, so each green step informs the next test and a refactor can never break a receipt.

A cycle has one intended assertion and its record names one `--test` file. Unit REDs are never recorded as a batch: this method replaces the old "all REDs first" step for every implementor item, gated or not.

Before you record, check the test compiles and runs to its assertion: run the one file and read the failure. A build, import or harness error is never recorded as a RED. If the module under test does not exist yet, add a stub with its signatures first, so the RED is an assertion failure.

A one-test fix round counts as one cycle; it needs no new matrix ritual. A refactor too big for one cycle stops the item and goes to the delegator as a separate prefactor item, so the item's diff stays reviewable.

## Amending the matrix mid-item

A new case inside an existing seam and AC is marked "added in cycle n" and needs no re-attack; take it through its own cycle.

A new seam, a changed behaviour, or a case that changes what an AC means or covers stops you: send it to the delegator, who decides whether a re-attack runs (still at most one per grant).

## Raw-green tests and recorded-line corrections

A test that is green before any change cannot fail as written. Do not record it: name it raw-green in the handoff, with what it guards, so the delegator and the auditors can see it.

If a recorded test line turns out wrong, correct it this way: back out the production hunk by edit (never `git checkout` or `git restore`), correct the line, record a new suffixed RED (`<ID>-S<n>b`), re-apply the production hunk, run `verify` on the new id, and keep the old receipt untouched. No step needs a rule-25 command, and nothing rewrites history.

## D items

For a D item, run `/diagnosing-bugs` before the first RED, to get a tight pass/fail loop that goes red on this bug; its reproduction then becomes the `<ID>-ACC` test. Fix the cause, not a symptom.

## 6. Review

With every cycle settled and the lanes green, commit, then run `/code-review` on the committed candidate before the handoff. Fix what it finds that is real (each fix is a cycle if it changes behaviour), and record the rest with a reason.

## 7. The handoff

Write the handoff the brief names. It ends with an `AC | evidence | verdict` table: each AC, the command or test that proves it with its decisive output line, its receipt ids and its verdict. After the table come the lanes run, the tree SHAs, the paths changed, the raw-green tests, every receipt in cycle order, and every approach you rejected and why, so a fresh fix session knows what was tried.

## Sources

These are the sources the method rests on. Read them when a step's reason is in doubt.
- Kent Beck, "Canon TDD": https://newsletter.kentbeck.com/p/canon-tdd. Write the list of test scenarios first, turn exactly one into a runnable test, make it pass, optionally refactor, repeat. One of its named mistakes is to "convert all the items on the Test List into concrete tests, then make them pass one at a time".
- Google eng-practices, "Small CLs": https://google.github.io/eng-practices/review/developer/small-cls.html. A refactor goes in its own change, which is why a big one becomes a prefactor item.
- Danilo Sato, "Parallel Change": https://martinfowler.com/bliki/ParallelChange.html. Expand, migrate, contract, when a contract change cannot land in one step.
- Matt Pocock's skills, `mattpocock-skills` (minimum 1.3.1; Claude and Codex each use their own install): `tdd` for what a good test is, seams and the red-green loop; `code-review` for the review stage; `diagnosing-bugs` for D items. One difference: `tdd` keeps refactoring out of the loop, while here each cycle ends with a small refactor with tests green, and anything larger goes to `/code-review` or a prefactor item.
- mdpro's research reviews of 2026-10-31: `docs/reference/20261031-slicing-best-practice-codex-review.md` and `docs/reference/20261031-slicing-best-practice-fable-review.md`.
