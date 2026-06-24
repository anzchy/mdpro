# Plan: Automated Small-Feature Loop (`small-feature`)

**Date:** 2026-06-24
**Status:** Proposed — **v2, hardened post-eng-review** (not yet implemented)
**Depends on:** `20260623-plan-autonomous-dev-loop.md` (the audit-fix loop, validated 2026-06-24)
**Related memory:** `autonomous-loop-state.md`
**Review:** `/plan-eng-review` + Codex gpt-5.5 outside voice — verdict *NOT CLEARED (v1)*;
this v2 resolves all 3 BLOCK items and 3 critical failure-mode gaps. See §9.

---

## 0. One-paragraph summary (中文)

现有的 `cc-audit-fix.yml` 是一个 **audit 修复器**,只吃 `audit` 标签、改动 ≤3 文件的最小修复,**不能开发新功能**。本 plan 新增一条**解耦的** feature 流水线 `cc-feature.yml`:全流程为「**写 Plan → 建 issue 打 `small-feature` → 维护者审核打 `feature-approved` → workflow 自动拾取并开发(含测试)→ 确定性范围/依赖闸 + Codex 审计 + ai-verifier 验证 + CI → 合并**」。关键差异:feature 风险高,所以**多一道人工批准计划的闸**(`feature-approved`,且校验打标签者身份),范围/依赖上限是**确定性 CI 闸**而非 prompt 自觉,其余复用已验证的 gate。

---

## 1. Goal & Non-Goals

### Goal
Enable: *author a plan → file a labelled issue → a workflow autonomously implements the
feature **with tests** → it is audited and verified → it merges* — without weakening any
safety property already proven on the audit-fix loop.

### Non-Goals
- **Large/architectural features.** This loop is for *small, well-scoped* features
  (roughly: one subsystem, a bounded file set, no schema/IPC-contract redesign). Anything
  bigger stays fully human-driven.
- **Skipping human design review.** A human MUST approve the plan before code is written
  (see WI-F0). Features are riskier than audit fixes; we do not let the bot invent scope.
- **Replacing the audit loop.** The two loops are independent workflows with independent
  concurrency groups and never touch each other.
- **Replacing app-shell QA.** Unit tests + build cannot prove a Tauri feature works in the
  packaged macOS shell. Feature PRs get a **human smoke-test in the app** during canary;
  this loop does not automate that. (Was silent in v1; made explicit per review.)

---

## 2. Why a new workflow (not a flag on `cc-audit-fix.yml`)

The audit fixer's contract is the opposite of a feature builder's:

| Dimension | `cc-audit-fix.yml` (audit) | `cc-feature.yml` (feature) |
|---|---|---|
| Trigger label | `audit` | `small-feature` **AND** `feature-approved` (actor-checked) |
| Input shape | cited file/line + exact fix | acceptance criteria + linked plan |
| Scope cap | ≤3 files, minimal fix | ≤10 files — **deterministic CI gate** (WI-F8) |
| Tests | optional (regression only) | **required** (rule 10) — CI proves they exist+pass |
| Turn budget | 50 | higher (≈80) |
| Branch prefix | `fix/audit-N` | `feat/feature-N` |
| Risk | low | medium → needs design-approval gate |

Forking the prompt and caps onto one workflow would couple two different risk profiles.
Keep them separate; reuse the shared gates (CI, ai-verifier, branch protection).

---

## 3. End-to-end flow

```
1. PLAN        Human (or /autoplan) writes docs/plans/<date>-feat-<slug>.md
               with: goal, acceptance criteria (checklist), affected files, test plan.
2. ISSUE       File an issue, label `small-feature`, body links the plan + pastes the
               acceptance-criteria checklist in the STABLE schema (WI-F6). (issue template)
3. APPROVE     A MAINTAINER reviews the plan and adds `feature-approved`. The workflow
               verifies the approver is OWNER/MEMBER before doing anything (WI-F0). ← design gate
4. PICKUP      cc-feature.yml (manual dispatch during canary; cron later) selects the
               oldest eligible issue, atomically claims it with the `fixing` lock (WI-F1).
5. IMPLEMENT   Branch feat/feature-N. Write tests first (red), implement (green), refactor.
               Respect DESIGN.md + .claude/rules. Bail to needs-human if scope blows the cap.
6. GATES       pnpm build · pnpm test:run · cargo check (if .rs). All green before commit.
7. AUDIT       codex review --base master (critical/high/medium must clear) +
               rule 60 pre-landing checklist self-audit.
8. PR          Push, open PR "feat: <title>" body "Closes #N", label small-feature.
9. VERIFY      CI (4 checks) + scope/dep gate (WI-F8) + ai-verifier (feature rubric,
               fires on feat/feature-*).
10. MERGE      Canary: human merges after app smoke-test. Autonomous (later): auto-merge
               once all required checks green AND bypass-proof protection confirmed (WI-F5).
```

