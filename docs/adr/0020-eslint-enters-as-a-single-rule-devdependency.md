# 0020. ESLint enters as a single-rule devDependency, behind its own G0 exception

## Status

Proposed — 2026-09-22

Not yet accepted. Nothing has been installed. `package.json` is unchanged.
This record exists so the dependency decision is made deliberately rather than
discovered after `pnpm add -D`.

## Context

WI-4.21 and WI-4.26 both require a lint rule and cannot start without one.
They sit on the critical path for Stage 4, and Stage 5 sits behind Stage 4.
There is no ESLint in this repository: `grep -i eslint package.json` returns
nothing, and there is no `.eslintrc*`, no `eslint.config.*`, no Prettier, no
Biome, and no other JS/TS linter or formatter of any kind. The only TS-level
gate is `tsc`, run twice (`pnpm build` over `src`, `pnpm typecheck:tests` over
`src` + `tests`).

**What the work items actually need is one rule.** WI-4.21 requires a core
`no-restricted-syntax` rule forbidding zero-argument Zustand hook calls — the
rule 50 §1 convention that a component must not destructure a store at its top
level. WI-4.26 adds no rule of its own; it consumes WI-4.21's. Neither needs
type information, so neither needs `typescript-eslint`, and the AST selector
string is not specified anywhere in the plan corpus — it has to be written.

### The gate this runs into

G0 is the only numbered gate for this effort and it runs at the end of every
work item and every stage. `docs/plans/20260911-ui-redesign/baseline-protocol.md:118`,
verbatim:

> No new dependency: `git diff package.json src-tauri/Cargo.toml` is empty,
> apart from the **four** E7/E28 devDependencies, which land in WI-0.0's chore
> PR before Stage 0 — not in WI-1.0. […] From the WI-0.1 baseline onward this
> check does start from zero on `package.json`

That check is mechanical and does not distinguish a devDependency from a
runtime one. Any `package.json` diff fails it.

A7 (`docs/plans/20260911-plan-ui-redesign.md:116`) reads differently and is
internally in tension:

> No new **runtime** npm or cargo dependency […] The only exception is E7's
> test-only devDependencies — **four** at the E28 floors […]

A7's *prohibition* is scoped to runtime, which would leave devDependencies
unmentioned. But A7's *exception* is four named devDependencies — and an
exception is only needed for something otherwise forbidden. The two halves
cannot both be read literally. G0 is the half that actually executes, and it
blocks.

The only G0 exception ever granted is
[ADR-0006](0006-bump-micromark-gfm-table-for-quadratic-edit-map.md), and it
narrowed G0 on a different axis than the one that would help here — new
package versus patch bump of an existing transitive, not runtime versus dev.
ADR-0006:114 states its own scope: "The exception is scoped to this package
and this reason. It is not a general licence." A brand-new package falls on
the prohibited side of the line ADR-0006 actually drew.

The route the sequencing doc recommended is closed. Line 469 said to fold
ESLint into the Stage 1 chore PR that was already touching `package.json`.
That PR (WI-0.0) landed on 2026-09-12, and G0:118 records that the check
"does start from zero on `package.json`" from WI-0.1 onward. Row 1.10's
"a separate PR" says where the work happens; it never says how it clears G0.

### A premise that turned out to be unsupported

The task that prompted this work stated that ESLint is known to OOM under a
6 GB heap. **That claim has no source in this repository.** A direct search of
`docs/`, `specs/`, `scripts/`, `.github/`, `package.json`, `CLAUDE.md`,
`progress.md` and `.claude/` for `6 GB`, `max-old-space`, `NODE_OPTIONS`,
`out of memory`, `heap limit` and `JavaScript heap` returns zero matches.

The likely origin is a misattribution. The one place in the corpus where
"lint" carries a pathological performance number is
`docs/plans/20260912-frontend-backend-sequencing-order.md:415-417` (repeated at
[ADR-0006](0006-bump-micromark-gfm-table-for-quadratic-edit-map.md):145-150),
which measures a single **`@codemirror/lint`** callback at 1.6 s / 15.3 s /
22.7 s / 44.8 s across the four 472 KB fixtures. `@codemirror/lint`
(`package.json:27`) is a **runtime** dependency — the CodeMirror
markdown-table linter — and has nothing to do with ESLint. A 44.8-second lint
callback is the kind of thing that becomes "the linter blows up" in retelling.

This matters because it changes the shape of the task. There is no memory
problem to solve first. `src/` is 159 files and 21,296 lines; the required
rule is syntax-only and needs no type-aware program construction, which is the
`typescript-eslint` configuration that could plausibly exhaust a heap. If a
real OOM was observed, the terminal output should be produced before it shapes
any of this, because nothing in the repository corroborates it.

