# Plan: Automated Small-Feature Loop (`small-feature`)

**Date:** 2026-06-24
**Status:** Proposed — **v3, hardened over two eng-review rounds** (not yet implemented)
**Depends on:** `20260623-plan-autonomous-dev-loop.md` (the audit-fix loop, validated 2026-06-24)
**Related memory:** `autonomous-loop-state.md`
**Review:** `/plan-eng-review` (round 1, v1 → *NOT CLEARED*, 3 BLOCK + 3 gaps; round 2, v2 →
*NOT CLEARED*, 1 new BLOCK + 3 MUST). v3 resolves the round-2 findings: the issue-body
TOCTOU BLOCK is closed via **body-hash pinning**, `deps-approved` is actor-checked,
`enforce_admins: true` replaces the infeasible OR-branch, and the permission API is
corrected. See §9.

---

## 0. One-paragraph summary (中文)

现有的 `cc-audit-fix.yml` 是一个 **audit 修复器**,只吃 `audit` 标签、改动 ≤3 文件的最小修复,**不能开发新功能**。本 plan 新增一条**解耦的** feature 流水线 `cc-feature.yml`:全流程为「**写 Plan → 建 issue 打 `small-feature` → 维护者审核打 `feature-approved` → workflow 自动拾取并开发(含测试)→ 确定性范围/依赖闸 + Codex 审计 + ai-verifier 验证 + CI → 合并**」。关键差异:feature 风险高,所以**多一道人工批准计划的闸**(`feature-approved`,既校验打标签者身份,又**锁定批准那一刻的 issue 正文哈希**——批准后改正文会被检出并停),范围/依赖上限是**确定性 CI 闸**而非 prompt 自觉,其余复用已验证的 gate。

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
3. APPROVE     A MAINTAINER (resolved by repo permission, not label association) adds
               `feature-approved`. An approval-recorder workflow verifies the approver and
               pins the issue-body hash at that instant (WI-F0). ← design gate
4. PICKUP      cc-feature.yml (manual dispatch during canary; cron later) selects the
               oldest eligible issue, RE-CHECKS the body hash matches the pinned one (else
               needs-human + halt), atomically claims it with the `fixing` lock (WI-F1).
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

### WI-F0 — Labels, actor-checked approval, and body-hash pinning `[resolves BLOCK-1, BLOCK-4, MUST-2, MUST-4]`
- Add to `bootstrap-labels.yml`: ensure `small-feature` (exists), and new labels
  `feature-approved`, `deps-approved` (WI-F8), and reuse the existing `fixing` lock.
- **Trigger contract:** the workflow acts only on issues carrying **both** `small-feature`
  *and* `feature-approved`. `small-feature` alone = a *request* awaiting human design review.
- **Actor check (the real auth boundary) — corrected mechanics `[MUST-4]`:** a label is
  mutable by anyone with triage access, so the label alone is NOT authorization. Resolve the
  approver's trust level by **repo permission**, NOT by `author_association` (label timeline
  events carry only `actor`, not an association):
  - Find the **latest** `labeled` event for `feature-approved` on the issue
    (`gh api repos/{o}/{r}/issues/N/timeline`), take its `actor.login` — using the *latest*
    event defeats a non-maintainer remove/re-add.
  - Resolve that login's permission: `gh api repos/{o}/{r}/collaborators/{login}/permission`
    → `.permission` is one of `admin` / `write` / `read` / `none`.
  - **Trust set (stated explicitly):** approve iff permission is `admin` or `write`. On a
    *user-owned* repo (anzchy/mdpro) trusted collaborators report as `COLLABORATOR`, never
    `MEMBER` — so an `OWNER`/`MEMBER` allowlist would silently mean owner-only. Gating on
    permission level avoids that trap and still admits the owner (always `admin`).
  - If permission is `read`/`none`/unknown → remove the label, comment, add `needs-human`, STOP.