The **design gate (step 3)** is the single most important addition vs the audit loop.

---

## 4. Work items

### WI-F0 — Labels & the actor-checked approval gate `[resolves BLOCK-1]`
- Add to `bootstrap-labels.yml`: ensure `small-feature` (exists), and new labels
  `feature-approved`, `deps-approved` (WI-F8), and reuse the existing `fixing` lock.
- **Trigger contract:** the workflow acts only on issues carrying **both** `small-feature`
  *and* `feature-approved`. `small-feature` alone = a *request* awaiting human design review.
- **Actor check (the real auth boundary):** a label is mutable by anyone with triage
  access, so the label alone is NOT authorization. The workflow MUST verify, via the issue's
  timeline/label events (`gh api .../issues/N/timeline` or events), that `feature-approved`
  was applied by an account whose `author_association` is `OWNER` or `MEMBER`. If it was
  applied by anyone else → remove the label, comment, add `needs-human`, and STOP.
- **Acceptance:** (a) `small-feature`-only issue is never picked up; (b) adding
  `feature-approved` *as a maintainer* makes it eligible; (c) adding `feature-approved`
  *as a non-maintainer* does NOT make it eligible and trips the actor-check brake.

### WI-F1 — `cc-feature.yml` (the feature builder) `[resolves: fixing-lock, id-token, PAT-footgun]`
- New workflow, `workflow_dispatch` only at first (cron commented, mirroring the audit loop's
  canary posture). Independent `concurrency: group: cc-feature`.
- `permissions:` contents/issues/pull-requests **write**. **Do NOT request `id-token: write`**
  — no OIDC/cloud-federation use exists; drop the unneeded credential surface.
