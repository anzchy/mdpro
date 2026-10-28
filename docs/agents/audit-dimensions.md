# Audit dimensions

**What both auditors check, how severe a finding is, what evidence it needs, and the shape of the report.** Both
gpt-auditor and opus-auditor read this one file, so the two verdicts can challenge each other on the same terms
(ADR-0115; ADR-0146 decision 1). Modes, read barriers and output paths come from the request and from each auditor's
own procedure; this file does not repeat them.

## How this file is read

- Every request names a `master` SHA `<M>` and this file's blob id `<B>`. Read it with `git cat-file -p <B>`. Never
  read it from a worktree or from the range under audit.
- Echo `<B>` on the report's first line. A report naming another blob is rejected and re-asked.
- One pin covers a whole review: round one, its challenges, the confirm and the confirm's challenges all use round
  one's `<B>`.
- This file changes only through a PR, audited under the old blob, with plan review of the new one.

## Which set

| Tier (ADR-0121) | Set |
|---|---|
| High | **full** (F1–F9) + **L** + **A** + § Security review |
| Medium | **mini** (M1–M5) + **L** + **A** |
| Low | **mini** (M1–M5) + **L** + **A** |
| ADR or plan review | **plan** (P1–P5) |

Every dimension in the set gets a `COVERAGE` entry. A dimension the change cannot touch is `n/a` with a reason in a
few words (`L n/a: CSS only`). Dropping a dimension to save time is a skipped dimension, and the report is re-asked.

Read `.claude/rules/60-review-checklist.md` (at `<M>`) first. Its Critical Pass items (IPC trust, races, data-loss
paths, enum completeness) are mdpro's own definition of what a High looks like.

Read from the diff outward (ADR-0138 decision 4): start with `git diff --stat`, the diff, the changed tests and the
ACs. Treat the implementor's entry-path and await map as an index to verify, not a scope. Build your own map: every
acquirer of each lock the range touches or calls under, every writer and deleter of each persisted value it changes
(drafts, preferences, files, receipts), every caller, and the window, close and quit lifecycles that reach them. Read
those in full. On a `hard` range, also read every changed file and its callers in full.

## mini (M1–M5)

Production code. Test files are read for dimension A, and for any finding that depends on one.

- **M1. Logic & Correctness.** Edge cases, off-by-one, missing `await`, unhandled promises, stale closures,
  unexpected state mutation. Lifecycle and ordering cases belong to L.
- **M2. Duplication.** Copy-paste code; near-duplicates differing by one or two lines.
- **M3. Dead Code.** Unused imports, unreachable branches, commented-out code, orphaned functions.
- **M4. Refactoring Debt.** Long functions, deep nesting, unclear names, missing abstractions, files over 300 lines
  (rule 50).
- **M5. Shortcuts & Patches.** Leftover TODOs, hardcoded values, workarounds, incomplete error handling, quick fixes,
  backward-compat shims.

## full (F1–F9)

Production code and tests.

- **F1. Redundant & Low-Value Code.** Dead, duplicate and useless code: unreachable paths, unused functions, no-op
  operations, empty catch blocks.
- **F2. Security & Risk Management.** Input validation (command injection, path traversal, XSS), the IPC trust boundary
  (rule 60), secrets and tokens in code, logs or events, auth and access control.
- **F3. Code Correctness & Reliability.** Logic errors, boundary conditions, runtime risks (null, bounds), error
  handling (swallowed errors, silent failures), resource leaks. Lifecycle and ordering cases belong to L.