- **Body-hash pinning (closes the issue-content TOCTOU) `[BLOCK-4]`:** the actor-check pins
  *who* approved, not *what* was approved — and the issue body is author-mutable after
  approval. An **approval-recorder** (a small `issues: labeled` workflow, or the first step of
  `cc-feature.yml`) MUST, at the moment `feature-approved` passes the actor-check, compute
  `sha256(issue.body)` and persist it in a hidden marker comment authored by the bot:
  `<!-- approved-body-sha256: <hex> @ <approval-event-id> -->`. Thereafter:
  - WI-F1 (before building) and WI-F3 (verifier) recompute `sha256(current issue.body)` and
    compare to the pinned value. **Mismatch ⇒ needs-human + halt / FAIL verdict** — fail closed.
  - The marker comment must be bot-authored; if a human/non-bot comment forges the marker,
    ignore it (only trust a marker on a comment whose author is the bot/PAT identity).
- **`deps-approved` is actor-checked too `[MUST-2]`:** WI-F8's supply-chain gate trusts
  `deps-approved`, so it gets the **same** approver-permission check (`admin`/`write`) as
  `feature-approved`. A triage-only account adding `deps-approved` does not satisfy the gate.
- **Acceptance:** (a) `small-feature`-only issue is never picked up; (b) `feature-approved`
  added by an `admin`/`write` collaborator pins a body-hash and makes the issue eligible;
  (c) `feature-approved` added by a `read`/none account does NOT make it eligible and trips
  the brake; (d) editing the issue body after approval makes the next pickup halt to
  needs-human (hash mismatch); (e) `deps-approved` added by a non-maintainer does not unlock
  the dependency gate.

### WI-F1 — `cc-feature.yml` (the feature builder) `[resolves: fixing-lock, id-token, PAT-footgun]`
- New workflow, `workflow_dispatch` only at first (cron commented, mirroring the audit loop's
  canary posture). Independent `concurrency: group: cc-feature`.
- `permissions:` contents/issues/pull-requests **write**. **Do NOT request `id-token: write`**
  — no OIDC/cloud-federation use exists; drop the unneeded credential surface.
