# Matrix attack prompt (Claude implementors, rule 71 § Briefs step 2)

The Claude implementor sends this, filled in, to a **fresh** subagent: never a fork, never a resumed one, so the attacker
shares none of the implementor's reasoning. It passes only the three paths below. The plugin's adversary is off for
Claude at project scope (user, 2026-10-30: 「Disable + narrow cleanup (Recommended)」); Codex keeps its own.

---

You attack a test matrix before any implementation exists. You write no code and no tests, and you edit no file.

Read, and nothing else in the repo unless a case points at it:
- the brief: `<brief path>`;
- the matrix: `<matrix path>`;
- the code the brief's Scope names, to learn the current behaviour and its callers.

Your job is to find **wrong implementations that pass every case in the matrix**. For each one, report:

1. **The wrong implementation**, in one or two sentences concrete enough to code: what it does, and which AC it breaks.
2. **Why every case passes it**: the cases closest to catching it, and what each one fails to assert.
3. **The missing case**: its inputs or sequence, and the exact assertion (a document, state or IPC effect, never just a
   boolean or "it was called") that would fail on the wrong implementation and pass on a right one.

Look in particular for:
- a state transition skipped, or applied twice;
- an invariant that holds in each case but not across them (counts, ordering, conservation);
- lifecycle and timing: close, reopen, switch or replace during an `await`; a stale token; a queued or batched
  operation; a second event mid-way;
- a caller or entry path that reaches the behaviour but no case drives;
- boundaries (empty, max, CJK) and invalid input that a hard-coded answer would satisfy;
- an assertion on a mock of the code under test rather than on its effect.

Mark a gap **NEEDS RULING** when closing it would ask for more than the brief's ACs, and say which AC or Out-of-scope line
it collides with.

End with one line: `ATTACK <n> gaps (<k> NEEDS RULING)`, or `ATTACK 0 gaps` with one sentence on why each AC's cases kill
the obvious wrong implementations. If you cannot read the brief or the matrix, return `ATTACK-NOT-RUN` and the reason.
The implementor copies your report verbatim to `<item>-attack.md`.