- **F4. Compliance & Standards.** Project rules (rules 10–60), framework conventions, deprecated APIs, licences.
- **F5. Maintainability & Readability.** Complexity, size (rule 50's 300 lines), magic numbers, DRY.
- **F6. Performance & Efficiency.** Algorithmic cost, blocking I/O on the main thread or an async executor, excess
  allocation.
- **F7. Testing & Validation.** Critical paths without tests, flaky tests, wiring-only assertions, mocks of internal
  modules (rule 10). Whether each AC is proved belongs to A.
- **F8. Dependency & Environment Safety.** New or changed dependencies, known CVEs, config secrets, `.gitignore`.
- **F9. Documentation & Knowledge Transfer.** Stale comments (rule 22), the ledger row (rule 60), ADR consistency.

## L. Lifecycle & concurrency (every tier)

**Scope.** The `await`, lock, timer, listener, IPC round trip and queued-operation sites that the range adds or
modifies, plus the sites on the map above (lock acquirers, persisted-value writers and deleters, callers, window,
close and quit lifecycles). Code reached only transitively beyond that map is out of scope.

**For each site, five cases:**
1. the document closes, is replaced or is reopened;
2. the window closes, or quit starts;
3. a second event arrives part-way;
4. a stale token or result returns;
5. a Rust lock is held across a call that blocks or re-enters.

**Platform order.** When a test feeds platform events (AppKit notifications, OS callbacks, WebView messages) in an
order it assumes, is that order backed by evidence: a probe, a log from the real app, platform documentation? An
assumed order needs a `device` AC (ADR-0144). Name the site and the assumed order.

## A. Evidence proves each AC (every tier)

**Scope.** The ACs in the brief, or in the request when there is no brief. With no ACs: `A n/a: no ACs`, and the
request must say so.

What `PROVED` means depends on the evidence the AC cites:

| Evidence | `PROVED` when |
|---|---|
| Test | You name one plausible wrong implementation, and the assertion in the cited test that fails on it. The test reaches the behaviour through the entry path the AC names; when it names none, through the brief's entry-path map or the matrix's "every caller or entry path" row. |
| Command or lane | The stated command, run at the SHA, exercises the behaviour, and the decisive output in the handoff is what that command prints. Re-run it only when the request allows. |
| Docs or config | The content at the SHA says what the AC requires. |
| `device` AC | Write `PROVED (unit part) · device → card <id>`. The verdict covers the code and the unit evidence only. A pending real-app half is never `NOT PROVED`; ADR-0144's cards own it. |

`NOT PROVED`: the evidence does not show the behaviour. `WRONG`: the code does not do what the AC says.

On a confirm, re-verdict every AC the fix diff touches and every AC that was not `PROVED`; carry the others over by
reference.

## plan (P1–P5)

1. Internal Consistency · 2. Completeness · 3. Feasibility · 4. Ambiguity · 5. Risk & Sequencing. For an ADR, also
check it against CLAUDE.md § Architecture Decision Records, against every accepted ADR it touches, and every quoted user
decision against its source. READY means ready to accept as written.

## Severity

| Severity | Meaning | Blocks |
|---|---|---|
| Critical | Data loss, a security hole or silent corruption on an ordinary path | Yes |
| High | A correctness or data-safety defect a user or CI reaches on an ordinary path; a rule-60 Critical Pass violation; an AC that is `WRONG`; an AC `NOT PROVED` unless the request cites the delegator's acceptance of it as unproved | Yes |
| Medium | A real defect or risk off the ordinary path; debt with a concrete cost; an untraced suspicion (below); an AC `NOT PROVED` that the request cites as accepted; the split recommendation | No; listed, one line each |
| Low | A nit: style, naming, a small clean-up | No; counted only |

### Evidence for a blocker

- **A suspected runtime defect** is raised as Critical or High only with:
  - the file and line;
  - an ordered trace from an ordinary path to it;
  - why the existing tests miss it.

  A suspicion without the file:line and the trace is raised at most as Medium. Name the site in that Medium. This cap
  applies only to your own suspicion at the moment you raise it.
- **These are never capped**, because they carry their own decisive evidence:
  - a failing test, command or device card: its output;
  - a reproduced defect: the reproduction;
  - an observed rule-60 Critical Pass violation: the file:line of the violation;
  - a `WRONG` AC: the AC text and the code or evidence that contradicts it.
- **Lowering.** Once a report holds a Critical or High, nobody lowers it (not its raiser, not the other auditor, not
  the delegator) without a reproduction or a counter-proof: the command and its decisive output, or a file:line trace
  showing the ordinary path never reaches it. "Unlikely" or "narrow timing" is not a refutation.
- **Supplying a trace.** The other auditor in a challenge, or the delegator sending one, may supply a missing trace.
  The finding then stands as High. On a `hard` range, every untraced L Medium is sent to the other auditor in the same
  round as a "trace this" challenge.
- **Untouched code** counts only when the change makes the defect reachable. A pre-existing Critical or High is tagged
  only under ADR-0121 decision 3.
- **Bug class.** A finding names its class and every instance. On a confirm, an unfixed instance keeps it PARTIAL.

### Split recommendation

A range with more than about 400 changed production lines (added plus deleted in `git diff --numstat base..sha`) gets
one Medium recommending a split. It is advisory and opens no fix round.
- Excluded: `tests/`, `*_tests.rs`, inline `#[cfg(test)]` modules (estimate from the diff), `docs/`, lockfiles,
  `receipts.json` and the generated ledger.
- Counted: `src/`, `src-tauri/src/`, `scripts/`, `.claude/` and `.agents/`.

## Security review (High tier, both auditors)

A separate `## Security review` section, with its own count line, on the range's diff: injection (command, path,
HTML), path traversal, the IPC trust boundary (rule 60), secrets and token handling (including logs and emitted
events), unsafe deserialisation, and auth on the MCP HTTP routes. Same severity and evidence rules as above.

## Report shape

```
VERDICT   <audit|confirm|challenge|plan> · <item> @ <sha7 or doc>   (range <base7>..<sha7>)   tier <T>   dims <B7>
COVERAGE  M1|F1 ok — <what was read> · … · L <see below> · A ok|n/a — <reason>
  L       <site file:line> — (1) handled: <guard or test> | F<n> | n/a: <why> · (2) … · (5) …   (one line per site)
AC        AC-1 PROVED|NOT PROVED|WRONG — <own evidence>   (one line per AC)
FINDINGS
  F1. [Critical|High] <dimension> · <file:line> · <issue>
      evidence: <trace | test or command output | reproduction | rule-60 file:line | AC contradiction>
      why tests miss it: <one line>   (traced runtime defects)
      origin: <introducing commit in base..sha | Pre-existing, with the ADR-0121 proof>
      fix: <one line>
  M1. [Medium] <dimension> · <file:line> · <issue>   (one line each)
CONFIRM   (confirm) <finding id>: CLOSED|PARTIAL|OPEN — <evidence>
CHALLENGE (challenge) CONFIRMED|REFUTED — <trace, reproduction or counter-proof>
COUNT     C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>
SECURITY  C<n> H<n> M<n> L<n>   (High tier)
```

- `BLOCKING` leaves out Highs tagged Pre-existing that meet ADR-0121 decision 3.
- A blanket `L ok` is a skipped dimension.
- The delegator re-asks, in the same round, a report that has no `COVERAGE` line, skips a dimension without a reason,
  leaves an AC without a verdict, names another blob, or raises a traced runtime High without "why tests miss it". The
  re-ask goes to a fresh pane with your own report, asking only for the missing lines; it is not a new round.