- **PAT is required, not optional.** Use `secrets.PAT_TOKEN` directly. If it is unset, **fail
  loudly** in a preflight step — do NOT fall back to `github.token` (a silent fallback means
  bot pushes stop re-triggering CI, which looks green-but-isn't). This corrects the
  `PAT_TOKEN || github.token` footgun inherited from `cc-audit-fix.yml`.
- **Atomic claim:** before working, add the existing `fixing` label to the selected issue;
  selection excludes any issue already labelled `fixing`; the `if: failure()` brake and the
  success path both remove `fixing`. Prevents two overlapping runs double-picking one issue.
- Checkout with `PAT_TOKEN`; `claude-code-action@v1` with `github_token: PAT_TOKEN`, feature
  prompt (WI-F2), `--max-turns ~80`, allowedTools incl
  `Bash(git|gh|pnpm|npm|cargo|node|codex:*)`,Read,Write,Edit,Glob,Grep,MultiEdit.
- WI-2-style brake: `if: failure()` → label `fix-attempted`, drop `fixing`, comment, stop.
- **Acceptance:** dispatch with one eligible issue produces a `feat/feature-N` PR and the
  issue carries `fixing` during the run; with no eligible issue, the action step is skipped;
  with `PAT_TOKEN` unset, the run fails loudly at preflight (no silent github.token fallback).

### WI-F2 — Feature prompt (TDD + scope guardrails)
- Implement per the issue's **acceptance criteria** (not "minimal fix").
- **Tests required** (rule 10): write failing tests first, then code, run `pnpm test:run`.
  (Red-green *ordering* is prompt guidance only — it is unverifiable post-hoc, so it is NOT
  an acceptance criterion; see acceptance below.)
- Respect `DESIGN.md` and `.claude/rules/*` (cite rule 60 checklist in the PR body).
- **Scope cap 10 files / no dependency changes.** These are *also* enforced deterministically
  in CI (WI-F8) — the prompt cap is the first line, the CI gate is the backstop. If
  implementation would exceed the cap, touch a dependency manifest, or the acceptance criteria
  are ambiguous → comment, add `needs-human`, drop `fixing`, and stop — do NOT open a PR.
- Never commit to master. Branch + PR only.
- **Acceptance:** PR diff includes test files **that assert behaviour** (not wiring-only);
  gates pass; scope within the WI-F8 gate or graceful bail.

### WI-F3 — Extend `ai-verifier.yml` to feature branches `[resolves: checklist schema, turn budget]`
- Change the trigger filter to also match `feat/feature-`:
  `startsWith(head.ref,'fix/audit-') || startsWith(head.ref,'feat/feature-')`.
- **Feature rubric** (stricter than audit): the verdict must check (1) every acceptance
  criterion is met, (2) tests exist and assert behaviour (not wiring), (3) no scope creep
  beyond the plan, (4) DESIGN.md / rules respected, (5) no regressions. PASS only if all hold.
- **Acceptance-criteria parsing is defined, not assumed.** The PR body is `Closes #N`; the
  verifier fetches issue N and parses a **stable checklist schema** — a `## Acceptance Criteria`
  heading followed by `- [ ]` / `- [x]` items (defined in WI-F6). If the issue body is missing
  that section or is malformed, the verifier writes a `fail` verdict — it must **fail closed on
  a malformed source issue**, exactly as it already fails closed on a malformed `verdict.json`.
- **Turn budget:** feature verification reads plan + issue + diff + test files + rules — more
  than audit. Use **~45 turns** on `feat/feature-*` (audit stays at 30). Avoids the Bug-C
  `error_max_turns` failure mode on multi-file features.
- Keep the deterministic, head-SHA-bound, **fail-closed** check-run otherwise unchanged (reuse
  the proven Bug-C-fixed config: `Bash(gh:*)`, `issues: read`).
- **Acceptance:** (a) a feature PR gets a real PASS/FAIL `ai-verifier` verdict; (b) a missing
  verdict still fails closed; (c) a feature PR whose issue lacks a valid acceptance checklist
  gets a FAIL (not a shallow PASS).

### WI-F4 — Audit depth for features
- Two layers already exist and are reused: (a) Codex review in `cc-feature.yml` (critical/
  high/medium block the PR), (b) ai-verifier feature rubric.
- Add a `rule-60` self-audit checklist as a required PR-body section the verifier checks against.
- **Decision:** do NOT add a separate required CI check *for audit depth* unless canary shows
  the two layers miss things — avoid gate sprawl. (The scope/dep gate in WI-F8 is separate and
  IS required — it is deterministic, not judgment.)

### WI-F5 — Branch-protection adequacy & bypass-proofing `[resolves BLOCK-3]` — **prerequisite to Phase 2**
- The 5 required checks (`ai-verifier`, `frontend (macos-latest)`, `frontend (ubuntu-latest)`,
  `rust-test (macos-latest)`, `rust-test (ubuntu-latest)`) are already required on master
  (set 2026-06-24) and apply to feature PRs unchanged, since ai-verifier now also fires on
  `feat/feature-*` (WI-F3). Add the WI-F8 scope/dep job to required checks too.
- **Bypass verification (the part v1 missed):** `enforce_admins: false` means an admin can
  merge past a red check. The `PAT_TOKEN` owner is an admin. Before enabling Phase 2
  auto-merge, EITHER set `enforce_admins: true`, OR confirm the PAT/bot identity cannot bypass
  required checks (e.g. the bot is not in any bypass allowlist). Auto-merge's safety claim is
  false until this is verified.
- **Check-name correctness:** required contexts must be the 4 matrix job names
  (`frontend (macos-latest)` etc.), not bare `frontend`/`rust-test`.
- **Ordering:** this WI runs **before** WI-F7 Phase 2, not after the builder.
- **Acceptance:** a feature PR cannot merge unless all required checks are green, AND it is
  demonstrated (test PR with a deliberately red check) that the bot identity cannot merge it.

### WI-F6 — Plan + issue conventions (stable acceptance-criteria schema)
- Plan doc naming: `docs/plans/<YYYYMMDD>-feat-<slug>.md` with sections: Goal, Acceptance
  Criteria (checkbox list), Affected files, Test plan, Out-of-scope.
- Add a `small-feature` issue template with a **fixed** `## Acceptance Criteria` section of
  `- [ ]` items (this exact schema is what WI-F3's rubric parses and grades against) plus a
  link to the plan.
- **Acceptance:** filing from the template produces an issue whose acceptance checklist the
  verifier can parse; a free-form issue without the section is gradable-as-FAIL (WI-F3).

### WI-F7 — Canary rollout
- Phase 1 (canary): `workflow_dispatch` only; maintainer approves plan, dispatches, reviews
  PR + verdict + **app smoke-test**, hand-merges. Watch for a FALSE pass or scope creep the
  verifier missed.
- Phase 2 (autonomous): after several clean runs **and** WI-F5 bypass-proofing **and** WI-F9
  runbook exist, uncomment a cron and enable auto-merge.
- Mirror the audit loop exactly; do not enable cron + auto-merge on day one.

### WI-F8 — Deterministic scope & dependency gate (new) `[resolves BLOCK-2]`
- New CI job (in `ci.yml` or a dedicated workflow) that runs on `feat/feature-*` PRs and is a
  **required** check (WI-F5). Deterministic, not LLM judgment:
  - **File-count gate:** `git diff --name-only <base>...HEAD | wc -l` > 10 ⇒ **fail**.
  - **Dependency gate:** if `package.json`, `pnpm-lock.yaml`, or `src-tauri/Cargo.toml`/
    `Cargo.lock` changed AND the PR/issue lacks the `deps-approved` label ⇒ **fail**.
  - **Dependency audit becomes gating on feature PRs:** run `pnpm audit --audit-level=critical`
    and `cargo audit` *without* `continue-on-error` on `feat/feature-*` (they stay
    non-gating elsewhere). Corrects the "CI green ≠ dependency-safe" overstatement.
- **Acceptance:** a feature PR touching 11 files fails this check; a PR adding a dependency
  without `deps-approved` fails; a clean 3-file feature passes.

### WI-F9 — Phase-2 rollback / incident runbook (new) `[resolves critical gap-3]`
- A short runbook (in this plan or `docs/runbooks/`) for "a bad feature auto-merged":
  1. **Stop the loop:** `gh workflow disable cc-feature.yml` (and re-comment the cron).
  2. **Revert:** `gh pr revert <PR#>` or `git revert <merge-sha>` → PR → land.
  3. **Quarantine:** label the source issue `needs-human`, comment the failure mode.
  4. **Postmortem:** if a gate let it through, tighten that gate before re-enabling.
- **Prerequisite to Phase 2** — autonomous merge is not enabled until this exists.
- **Acceptance:** the runbook is written and linked from WI-F7 Phase 2.

---

## 5. Safety properties (must hold)

1. **Design gate** — no code without a *maintainer-applied* `feature-approved` (actor-checked). (WI-F0)
2. **Fail-closed verification** — no verdict, OR a malformed source issue ⇒ check fails ⇒ no merge. (WI-F3)
3. **Deterministic scope/dep brake** — >10 files or unapproved dep change ⇒ required check fails. (WI-F8)
4. **Required checks enforced & bypass-proof** — branch protection load-bearing; bot identity cannot bypass. (WI-F5)
5. **Prompt-level scope brake** — agent bails to `needs-human` before the CI gate even runs. (WI-F2)
6. **Atomic claim** — `fixing` lock prevents double-pick. (WI-F1)
7. **Circuit breaker** — `fix-attempted` on failure removes the issue from the loop. (WI-F1)
8. **Rollback path** — a bad auto-merge has a written runbook. (WI-F9)
9. **Decoupling** — separate workflow + concurrency group; cannot disrupt the audit loop.
10. **Bounded privilege** — verifier stays read-only; builder uses scoped PAT and drops
    `id-token`. NOTE: `Bash(pnpm|npm|cargo|node:*)` is arbitrary code execution via build/
    package scripts — this is **accident-prevention, not injection-proof**. The design gate
    (WI-F0) is what bounds *who* can invoke the builder, not the tool allowlist.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Non-maintainer triggers the builder via a label | Actor-check on `feature-approved` (WI-F0) |
| Bot builds the wrong thing | Maintainer design gate (WI-F0); acceptance-criteria rubric (WI-F3) |
| Scope creep / huge diff | Prompt cap (WI-F2) **and** deterministic 10-file CI gate (WI-F8) |
| Silent supply-chain risk via added deps | `deps-approved` gate + gating audits on feat PRs (WI-F8) |
| Tests that only "wire" not assert behaviour | Verifier rubric + acceptance asserts behaviour-testing (WI-F2/F3) |
| Malformed source issue ⇒ shallow PASS | Verifier fails closed on unparseable acceptance checklist (WI-F3) |
| Verifier false PASS on a feature | Canary: human merges + app smoke-test first; never auto-merge day one (WI-F7) |
| Auto-merge past a red check | Bypass-proof branch protection before Phase 2 (WI-F5) |
| Bad feature auto-merged | Rollback/incident runbook (WI-F9) |
| Double-pick race (esp. once cron lands) | `fixing` atomic claim (WI-F1) |
| `PAT_TOKEN` missing ⇒ CI silently not re-triggered | Fail loud at preflight, no github.token fallback (WI-F1) |
| Two loops collide on shared files | Independent concurrency groups; one issue at a time each |

---

## 7. Implementation order

`WI-F0 → WI-F6` (labels incl. actor-check + `deps-approved`, issue template, plan convention) →
`WI-F8` (deterministic scope/dep CI gate — required check) →
`WI-F3` (verifier filter + feature rubric + checklist parsing) →
`WI-F1 + WI-F2` (the builder) →
`WI-F5` (branch-protection adequacy + **bypass-proofing**) →
`WI-F9` (rollback runbook) →
`WI-F7` (canary, then graduate).

Land each as an atomic commit per the project convention. **WI-F5 and WI-F9 are hard
prerequisites to WI-F7 Phase 2.** Do not enable any cron or auto-merge until canary (WI-F7
Phase 1) has produced several clean runs.

---

## 8. NOT in scope (explicitly deferred)
- Large/architectural features — human-driven (§1).
- A separate required CI check for *audit depth* — deferred unless canary proves a gap (WI-F4).
- App-shell manual QA automation — feature PRs get a **human** smoke-test in canary (§1).
- Approval staleness / starvation handling — an approved issue can sit while master moves.
  Mitigation hook: WI-F2's agent should re-verify the plan against current master before
  building; full staleness automation is deferred.
- Priority queue — selection stays "oldest eligible"; no priority ordering yet.

---

## 9. Review resolution (v1 → v2)

`/plan-eng-review` (+ Codex gpt-5.5, full cross-model agreement) returned **NOT CLEARED** on
v1 with 3 BLOCK items and 3 critical failure-mode gaps. v2 resolves each:

| v1 finding | Severity | Resolution in v2 |
|---|---|---|
| `feature-approved` is a mutable label, not auth | BLOCK-1 | Actor-check (OWNER/MEMBER) on the approver (WI-F0) |
| Scope/dep caps are prompt-only, not gates | BLOCK-2 | Deterministic 10-file + dep CI gate, required (WI-F8) |
| Branch-protection bypass unverified, Phase 2 depends on it | BLOCK-3 | Bypass-proofing moved before Phase 2 (WI-F5) |
| No atomic issue claim (`fixing` unused) | MUST | Adopt `fixing` lock in WI-F1 |
| "CI green" overstated (audits non-gating) | MUST | Gating audits + `deps-approved` on feat PRs (WI-F8) |
| `id-token: write` with no OIDC use | MUST | Dropped (WI-F1) |
| Verifier acceptance-criteria parsing undefined | MUST | Stable checklist schema + fail-closed on malformed issue (WI-F3/F6) |
| `PAT_TOKEN || github.token` silent fallback | MUST (Codex) | Fail loud, no fallback (WI-F1) |
| Verifier 30-turn budget copied from audit | SHOULD | ~45 turns on feat branches (WI-F3) |
| "TDD ordering" as acceptance is unverifiable | SHOULD | Demoted to prompt guidance; acceptance asserts behaviour-tests exist (WI-F2) |
| No rollback runbook | CRITICAL GAP | WI-F9, prerequisite to Phase 2 |
| macOS app-shell QA silent | NOTE | Made explicit in §1 / §8 |
| "least privilege" claim overstated | NOTE | Softened in §5.10 (accident-prevention, not injection-proof) |

All 5 previously-unresolved decisions are now resolved in favour of the safer option
(actor-check; deterministic gates; adopt `fixing`; gating audits on feat PRs; runbook before
Phase 2). Re-run `/plan-eng-review` on v2 to confirm CLEARED before implementing.