### Where enforcement can actually live

Stage 4c acceptance (`stage-4c-foundation.md:116-117`) requires that "the lint
rule rejects a new one" and that the ratchet is "**in CI** with its baseline
recorded". No CI runs on this branch. All four workflows trigger only on a
`v*` tag push or manual dispatch, and three carry in-file comments saying the
`pull_request` and push-to-branch triggers were deliberately removed to cut
Actions spend. `ci.yml` also omits `cargo clippy`, `cargo fmt --check`,
`pnpm ledger:check`, `pnpm typecheck:tests` and `pnpm coverage`. There are no
git hooks. Nothing in this repository runs automatically on a commit or a PR.

So the Stage 4c acceptance text assumes a CI that does not exist, and its
absence is a recorded cost decision rather than an oversight.

### The scope fork

There are 16 orphaned `eslint-disable` comments in `src/` and `tests/` today,
suppressing rules from plugins that are not installed:

| Rule | Count |
|---|---|
| `@typescript-eslint/no-explicit-any` | 13 |
| `react-hooks/exhaustive-deps` | 2 |
| `@typescript-eslint/no-implied-eval` | 1 |

Under a one-rule config they are inert comments. The day anyone adds
`typescript-eslint` or `eslint-plugin-react-hooks` — which plan M proposes as
a P1 improvement — all 16 become live suppressions, two of them on a
correctness rule. That is the fork between a small unblocking change and a
lint-adoption project, and it is cheaper to decide now than to discover after
the install.

## Decision

Add ESLint as a devDependency under a G0 exception scoped to this package and
this reason, with the smallest configuration that satisfies WI-4.21 and
WI-4.26:

1. **Two packages only**: `eslint` and `@eslint/js`. No `typescript-eslint`,
   no `eslint-plugin-react-hooks`, no `eslint-plugin-import`. The required
   rule is syntax-only.
2. **One rule**: a core `no-restricted-syntax` entry over zero-argument
   Zustand store-hook calls. Flat config in `eslint.config.js`, linting `src/`
   and `tests/`.
3. **The 16 existing `eslint-disable` comments are left exactly as they are**,
   and adopting any plugin that makes one of them live is a separate decision
   requiring its own record. In particular the two
   `react-hooks/exhaustive-deps` suppressions must be reviewed on their merits
   before that plugin is ever added, not silently inherited.
4. **Enforcement is a new `tdd-guardian` lane**, not CI. CI does not run on
   this branch by deliberate decision, so binding the rule to CI would produce
   an acceptance criterion nothing executes. Stage 4c's "in CI" wording is
   corrected to name the lane.
5. **The G0 exception is scoped to `eslint` + `@eslint/js` for the
   `no-restricted-syntax` rule.** It is not a licence for a linting programme,
   and "0020 did it" is not an argument for the next package — the same limit
   ADR-0006 set on itself.

## Consequences

**What this gives up.**

- G0's value is that it is mechanical and admits no argument. This is the
  second exception carved into it, and each one makes "is `git diff
  package.json` empty?" a question with a growing footnote. Two exceptions is
  a pattern, not an accident.
- `pnpm-lock.yaml` grows, and ESLint's own transitive tree is not small even
  for two direct packages. The WI-0.0 precedent cost 187 lockfile lines; this
  will cost more.
- A one-rule ESLint is a linter that passes on almost everything, which is
  itself a hazard: it creates the appearance of lint coverage the repository
  does not have. Anyone reading "ESLint is set up" will over-estimate what is
  checked.
- Choosing a new `tdd-guardian` lane over CI means enforcement depends on the
  lane being run, which depends on the agent workflow being followed. It is
  weaker than a CI gate and should not be described as equivalent.
- Deferring the 16 suppressions keeps them as a debt that grows quietly. Every
  new `any` written under the existing pattern adds to it.

**What it forecloses.**

- Adopting `typescript-eslint` later is now a two-step change — the plugin
  plus a decision on 14 suppressions — rather than a single install.
- It does not resolve the A7/G0 tension about devDependencies in general. The
  next devDependency proposal will have to argue from first principles again,
  because this record is deliberately scoped rather than generalising.

**What it does not claim.**

- That ESLint has a memory problem. No evidence of one exists in this
  repository, and the configuration chosen here cannot produce the type-aware
  workload that would cause one.
- That Stage 4 is unblocked by this ADR alone. WI-4.26's other prerequisite is
  Stage 3, whose WI-3.8 is not started.
