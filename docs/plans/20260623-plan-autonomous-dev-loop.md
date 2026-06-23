# Plan — Autonomous Dev Loop for mdpro (vmark methodology port)

**Date:** 2026-06-23
**Author:** Jack + Claude
**Status:** Phase A landed (code-side) — auto-merge OFF pending human gate setup

> **Implementation status (2026-06-23).** Phase A code-side work items are landed
> across 4 commits (`e6a6f2e`, `0f70a5d`, `ca6205e`, `1e9e82c`):
> **WI-0, WI-1, WI-2, WI-3, WI-4 (wiring), WI-11, WI-12, WI-13, WI-14, WI-15.**
> Auto-merge remains **disabled** by design. Two human-only steps remain before it
> can be safely re-enabled (the WI-1 re-enable):
> 1. Create a fine-grained `PAT_TOKEN` repo secret (contents + PR write) so bot-PR
>    pushes re-trigger CI (WI-4). Until then the workflows fall back to `github.token`.
> 2. In branch protection, mark these required status checks: `ai-verifier`,
>    `frontend (macos-latest)`, `frontend (ubuntu-latest)`, `rust-test (macos-latest)`,
>    `rust-test (ubuntu-latest)`. Then run the **Bootstrap Loop Labels** workflow once.
> Phase B (WI-5/6/7) and Phase C (WI-7b/8/9/10) are **not** started — deferred per plan.
**Source of study:** [`xiaolai/vmark`](https://github.com/xiaolai/vmark) — a Tauri 2 + React 19 Markdown editor "whose entire codebase is written by AI." Investigated its `.claude/`, `.github/workflows/`, and last-7-day commit/PR history.

---

## 1. Goal

Develop mdpro features and fix bugs with **minimal human involvement** by adopting the self-automation methodology vmark refined over 107 days (458 audit issues opened/closed, 122 PRs, \$915 spend). The human role shrinks to: filing intent (issues), reviewing the daily cost/ledger, and approving structural changes — not writing routine fixes.

## 1a. Decisions (interview, 2026-06-23)

These resolve the open questions and lock the build direction:

| Decision            | Choice                          | Implication                                                                                                                                                                                                                          |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Merge autonomy**  | **Auto-merge, fully gated**     | Bot PRs merge unattended once the CI matrix checks **and** the head-SHA-bound `ai-verifier` check-run are green (all required in branch protection). No per-PR human approval. Makes WI-1 + WI-4 + WI-11 + WI-12 hard prerequisites. |
| **Verify strategy** | **Both — defense in depth**     | Keep Codex gate on the fixer (cross-model) **and** add the read-only Claude verifier on the PR (independent same-model read). Accept \~2x verify cost; `fix-attempted` brake offsets it.                                             |
| **Loop scope**      | **Janitorial + small features** | Loop handles audit findings *and* issues explicitly labeled `small-feature`. Larger/risky features still go through local `/feature-workflow`. See guardrails in §3a.                                                                |
| **Throughput**      | **1/run now, batch later**      | Stay single-issue until Phase A safety gates are proven green, then enable the capped matrix (WI-8).                                                                                                                                 |

## 2. Key finding — mdpro is already 70% there

mdpro and vmark use the **same toolkit** (xiaolai's `cc-suite` / `tdd-guardian` ecosystem). mdpro already runs the core loop:

| mdpro asset                                | What it does                                                                                                                                        | vmark equivalent                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.github/workflows/claude-audit.yml`       | Every 2h: auditor reads code, run\_id-seeds RNG to pick 5–6 of **17 dimensions**, files `audit`-labeled issues. `contents: read` (least-privilege). | `claude-audit.yml` (3 of 19 dims) ✅ already better-covered               |
| `.github/workflows/claude.yml`             | Every 30 min: picks oldest open `audit` issue → fix branch → PR → **auto-merges bot PRs**. Handles `@claude` mentions + PR review.                  | `claude.yml` (the fixer) — but mdpro is **missing the verifier gate** ⚠️ |
| `.github/workflows/cc-audit-fix.yml`       | Hourly: same fix loop **with a Codex review gate** (critical/high/med only, ≤2 iterations) before PR.                                               | vmark's `/fix-issue` Codex loop — mdpro has this in the cloud ✅          |
| `.github/workflows/claude-cost-report.yml` | Daily cost report issue.                                                                                                                            | `claude-cost-report.yml` ✅                                               |
| `.github/workflows/ci.yml`                 | PR/push **gates: `frontend` + `rust-test`** on macOS + Ubuntu. `pnpm audit` / PR-time `cargo audit` run but are **`continue-on-error` (advisory, non-gating)** — see §5 / GAP-14. | `ci.yml` ✅                                                               |
| `.claude/agents/` (9 agents)               | planner, spec-guardian, impact-analyst, implementer, auditor, test-runner, verifier, manual-test-author, release-steward.                           | Identical 9-agent pipeline ✅                                             |
| `.claude/commands/`                        | `fix-issue`, `feature-workflow`, `audit-fix`, `merge-prs`, `ship`, `mecha-audit`, `bump`.                                                           | `/fix-issue`, `/feature-workflow` ✅                                      |
| `.claude/rules/` 00–60                     | engineering, TDD, logging, careful-mode, design system, version-bump, conventions, review-checklist.                                                | `.claude/rules/` ✅                                                       |

**Conclusion:** Do not rebuild the loop. Port the **hard-won safety/quality refinements** vmark added *after* watching the loop misbehave for 100+ days. Each vmark mitigation is annotated in its YAML with an audit ID (e.g. "audit 20260612 H25/H26") — these are scars, not theory.

> ⚠️ **Strategic caveat from vmark:** xiaolai **retired** the autonomous loop on 2026-06-17 (commit `4fc9270`). Reasons: OAuth token silently expired \~2026-06-03 (loop ran as a no-op for 2 weeks unnoticed), and cost moved to external tracking. The wiring was preserved (`workflow_dispatch`-only) for revival. **Lessons baked into this plan:** (a) add a liveness check so a dead loop screams (WI-6); (b) vmark found the loop is safest on *janitorial breadth* (audit-fixes), and moved *features* to human-supervised local `/feature-workflow`. **We diverge deliberately** (§1a decision): the loop also takes *bounded* small features via the `small-feature` label + §3a rails — but everything larger stays human-driven.

---

## 3. Gap analysis — what vmark has that mdpro lacks

Ordered by impact. These are the deliverables.

### GAP-1 (BLOCK) — No independent verifier gate before auto-merge

mdpro's `claude.yml` does `gh pr merge "$PR_NUMBER" --auto --squash` for any `claude[bot]` PR. The **same** session that wrote the fix is implicitly trusted; merge is gated only on CI green. vmark runs a **second, separate, read-only Claude session** that re-reads the issue + diff, answers 3 questions (addresses finding? regressions? minimal & focused?) and renders a verdict.

> **Eng-review correction (T1, A1):** vmark's primitive — a `✅ VERIFIED` *PR comment* parsed line-anchored — is structurally unsound here. A comment is **not bound to the head SHA** and is **not a required status check**, so a later push (or the racing second fixer, GAP-12) can change the diff *after* the ✅ while the stale comment still satisfies a `grep`-based gate → unverified code auto-merges. The fix is the same outcome via the correct primitive: the verifier emits a **named check-run&#x20;********`ai-verifier`********\*\*\*\*\*\*\*\* bound to the PR head SHA**, marked required in branch protection. GitHub then enforces "merge only if `ai-verifier` is green on *this* SHA" natively — no comment parsing, no SHA-staleness hole, no edited-comment/spoofing surface. **WI-1 is reframed accordingly.** This is the single biggest quality gap.

### GAP-2 (BLOCK) — No `fix-attempted` retry-breaker

mdpro picks `sort_by(.createdAt) | .[0]` — the *oldest open* `audit` issue — every run. A chronically un-fixable issue (e.g. ambiguous, or gates always fail) **blocks the queue forever**: every 30-min run retries the same dead issue and re-burns budget. vmark adds label `fix-attempted` on failure and **excludes** it from collection, so the loop moves on. Without this, mdpro's loop can get permanently stuck on issue #N.

### GAP-3 (MUST) — Unrestricted `Bash` tool = prompt-injection blast radius

mdpro fix jobs pass `--allowedTools Bash,Read,Write,Edit,Glob,Grep,MultiEdit` — an **unrestricted shell**. vmark scopes it: `Read,Write,Edit,Glob,Grep,MultiEdit,Bash(git:*),Bash(gh:*),Bash(pnpm:*),Bash(cargo:*)` (vmark audit 20260612 H26: "an unrestricted shell plus a PAT is a prompt-injection blast radius"). An audit issue body is attacker-influençable text (anyone can file an issue); a fixer reading it with unrestricted Bash is exploitable.

### GAP-4 (MUST) — CI may not run on bot PRs (`github.token` vs PAT)

mdpro checks out and pushes with `${{ github.token }}`. **GitHub does not fire&#x20;********`workflow`********\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*/********`pull_request`************&#x20;events for pushes made with \*\*\*\*\*\*\*\*\*\*\*\*********\*\*\*\*****`GITHUB_TOKEN`** — so a bot-opened PR may auto-merge **without&#x20;********`ci.yml`********\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\* ever running**. vmark uses a dedicated `secrets.PAT_TOKEN` specifically so bot pushes re-trigger CI. **Verify current behavior first** (claude-code-action may use its own app token that does trigger CI); if CI is skipped on bot PRs, this is a correctness blocker — auto-merge with no gate.

### GAP-5 (SHOULD) — Audit issues aren't strict machine-readable fix-specs

mdpro's auditor prompt asks for "file path + line, impact, suggested fix" — good, but loose. vmark mandates **ONE file / ONE concern per issue** and a fixed body schema (`## Problem / ## Location (file:line) / ## Suggested Fix (step-by-step) / ## Scope Guard / ## Verification`) with GOOD-vs-BAD examples, because "the issue body IS the agent's only context." Tighter specs → higher first-pass fix rate → lower cost and fewer `fix-attempted` dead-ends.

### GAP-6 (SHOULD) — No liveness/heartbeat check

Directly from vmark's retirement post-mortem: the loop was a silent no-op for 2 weeks. mdpro has the same exposure (expired `CLAUDE_CODE_OAUTH_TOKEN`, quota, or a workflow error). Need a heartbeat: if no `audit` issue has been opened or closed in N hours, alert.

### GAP-7 (SHOULD) — No issue templates

mdpro has no `.github/ISSUE_TEMPLATE/`. Structured `bug_report.yml` / `feature_request.yml` forms make **human-filed** issues feed the same pipeline cleanly (the fixer expects a predictable shape).

### GAP-8 (NICE) — No dependency-hallucination ("slopsquatting") gate

vmark's `60-ai-governance.md` + `scripts/check-new-deps.sh` flag any new npm dep that doesn't exist / is <30 days old / has <1000 weekly downloads ("LLMs hallucinate package names at 5–22%, USENIX 2025"). When an AI adds dependencies autonomously, this is real protection. mdpro has `pnpm audit` (CVEs) but nothing for hallucinated/typosquatted packages.

### GAP-9 (NICE) — No per-run cost cap / matrix batching

mdpro fixes **1 issue per run** (safe, slow). vmark batches ≤6 issues/run (`max-parallel: 3`) with an explicit cost rationale ("\~$5/issue × 6 = ~$30 max"). Optional throughput upgrade once safety gates (GAP-1/2/3) are in place — **do not batch before the verifier gate exists.**

### GAP-10 (NICE) — No hook-enforced TDD on high-risk paths

vmark uses PreToolUse `.mjs` hooks that **block** (exit 2) edits to a scoped source file lacking a sibling test. mdpro has the `tdd-guardian` toolset and rule 10, but no hard machine gate. Consider only for specific high-risk dirs (e.g. `src-tauri/src/commands/`, `src/stores/`) — a global gate is too heavy.

### GAP-11 (BLOCK, eng-review/Codex B1) — The general `claude` job is an open injection surface

`claude.yml:111` fires the general `claude` job on **any** opened non-audit issue **and any** `@claude` comment, with `contents: write` + the OAuth token and **no&#x20;********`author_association`********\*\*\*\* filter** (only `!performed_via_github_app`). Anyone who can open an issue or comment can invoke a write-capable agent — a *larger* injection surface than the audit-fix loop the rest of this plan focuses on. Live today; must be closed before (or with) enabling unattended auto-merge. **Fix:** restrict to trusted `author_association` (OWNER/MEMBER/COLLABORATOR), a trusted label, or manual dispatch.

### GAP-12 (BLOCK, eng-review A2) — Two fixers race the same queue

`claude.yml` (audit-fix, :00/:30) and `cc-audit-fix.yml` (:30) **both** run `gh issue list --label audit --jq 'sort_by(.createdAt)|.[0]'` under **different** concurrency groups (`audit-fix` vs `cc-audit-fix`), so they don't serialize. At :30 they can pick the **same** oldest issue, both `git checkout -b fix/audit-N`, both `git push origin --delete fix/audit-N` (claude.yml:92), and stomp each other → duplicate PRs, a branch deleted out from under a run, doubled cost. The plan previously treated the loop as one queue. **Fix:** before unattended auto-merge, either claim an atomic `fixing` lock label before work (release after), or **retire one fixer** — the Codex-gated `cc-audit-fix.yml` is stronger and is the recommended sole fixer.

### GAP-13 (MUST, eng-review/Codex Q1 — verified live bug) — Fixer prompts run `cargo check` against a nonexistent path

`claude.yml:89` and `cc-audit-fix.yml:77` instruct the agent to run `cd src-tauri && cargo check --manifest-path src-tauri/Cargo.toml`. After `cd src-tauri`, `--manifest-path` resolves to `src-tauri/src-tauri/Cargo.toml`, which **does not exist**. `ci.yml:79` does it correctly (`cargo test --manifest-path src-tauri/Cargo.toml` from repo root, no `cd`). So every Rust-touching autonomous fix runs its self-prescribed gate against a bogus path today. **Fix:** drop the `cd` — one-line change matching `ci.yml`.

### GAP-14 (SHOULD, eng-review A4) — "CI green" overstates the merge gate

`ci.yml:35` runs `pnpm audit` with `continue-on-error: true`, and `:87` runs `cargo audit` with `continue-on-error` on `pull_request`. So **neither security audit gates merge on PRs**. With autonomous deps possible (slopsquatting gate is only Phase C / WI-9), "auto-merge once CI is green" overstates the gate. **Fix:** either make `pnpm audit`/`cargo audit` gating on PRs, or state explicitly that "CI green" = build+test only until WI-9 lands.

---

## 3a. Guardrails for autonomous small-features (per the §1a scope decision)

vmark restricted its loop to janitorial work because *autonomous feature design* is where AI loops do the most damage (scope creep, bad architecture, plausible-but-wrong UX). You opted to also allow **small features** — so the loop needs extra rails the janitorial path doesn't:

1. **Explicit opt-in label only.** The fixer picks up a non-audit issue **only** if it carries the `small-feature` label. A human applies that label — that *is* the approval gate for feature work. Unlabeled feature issues are ignored by the loop (still available to local `/feature-workflow`).
2. **Hard size ceiling.** `small-feature` issues must be implementable in **≤3 files and ≤\~150 net lines**, with no new dependencies. The fixer comments and stops (adds `needs-human`) if the change exceeds this — same brake as the 3-file rule, applied to features.
3. **Spec-first.** A `small-feature` issue must include an acceptance-criteria checklist (what "done" looks like) and a UX note. Enforced by the feature issue template (WI-7). No spec → not loop-eligible.
4. **Verifier checks against the spec, not just regressions.** For feature PRs the verifier additionally confirms each acceptance-criterion is met and flags design-system violations (rules 30–34). A feature that "works" but breaks the design system is `❌ NOT VERIFIED`.
5. **Design-system + TDD apply.** Feature PRs must add tests (rule 10) and obey DESIGN.md / rules 30–34. The auditor/verifier prompts cite these explicitly.
6. **No new deps autonomously.** If a feature needs a dependency, the loop stops and asks — new deps are a human + slopsquatting-gate (WI-9) decision.

> **Net effect:** the `small-feature` label is the single human touch-point for feature work. Everything past the label is autonomous, but bounded so a runaway feature PR can't merge.

---

## 4. Roadmap (prioritized work items)

Each WI is sized to 1–3 commits. Land them in order — safety before throughput.

### Phase A — Safety gates (do first; the loop is currently merging un-verified bot PRs)

> **Order note (Codex review):** Auto-merge is **live and ungated today** (`claude.yml:140`). Land WI-0 first, and keep auto-merge OFF until WI-1 + WI-4 + WI-11 + WI-12 + WI-14 are all green.

- **WI-0 (Codex Consistency#1 / Sequencing#1, BLOCK): Stop the bleeding — disable auto-merge now.**
  Before any other change, remove the auto-merge step in `claude.yml` (`gh pr merge --auto --squash … || true`, `:133-140`) so bot PRs stop merging unattended while the gates don't yet exist. Bot PRs queue for human review in the interim. Also drop the `|| true` (Codex Feasibility#2) so a failed merge-enable is visible, never swallowed. Re-enable auto-merge only in WI-1, once `ai-verifier` + CI + single-fixer are proven. *Acceptance:* a new bot PR does **not** auto-merge; it waits for a human.

- **WI-1 (GAP-1): Add independent verifier gate to&#x20;********`claude.yml`********\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*.**
  **Reframed per eng-review T1/A1 and Codex Consistency#2/Completeness#1-2/Feasibility#1 — model judges, a deterministic step gates.** The verifier is a **dedicated workflow** triggered on bot PR `pull_request: [opened, synchronize]`, bound to `github.event.pull_request.head.sha` (a one-time post-create step can't satisfy "re-run on push"). Two stages, separated by trust:
  1. **Model stage (no write token):** run `anthropics/claude-code-action@v1` with **read-only tools only** (`Read,Glob,Grep` — *no* `Bash(gh:*)`, no `gh` token in env). It reads issue #N + the PR diff, answers (1) addresses the finding, (2) no regressions, (3) minimal & focused, and writes a **constrained verdict artifact** to a file: `{ "verdict": "pass"|"fail", "reasons": [...] }` against a fixed JSON schema.
  2. **Deterministic stage (`checks: write`):** a non-model shell/action step parses the artifact and **creates a check-run `ai-verifier` against the head SHA** with conclusion `success` only on a schema-valid `"pass"`. **Malformed, missing, or ambiguous artifact → `failure`** (fail closed). This step needs `permissions: checks: write` added to the job — the current workflow omits it.
  Mark `ai-verifier` a **required status check** in branch protection. Auto-merge is (re-)enabled at PR-open; GitHub holds it until `ai-verifier` + the CI matrix are green **on the current head SHA**, so a post-verification push re-runs the verifier instead of merging stale. No comment parsing; the model never holds a write token. *Acceptance:* (a) a deliberately-wrong fix PR → `failure` → no merge; (b) a correct one merges; (c) a push after a `success` does **not** merge until the verifier re-runs green on the new SHA; (d) a corrupted/empty verdict artifact → `failure`, not a pass.
- **WI-2 (GAP-2): Add&#x20;********`fix-attempted`********\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\* retry-breaker.**
  In `claude-audit`/`claude`/`cc-audit-fix` issue selection, change the jq to exclude issues already labeled `fix-attempted`. **The brake must be deterministic (eng-review T6/Q2):** add an `if: failure()` **workflow step** (not just a prompt instruction) that runs `gh issue edit N --add-label fix-attempted` + comments — so a turn-limit hit, an action timeout, or an agent that skips the instruction still flags the issue. Keep the prompt instruction too, but the shell step is the real brake. *Acceptance:* an issue whose run fails (including by timeout) is labeled `fix-attempted` and skipped next run; queue advances. Weekly human triage of `fix-attempted` issues.
- **WI-3 (GAP-3): Scope the Bash tool allow-list.**
  In `claude.yml` + `cc-audit-fix.yml`, replace `Bash` with `Bash(git:*),Bash(gh:*),Bash(pnpm:*),Bash(cargo:*),Bash(node:*)`. **Caveat (eng-review/Codex):** this is *accident-prevention*, **not injection-proof** — `node -e`, `pnpm` package scripts, and `cargo`'s `build.rs` still execute arbitrary code. Do not describe it as a security boundary; the real injection mitigation is WI-11 (gate who can invoke the agent). *Acceptance:* fixer still completes a normal fix; bare `curl`/`rm -rf` is denied.
- **WI-4 (GAP-4): Verify + fix CI-on-bot-PR.**
  Inspect a recent bot PR's Checks tab — did `ci.yml` run, or is it sitting in a **pending-approval** state (a known `GITHUB_TOKEN` behavior, not just "did it run")? If skipped/pending: provision a fine-grained `PAT_TOKEN` secret (contents+PR write) and use it **consistently (Codex Feasibility#3)** — for `actions/checkout` *and* passed to `claude-code-action`/`GH_TOKEN` so the agent's `git push` and `gh pr create` also use it (otherwise those silently fall back to `GITHUB_TOKEN` and CI still won't trigger). **Required-check names must be the actual matrix names (eng-review T5/A3):** `frontend (macos-latest)`, `frontend (ubuntu-latest)`, `rust-test (macos-latest)`, `rust-test (ubuntu-latest)` — *not* bare `frontend`/`rust-test`, which match nothing and leave the gate silently empty. (Alternative: add one aggregating `ci-passed` job and require only that.) *Acceptance:* a bot PR shows the four named matrix checks (or `ci-passed`) green before `--auto` merges; none sit pending-approval.
- **WI-11 (GAP-11, BLOCK): Guard the general&#x20;********`claude`********&#x20;job.**
  In `claude.yml`, add an `author_association` filter (OWNER/MEMBER/COLLABORATOR) and/or a trusted-label requirement to the `claude` job's `if:`, so an arbitrary issue/comment can't invoke a `contents: write` agent. **Also gate the PR-event path (Codex Completeness#6):** the `claude` job fires on *every* `pull_request` event too — restrict it to bot PRs / trusted authors and run PR review with minimal permissions, not blanket `contents: write`. *Acceptance:* an `@claude` comment or PR from a non-collaborator does not start the job; one from a collaborator does.
- **WI-12 (GAP-12, BLOCK): Resolve the two-fixer race.**
  **Decided (Codex Ambiguity#1):** **retire `claude.yml`'s audit-fix path** and keep the Codex-gated `cc-audit-fix.yml` as the **sole fixer** (`claude.yml` keeps only `@claude`/PR-review). This kills the queue race *and* collapses cost back to ~2x (R2). **Prerequisite:** `cc-audit-fix.yml` must first become a real gate — see **WI-14** (today it opens a PR even with unresolved findings). *Acceptance:* only one workflow ever opens fix PRs; two simultaneous runs never duplicate-PR or delete each other's branch.
- **WI-13 (GAP-13): Fix the&#x20;********`cargo check`********&#x20;path bug (live today).**
  In `claude.yml:89` + `cc-audit-fix.yml:77`, change `cd src-tauri && cargo check --manifest-path src-tauri/Cargo.toml` to `cargo check --manifest-path src-tauri/Cargo.toml` (run from repo root, no `cd`), matching `ci.yml`. One-liner; do it first. *Acceptance:* a Rust-touching fix run logs a real `cargo check`, not a missing-manifest error.
- **WI-14 (Codex Consistency#3/Feasibility, BLOCK): Make `cc-audit-fix.yml` a real gate.**
  Today its prompt says "if critical/high/medium findings remain after 2 iterations, **proceed** to step 7 and note them in the PR body" (`cc-audit-fix.yml:87-96`) — i.e. it opens an auto-mergeable PR *despite* unresolved findings. Since WI-12 makes it the sole fixer, this hole would be inherited. **Fix:** on unresolved medium-or-higher Codex findings after the iteration cap, **stop** — do not push/open a mergeable PR; label the issue `fix-attempted`/`needs-human` and comment. *Acceptance:* an issue whose Codex findings can't be resolved in 2 iterations does **not** produce an auto-mergeable PR.
- **WI-15 (Codex Completeness#5): Bootstrap required labels.**
  Add a one-time setup step/workflow that creates and validates every label the loop relies on — `audit`, `fix-attempted`, `fixing`, `needs-human`, `small-feature`, `loop-health` — before any workflow references them (a missing label makes `gh issue edit --add-label` fail, silently defeating a brake). *Acceptance:* all labels exist; failure-handling steps can always apply them.

### Phase B — Quality & resilience

- **WI-5 (GAP-5): Tighten the auditor issue schema.**
  Update `claude-audit.yml`'s prompt to mandate ONE-file/ONE-concern and the 5-section body schema with a GOOD/BAD example pair. *Acceptance:* new audit issues follow the schema; spot-check first-pass fix rate improves.
- **WI-6 (GAP-6): Add a loop-liveness heartbeat.**
  New tiny workflow (daily): if 0 `audit` issues were opened **and** 0 PRs merged in the last 48h, open/refresh a `loop-health` issue titled "⚠️ Autonomous loop may be dead". Cheap; no Claude call needed — pure `gh` + jq. *Acceptance:* manually expire the path (e.g. pause crons) and confirm the alert issue appears.
- **WI-7 (GAP-7): Add issue templates.**
  `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml` with fields matching what `/fix-issue` classifies on (labels `bug`/`feature`, repro, file area). The feature template includes an **acceptance-criteria checklist** + **UX note** (required by §3a). *Acceptance:* filing via template produces an issue the fixer can consume unchanged.
- **WI-7b (§3a): Enable bounded autonomous small-features.**
  Extend the fixer's issue selection to also pick issues labeled `small-feature` (in addition to `audit`). Add the §3a guardrails to the fixer prompt: ≤3 files / ≤\~150 net lines / no new deps; stop + `needs-human` label if exceeded; tests + DESIGN.md compliance required. Extend the verifier prompt (WI-1) to check acceptance criteria + design-system rules for feature PRs. *Acceptance:* a labeled `small-feature` issue with a clear spec is implemented, tested, and auto-merges through the verifier; an oversized one is stopped with `needs-human`. **Depends on WI-1.** **Deferred (eng-review T8) with measurable exit criteria (Codex Ambiguity#2):** do not ship until Phase A has run for ~2 weeks meeting all of: **zero bad merges**, **zero duplicate PRs**, **verifier verdict agreed with a human spot-check on ≥N sampled PRs**, and **the cost report includes every fixer run**. A 3-file/150-line ceiling bounds diff size, not product/UX/architecture risk, so the autonomous feature lane is the highest-risk item and goes last. **Queue semantics (Codex Ambiguity#3):** audit queue takes priority; `small-feature` capped at 1/day; never mixed into audit batching; an issue carrying both labels is treated as `audit`. The "no new deps" rule must be a **deterministic diff check** (Codex Risk#3), not just a prompt instruction — fail any autonomous PR that adds a dependency until WI-9 exists.

### Phase C — Throughput & hardening (only after A is green)

- **WI-8 (GAP-9): Per-run cap + small matrix.**
  Convert the single-issue fixer to a matrix capped at 3 issues/run, `max-parallel: 2`, with a stated cost ceiling comment. *Acceptance:* a backlog of 5 issues drains 3/run without exceeding the cap; verifier gate (WI-1) runs per PR.
- **WI-9 (GAP-8): Slopsquatting gate.**
  Add `scripts/check-new-deps.sh` (diff `package.json`/`Cargo.toml` vs base; flag new deps that don't resolve, are <30 days old, or <1000 weekly downloads) and call it in `ci.yml`. Add a short `61-ai-governance.md` rule documenting it. *Acceptance:* a PR adding a nonexistent npm package fails CI.
- **WI-10 (GAP-10): Optional PreToolUse TDD guard on high-risk dirs.**
  A `.mjs` PreToolUse hook (exit 2) requiring a sibling/inline test before editing `src/stores/**` or `src-tauri/src/commands/**`. Scope narrowly. *Acceptance:* editing a store without a test file is blocked; editing a component is not.

---

## 5. Cost & safety guardrails (carry-over wisdom)

- **Least-privilege already correct** on the auditor (`contents: read`) — keep it.
- **Cap spend per run** (WI-8) and watch `claude-cost-report.yml`; vmark steady-state was \$2–6/day, peaks to \$89 on bad days.
- **Never let the fixer touch >3 files** (already in mdpro's prompt — keep it; it's the scope-creep brake).
- **Never commit to master directly** (already enforced — keep).
- **"CI green" ≠ secure (eng-review T7/A4).** `pnpm audit` and PR-time `cargo audit` are `continue-on-error`, so they don't gate merge. Until WI-9 lands, treat "CI green" as build+test only; make the audits gating on PRs if you want dep-safety in the merge gate sooner.
- **`fix-attempted`****\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\* + 3-file cap + verifier gate** together are what kept vmark's cost bounded and its merges honest. Land all three.

## 6. When to use which lane

| Work type                                         | Lane                                                                                  | Human involvement               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| Lint/safety/dead-code/test-gap/a11y fixes         | **Autonomous cloud loop** (audit → fix → verify → auto-merge)                         | Review daily ledger only        |
| Bug from a user report                            | File issue (template) → loop or local `/fix-issue`                                    | File + glance at ledger         |
| **Small feature** (≤3 files, spec'd, no new deps) | **Autonomous loop** — apply `small-feature` label (§3a guardrails)                    | Write spec + apply the label    |
| Larger / multi-file feature                       | **Local** `/feature-workflow` (9-agent plan→build→verify) — *not* the autonomous loop | Drive the plan, approve commits |
| Big/risky plan (>500 lines, new deps)             | Local + **cross-model Codex review** (`/audit-fix`, `codex-preflight.sh`)             | Approve plan                    |

vmark's own trajectory: autonomous breadth-fixing for 100 days, then a deliberate shift of *feature* work to human-supervised local agents. We diverge deliberately: the loop also takes **bounded** small features, but only through the `small-feature` label + §3a rails. Everything bigger stays human-driven — the loop is a janitor and a junior, never an architect.

## 7. Risks & open questions

- **R1:** Auto-merge without a human is only as safe as its gates. Non-negotiable prerequisites before trusting unattended merges: WI-1 (head-SHA `ai-verifier` check-run), WI-4 (CI actually runs + correct required-check names), WI-11 (gate who can invoke the agent), WI-12 (single fixer / no queue race).
- **R2:** Two Claude sessions per issue (fixer + verifier) \~doubles per-issue cost — accepted (defense-in-depth decision). **But (eng-review P1):** because `cc-audit-fix.yml` and `claude.yml` are separate crons, an un-deduped queue can pay up to \~4 model passes/issue. WI-12 (single fixer) collapses this back toward the intended 2x — land it, don't just rely on `fix-attempted`.
- **R3:** Token/quota expiry (vmark's actual failure mode) — WI-6 heartbeat is the mitigation.
- **R4 (from §1a scope):** Autonomous small-features can produce plausible-but-wrong UX/design. Mitigated by the `small-feature` opt-in label (human gate), the ≤3-file/≤150-line ceiling, spec-first templates, and a spec-aware verifier (WI-7b) — and now **deferred until Phase A runs boring for \~2 weeks** (eng-review T8). If feature PRs prove low-quality, retreat to janitorial-only by dropping the `small-feature` selector.
- **R5 (new, eng-review B1):** The general `claude` job is a live injection surface today (any commenter → write-capable agent). WI-11 closes it; treat as a Phase-A blocker, not a nice-to-have.
- **Q1 — RESOLVED → WI-4:** Now an investigation task. Sharpened by eng-review: the real question is whether bot-PR checks **run or sit pending-approval**, and whether the required-check *names* match the matrix. **Do WI-4 + WI-13 first.**
- **Q2 — RESOLVED (defense in depth):** Codex gate on the **fixer** *and* Claude verifier check-run on the **PR**. Both ship — but via a **single fixer** (WI-12) so cost stays ~2x, not ~4x.

---

## 8. Suggested first commit set

Reordered after the Codex review: **stop the live ungated auto-merge first**, then land safety, then re-enable auto-merge only at the end.

1. `WI-0` — **disable auto-merge now** (`claude.yml:140`); it is live and ungated today. Everything below happens with auto-merge OFF.
2. `WI-13` — fix the `cargo check` path bug (one-liner) + `WI-15` bootstrap the required labels (cheap prerequisites).
3. `WI-11` — guard the general `claude` job, incl. PR events (closes the live injection surface, R5/B1).
4. `WI-4` — CI-on-bot-PR: run-vs-pending-approval, PAT used consistently, required-check = matrix names. (*Resolves Q1.*)
5. `WI-14` — make `cc-audit-fix.yml` a real gate (hard-fail on unresolved findings), **then** `WI-12` retire `claude.yml`'s fix path → single fixer.
6. `WI-2` — deterministic `if: failure()` `fix-attempted` brake + `WI-3` scoped Bash.
7. `WI-1` — split model/deterministic `ai-verifier` check-run (`checks: write`); **only now re-enable `--auto` merge** (biggest quality win; prerequisite for WI-7b).

Then Phase B (WI-5/6/7), and Phase C — with `WI-7b` (small-feature lane) **last**, after Phase A meets its measurable 2-week exit criteria.

---

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status        | Findings                                                                 |
| ------------- | --------------------- | ------------------------------- | ---- | ------------- | ------------------------------------------------------------------------ |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 0    | —             | —                                                                        |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 1    | issues\_found | 14 findings (5 verified concrete, incl. 1 new BLOCK + 1 correctness bug) |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | folded\_in    | 11 issues + 3 outside-voice → all folded (see decisions below)           |
| Plan Review   | `/cc-suite:review-plan` | Cross-model 2nd opinion (Codex gpt-5.5, high) | 1 | needs\_revision → folded | 18 findings; 8×P1. Verdict NEEDS REVISION → folded 2026-06-23 |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 0    | —             | —                                                                        |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | —             | —                                                                        |

- **CODEX:** Outside voice promoted 3 new items not in the plan — (a) **verifier-as-PR-comment is the wrong primitive**: a `✅ VERIFIED` comment is not bound to head SHA and is not a required check, so a post-verification push can still auto-merge; use a named check-run (`ai-verifier`) required by branch protection instead (this reframes WI-1); (b) **NEW-BLOCK** — the general `claude` job in `claude.yml:111` fires on *any* opened non-audit issue and *any* `@claude` comment with `contents: write` + OAuth token and no author-association gate — a bigger injection surface than the audit-fix loop the plan focuses on; (c) **correctness bug verified** — both fixer prompts run `cd src-tauri && cargo check --manifest-path src-tauri/Cargo.toml`, which resolves to the nonexistent `src-tauri/src-tauri/Cargo.toml` (`claude.yml:89`, `cc-audit-fix.yml:77`); every Rust-touching fix fails its own prescribed gate today. Also: two fixers (`claude.yml` + `cc-audit-fix.yml`) race the same oldest-issue queue with different concurrency groups (can double-fix / delete each other's branch); `pnpm audit` and PR-time `cargo audit` are non-gating so "CI green" overstates the gate; matrix check names (not bare `frontend`/`rust-test`) must be the required-status names in WI-4.
- **CROSS-MODEL:** Both reviewers agree on Phase-A-first sequencing, the `fix-attempted` brake, the Bash scope reduction (with the caveat that prefix allow-lists are accident-prevention, not injection-proof — `node -e`/`pnpm` scripts/`cargo build.rs` still execute arbitrary code), and that the loop should stay janitorial before features. **Tension:** the review accepted the plan's verifier-comment + line-anchored-parse design (GAP-1/WI-1); the outside voice calls that primitive structurally wrong and wants a head-SHA-bound required check-run. The outside voice is more compelling here — recommend reframing WI-1 around a check-run.
- **VERDICT:** ENG REVIEW NOT CLEAR — eng review required. 11 review findings + 3 promoted outside-voice items are open for the author's decision (interactive AskUserQuestion was deferred for relay; see the chat report for each finding, severity, and recommendation). No section was clean enough to bypass discussion. Re-run to CLEAR once WI-1 (verifier primitive), the `claude`-job guard, and the Cargo-path fix are folded into the plan.

**DECISIONS — RESOLVED & FOLDED IN (2026-06-23):** All five eng-review decisions were incorporated into the plan body. Re-run `/plan-eng-review` to confirm CLEAR.

- ✅ WI-1 verifier primitive → **head-SHA-bound&#x20;****`ai-verifier`****&#x20;check-run** required by branch protection (was PR-comment parse). Folded into GAP-1 + WI-1.
- ✅ Guard the general `claude` job → new **WI-11 (BLOCK)** + GAP-11 + R5; restrict by `author_association`/label.
- ✅ Two-fixer race → new **WI-12 (BLOCK)** + GAP-12; recommend retiring `claude.yml`'s fix path, keeping the Codex-gated `cc-audit-fix.yml` as sole fixer.
- ✅ Cargo-path bug → new **WI-13** + GAP-13; one-liner, step 1 of the commit set.
- ✅ Small-feature lane timing → **deferred** in WI-7b + R4 until Phase A runs boring for \~2 weeks.
- ➕ Also folded: matrix required-check names + pending-approval check (WI-4/A3), deterministic `if: failure()` brake (WI-2/Q2), Bash-scope "not injection-proof" caveat (WI-3), and the "CI green ≠ secure" note (§5/A4).

**CROSS-MODEL REVIEW (`/cc-suite:review-plan`, Codex gpt-5.5 high) — RESOLVED & FOLDED IN (2026-06-23):** Verdict was NEEDS REVISION; all P1s + key P2s folded:

- ✅ **WI-0 (BLOCK)** — disable the live, ungated auto-merge *first* (`claude.yml:140`), drop the `|| true`. New step 1 of the commit set.
- ✅ **WI-1 split** — model emits a schema-constrained verdict artifact with **no write token**; a deterministic step with `checks: write` creates the head-SHA check-run (fail-closed on malformed). Added dedicated verifier workflow on `pull_request: opened/synchronize` bound to `head.sha`.
- ✅ **WI-14 (BLOCK)** — `cc-audit-fix.yml` hard-fails on unresolved medium+ Codex findings (today it opens a PR anyway, `:87-96`) — verified true; closed before WI-12 makes it sole fixer.
- ✅ **WI-12 decided** — retire `claude.yml`'s fix path; `cc-audit-fix.yml` is the sole fixer.
- ✅ **WI-4 PAT consistency** — token passed to checkout *and* the action's `GH_TOKEN`.
- ✅ **WI-11 PR-event gating** — also restrict the `claude` job's `pull_request` path.
- ✅ **WI-15** — bootstrap required labels before workflows reference them.
- ✅ **WI-7b** — measurable 2-week exit criteria, queue semantics, deterministic no-new-deps check.
- ➕ §2 asset table: `pnpm/cargo audit` marked advisory/non-gating.

Re-run `/plan-eng-review` and `/cc-suite:review-plan` to confirm CLEAR before implementation.

