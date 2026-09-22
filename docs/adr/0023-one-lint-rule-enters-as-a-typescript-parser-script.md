# 0023. One lint rule enters as a TypeScript-parser script, not as ESLint

## Status

**Accepted** (2026-09-22). Supersedes [ADR-0020](./0020-eslint-enters-as-a-single-rule-devdependency.md),
which proposed the opposite and was never accepted.

## Context

WI-4.21 and WI-4.26 are blocked on one rule: forbid zero-argument Zustand
store-hook calls, the rule 50 §1 convention that a component must not
destructure a store at its top level. WI-4.26 adds no rule of its own. Neither
needs type information.

ADR-0020 proposed satisfying this by adding `eslint` + `@eslint/js` as
devDependencies under an exception to G0, the mechanical gate requiring
`git diff package.json src-tauri/Cargo.toml` to be empty. Three facts
established on 2026-09-22 moved the decision.

**1. ADR-0020's package list cannot do the job it was specified for.**
`@eslint/js` ships configurations, not a parser; ESLint's default parser is
Espree, which does not parse TypeScript. Linting `src/**/*.tsx` therefore needs
`@typescript-eslint/parser` as well — a package ADR-0020 never names, and whose
absence means the proposal as written would have been discovered to be
incomplete after the install rather than before it. The word "Espree" does not
appear in ADR-0020. This raises Option 1's real price above the one its own
record states.

(The parser is a separate package from `@typescript-eslint/eslint-plugin`, so
adding it alone would not activate the 13 `no-explicit-any` suppressions
ADR-0020 worries about. The suppression fork widens but does not open.)

**2. The obvious zero-dependency alternative — a regex — is already wrong on
this tree, three times out of four.** Scanning source lines for
`\buse[A-Z][A-Za-z0-9_]*Store\(\)` returns four hits across `src/` and
`tests/`. One is a real violation
(`src/components/common/settings/AdvancedSettings.tsx:21`). The other three are
a `//` comment, a docblock, and a string literal inside an `expect(...)` call.
The comment is `src/hooks/useTOC.ts:128` — **the comment that documents rule 50
§1**. A gate whose first run reports the documentation of the rule it enforces
is a gate people learn to skip.

Recall, by contrast, is currently perfect: across 48 store-hook call sites there
are no aliased imports, no barrel file, no generic type arguments, no optional
calls, and no multi-line call formatting. The textual approach fails on false
positives that exist now, not on false negatives that do not.

**3. `typescript` is already a direct devDependency** — `package.json:67`,
`~5.8.3`, and `require("typescript")` resolves from the worktree. The compiler
API can be used as a parser with `ts.createSourceFile`, no `createProgram` and
no type checker.

That third fact dissolves the trade the decision appeared to involve. The
accurate option and the cheap option are the same option: AST precision costs
exactly zero new dependencies, because the parser is already installed and
already load-bearing for two `tsc` gates.

**On enforcement.** No CI runs on this branch — all four workflows trigger only
on a `v*` tag or manual dispatch, three of them carrying in-file comments saying
the `pull_request` trigger was deliberately removed to cut Actions spend. There
are no git hooks. This does not favour either option: CI's absence limits
enforcement *coverage* identically for both, and changes detection *accuracy*
for neither.

This decision was routed to an external reviewer (Codex) before being taken.
It rejected both options originally framed and proposed the TypeScript-parser
script adopted here; its claims were then checked against the repository, and
the emphasis of its argument was found inverted for this codebase — it reasoned
mostly from false negatives, which occur zero times here, while the false
positives it mentioned in passing occur three times. The conclusion survived the
correction; the reasoning behind it is recorded above as verified, not as
relayed.

## Decision

1. **The rule is implemented as a repository script using the already-installed
   TypeScript compiler API**, under `scripts/lint/`, following the house
   precedent set by `scripts/ledger/parse.mjs`: pure exported functions,
   findings as data, no filesystem access in the core function.
   `ts.createSourceFile` with `setParentNodes`, walked with `ts.forEachChild`.
   **No `ts.createProgram` and no type checker** — the rule is syntax-only and
   must stay fast.

2. **No new dependency, and no G0 exception.** `package.json` is not modified.
   G0 stays mechanical, and the count of exceptions carved into it stays at one
   ([ADR-0006](./0006-bump-micromark-gfm-table-for-quadratic-edit-map.md)).
   This is the substantive difference from ADR-0020, which would have made it
   two — and, as ADR-0020 itself observed, "two exceptions is a pattern, not an
   accident."

3. **`package.json` is not modified *at all*, including its `scripts` block** —
   adding a script key fails G0 exactly as adding a dependency does. The gate is
   wired instead as a test under `tests/`, which rides the existing
   `unit` lane (`pnpm exec vitest run --coverage`) already bound to task
   completion and commit in `.claude/tdd-guardian/config.json`. No new lane, and
   no new command anyone has to remember to run.

4. **The identity-selector loophole is a known, deliberate gap.**
   `useXStore((s) => s)` defeats the rule's purpose but carries one argument, so
   it is not caught. It occurs zero times today. Catching it means inspecting
   the arrow body, which is a different and larger rule. This is recorded in the
   checker's doc comment so the next reader does not mistake it for an
   oversight.

5. **The scope is this rule.** "0023 did it" is not an argument for
   reimplementing a linting programme in-house, the same limit ADR-0006 and
   ADR-0020 both set on themselves. A future rule that genuinely needs type
   information, cross-file resolution, or a plugin ecosystem is a new decision,
   and ADR-0020's Context remains the honest starting point for it.

## Consequences

**What this gives up.**

- **We now maintain a parser-based linter.** It is ~one rule of hand-written AST
  walking that nobody else tests, upgrades, or fixes. ESLint's rule would have
  been three lines of configuration maintained by other people. Every future
  rule pays this cost again, and the second or third one is where the
  in-house-linter judgement should be revisited rather than assumed.
- **It is coupled to the TypeScript compiler API**, which is explicitly not a
  stable public API across versions. A `typescript` bump can break the walk.
  That is a real maintenance edge the ESLint route would not have had, partially
  offset by the version being pinned (`~5.8.3`) and by the tests failing loudly
  rather than silently if it moves.
- **It gives no protection outside this one rule.** The repository still has no
  linter, no formatter, and 16 orphaned `eslint-disable` comments suppressing
  rules from plugins that are not installed. Anyone reading "there is a lint
  gate" will over-estimate coverage exactly as ADR-0020 warned they would about
  a one-rule ESLint. The hazard is not avoided by this decision, only relocated.
- **Enforcement still depends on a lane being run**, because no CI exists. That
  is weaker than a CI gate and must not be described as equivalent.

**What it forecloses, and what it does not.**

- It does not resolve the A7/G0 tension about devDependencies in general. That
  argument is deferred, not settled, and the next proposal starts from first
  principles.
- It does not decide the 16 suppressions. They remain inert and remain debt.
- It makes adopting ESLint later *cheaper*, not harder: the rule's behaviour is
  pinned by tests that are independent of how it is implemented, so swapping the
  implementation for an ESLint rule is a refactor with a green suite to land
  against.

**What it does not claim.**

- That the rule is complete. Decision 4 names a live gap, and the rule forbids
  whole-store subscription without enforcing anything about `getState()` use in
  callbacks — which is the other half of rule 50 §1, still unenforced.
- That ESLint would have been wrong for this project in general. It would have
  been disproportionate for *one syntax rule* given that a parser was already
  installed. That is a claim about this rule and this moment, not about ESLint.