- **PAT is required, not optional.** Use `secrets.PAT_TOKEN` directly. If it is unset, **fail
  loudly** in a preflight step — do NOT fall back to `github.token` (a silent fallback means
  bot pushes stop re-triggering CI, which looks green-but-isn't). This corrects the
  `PAT_TOKEN || github.token` footgun inherited from `cc-audit-fix.yml`.
- **Body-hash re-check (before any work) `[BLOCK-4]`:** recompute `sha256(current issue.body)`
  and compare to the pinned `approved-body-sha256` marker (WI-F0). Mismatch or missing marker
  ⇒ comment, add `needs-human`, STOP — do not branch or build.
- **Claim — concurrency is the real serializer `[NOTE-7]`:** `select → label fixing` is NOT a
  true compare-and-swap (a check-then-set race window exists). What actually prevents two runs
  double-picking is `concurrency: group: cc-feature` serializing the workflow. The `fixing`
  label is a *visible marker* plus a guard against a manual dispatch racing a future cron run:
  before working, add `fixing` to the selected issue; selection excludes any issue already
  labelled `fixing`; the `if: failure()` brake and the success path both remove `fixing`. Do
  not over-trust `fixing` as the atomicity guarantee — the concurrency group is.
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
- **Body-hash re-check at verify time `[BLOCK-4]`:** the verifier independently recomputes
  `sha256(current issue.body)` and compares to the pinned `approved-body-sha256` marker. A
  mismatch (body edited after approval) ⇒ `fail` verdict, regardless of how good the diff
  looks. This is a second, independent enforcement of the TOCTOU brake — the builder (WI-F1)
  could be bypassed by a future code path, but the verifier gates the merge.
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
- **Bypass remedy is `enforce_admins: true`, not a soft OR `[MUST-3]`:** `enforce_admins: false`
  lets an admin merge past a red check, and on a **user-owned** repo (anzchy/mdpro) the owner —
  who is the `PAT_TOKEN` identity — is *inherently* an admin and cannot be removed from bypass.
  So v2's "OR confirm the bot can't bypass" branch is **infeasible here** and is removed. The
  only real remedy before Phase 2 auto-merge is **`enforce_admins: true`**. (This also makes
  the human maintainer subject to the checks during canary — acceptable; emergencies use the
  WI-F9 runbook, not silent bypass.)
- **Forbid admin-override merges in automation `[MUST-3]`:** any Phase-2 auto-merge step uses
  `gh pr merge --auto --squash` ONLY. **Never `gh pr merge --admin`** — `--admin` is a distinct
  action that overrides even green-gate logic and would defeat the entire gate chain. Add a
  lint/grep check in CI that fails if `--admin` appears in any workflow file.
- **Check-name correctness:** required contexts must be the 4 matrix job names
  (`frontend (macos-latest)` etc.), not bare `frontend`/`rust-test`, plus the WI-F8 job name.
- **Ordering:** this WI runs **before** WI-F7 Phase 2, not after the builder.
- **Acceptance:** with `enforce_admins: true`, a test PR with a deliberately red required
  check cannot be merged even by the owner/PAT identity (demonstrated), and no workflow file
  contains `gh pr merge --admin`.

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
- New CI job that is **required** on master (WI-F5). Deterministic, not LLM judgment.
- **Always-run, ref-checked internally `[SHOULD-6]`:** do NOT gate the job with a job-level
  `if: startsWith(head.ref,'feat/feature-')` — a required check that is *skipped* is reported
  as **passing**, so a non-feature branch (or a renamed branch) would silently sail through.
  Instead the job runs on **every** PR, checks the ref *inside* the script, and explicitly
  passes (exit 0) for non-`feat/feature-*` PRs. Checkout with `fetch-depth: 0` so
  `<base>...HEAD` resolves.
  - **File-count gate:** `git diff --name-only <base>...HEAD | wc -l` > 10 ⇒ **fail**.
  - **Dependency gate:** if `package.json`, `pnpm-lock.yaml`, or `src-tauri/Cargo.toml`/
    `Cargo.lock` changed AND the issue lacks an **actor-checked** `deps-approved` label
    (verified per WI-F0/MUST-2, not merely present) ⇒ **fail**.
  - **Dependency audit becomes gating on feature PRs:** run `pnpm audit --audit-level=critical`
    and `cargo audit` *without* `continue-on-error` on `feat/feature-*` (they stay
    non-gating elsewhere). Corrects the "CI green ≠ dependency-safe" overstatement.
- **Acceptance:** a feature PR touching 11 files fails this check; a PR adding a dependency
  without an actor-checked `deps-approved` fails; a clean 3-file feature passes; a non-feature
  PR passes explicitly (not via skip).

### WI-F9 — Phase-2 rollback / incident runbook (new) `[resolves critical gap-3]`
- A short runbook (in this plan or `docs/runbooks/`) for "a bad feature auto-merged":
  1. **Stop the loop:** `gh workflow disable cc-feature.yml` (and re-comment the cron).
  2. **Revert:** there is no `gh pr revert`. Use `git revert -m 1 <merge-sha>` (the `-m 1`
     picks master as the mainline parent of a squash/merge commit) → push a branch → open a
     revert PR → land. (Or GitHub's web "Revert" button, which does the same.)
  3. **Quarantine:** label the source issue `needs-human`, comment the failure mode.
  4. **Postmortem:** if a gate let it through, tighten that gate before re-enabling.
- **Prerequisite to Phase 2** — autonomous merge is not enabled until this exists.
- **Acceptance:** the runbook is written and linked from WI-F7 Phase 2.

---

## 5. Safety properties (must hold)

1. **Design gate** — no code without a `feature-approved` applied by an `admin`/`write`
   account (permission-checked, not label-association). (WI-F0)
2. **Intent integrity** — the approved issue body is hash-pinned; any edit after approval
   trips needs-human at pickup AND a FAIL at verify. Approval covers *what* was approved,
   not just *who* approved. (WI-F0/F1/F3)
3. **Fail-closed verification** — no verdict, a malformed source issue, OR a body-hash
   mismatch ⇒ check fails ⇒ no merge. (WI-F3)
4. **Deterministic scope/dep brake** — >10 files or unapproved dep change ⇒ required check
   fails; the gate is always-run (skip≠pass) and `deps-approved` is itself actor-checked. (WI-F8)
5. **Required checks enforced & bypass-proof** — `enforce_admins: true`; no automation uses
   `gh pr merge --admin`; owner/PAT identity cannot merge past a red check. (WI-F5)
6. **Prompt-level scope brake** — agent bails to `needs-human` before the CI gate even runs. (WI-F2)
7. **Atomic claim** — `concurrency` group serializes runs; `fixing` is a visible marker. (WI-F1)
8. **Circuit breaker** — `fix-attempted` on failure removes the issue from the loop. (WI-F1)
9. **Rollback path** — a bad auto-merge has a written runbook. (WI-F9)
10. **Decoupling** — separate workflow + concurrency group; cannot disrupt the audit loop.
11. **Bounded privilege** — verifier stays read-only; builder uses scoped PAT and drops
    `id-token`. NOTE: `Bash(pnpm|npm|cargo|node:*)` is arbitrary code execution via build/
    package scripts — this is **accident-prevention, not injection-proof**. The design gate
    (WI-F0) is what bounds *who* can invoke the builder, not the tool allowlist.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Non-maintainer triggers the builder via a label | Permission-checked approver (`admin`/`write`), latest label event (WI-F0) |
| Author edits issue body **after** approval (TOCTOU) | Body-hash pinned at approval; mismatch ⇒ halt + FAIL (WI-F0/F1/F3) |
| Non-maintainer adds `deps-approved` to slip in a dep | `deps-approved` is actor-checked too (WI-F0/F8) |
| Owner/PAT merges past a red check via `--admin` | `enforce_admins: true`; `--admin` forbidden + grep-linted (WI-F5) |
| Required scope gate silently skipped ⇒ reported passing | Gate is always-run, ref-checked internally (WI-F8) |
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

`WI-F0 → WI-F6` (labels; permission-checked approver + body-hash recorder for `feature-approved`
*and* `deps-approved`; issue template; plan convention) →
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

## 9. Review resolution (v1 → v2 → v3)

### Round 1 (v1 → v2)
`/plan-eng-review` (+ Codex gpt-5.5, full cross-model agreement) returned **NOT CLEARED** on
v1 with 3 BLOCK items and 3 critical failure-mode gaps. v2 resolved each:

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

All 5 previously-unresolved decisions were resolved in favour of the safer option
(actor-check; deterministic gates; adopt `fixing`; gating audits on feat PRs; runbook before
Phase 2).

### Round 2 (v2 → v3)
Re-review of v2 confirmed all 3 round-1 BLOCKs closed *as scoped*, but found **1 new BLOCK +
3 MUST** — chiefly that the design gate still trusted a **mutable issue body** as the source
of intent. v3 resolves each:

| v2 finding | Severity | Resolution in v3 |
|---|---|---|
| Issue-body TOCTOU: author edits body after approval ⇒ bot builds malicious intent, verifier PASSes against the changed criteria | BLOCK-4 | **Body-hash pinning**: record `sha256(body)` at approval; re-check at pickup (WI-F1) **and** at verify (WI-F3); mismatch ⇒ halt + FAIL (WI-F0) |
| `deps-approved` not actor-checked ⇒ triage account bypasses supply-chain gate | MUST-2 | Same approver-permission check as `feature-approved` (WI-F0/F8) |
| `enforce_admins:false` + owner-is-admin on a user repo ⇒ OR-branch infeasible; `--admin` merge bypasses gates | MUST-3 | Require `enforce_admins: true`; forbid + grep-lint `gh pr merge --admin` (WI-F5) |
| `author_association` mechanics wrong (label events carry `actor`; `MEMBER` is org-only) | MUST-4 | Resolve via `collaborators/{login}/permission`; trust = `admin`/`write`; use the **latest** label event (WI-F0) |
| `gh pr revert` is not a real command | SHOULD | `git revert -m 1 <merge-sha>` → PR (WI-F9) |
| Job-level `if` ⇒ skipped required check reported as passing | SHOULD | WI-F8 is always-run, ref-checked internally, `fetch-depth: 0` |
| `fixing` select→label is not a true CAS | NOTE | `concurrency` group is the real serializer; `fixing` is a marker (WI-F1) |

The chosen source-of-intent fix is **body-hash pinning** (keeps the lightweight issue-driven
flow for the canary phase) rather than the heavier in-repo-plan-file approach; upgrade to a
protected in-repo plan file if/when Phase 2 auto-merge or external contributors arrive.

Re-run `/plan-eng-review` on v3 to confirm CLEARED before implementing.
