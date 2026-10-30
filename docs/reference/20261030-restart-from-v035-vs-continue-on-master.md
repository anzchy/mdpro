# Restart from v0.3.5 vs continue on master: the two evaluations (2026-10-30)

Evidence for [ADR-0160](../adr/0160-development-continues-on-master-under-a-feature-freeze-until-0-3-6.md). Both evaluations were read-only, run on the same brief. Codex could not write its file (EPERM), so its summary is the one relayed by the codex-rescue agent.

## Codex

Verdict: continue on master with a temporary feature freeze; finish #557 and the device checks, then lock and test a 0.3.6 SHA.
Use a release/0.3 branch from v0.3.5 only for an urgent hotfix to published users (ADR-0083).
Evidence: data-safety fixes f3488d0c, eb6ee0ce, 198f013c (CHANGELOG.md:17,30,44). Master is not release-ready: W036 partial and
not exercised (docs/test/20261028-w036-windows-menu-device-check.md:10); secondary-window close can quit and lose edits (CHANGELOG.md:10);
Linux shortcut collision (CHANGELOG.md:12). A reset does not fix the audit's gate and lifecycle-test gaps.
Main risk: master still carries a possible data-loss crash and incomplete device verification.

## Fable

## Branch evaluation: fork from v0.3.5, or continue on master? (Fable, read-only, 2026-10-30)

Repo `/Users/jack/Documents/mac-app/mdpro`. `v0.3.5` = `67715ea2` (2026-10-16). `origin/master` = `master` = `81bc8384`.
Nothing was edited, committed, branched or pushed. Every SHA below was checked with `git`; every GitHub fact with `gh`.

### 1. What is actually in `v0.3.5..master`

**Shape.** 481 commits: 273 docs, 114 fix, 34 feat, 25 test, 24 chore, 11 refactor. Of the 159 `fix`/`feat`/`refactor`
commits, by scope: ~64 are tooling (`tdd` 20, `control` 11, `test` 10, `ci` 4, `delegator` 4, `device` 3, `load-guard` 2,
`windows-driver` 2, `audit` 2, `deps` 2, …) and ~95 are product (`menu` 16, `settings` 12, `shortcuts` 8, `save` 6,
`editor` 5, `commands` 5, `window` 4, `open` 4, `draft` 4, `save-as` 2, `find` 2, `focus` 2, `dialogs` 2, …).

**The "+277k lines" is mostly one JSON file.** `git diff --numstat v0.3.5 origin/master` by directory:
`.claude/tdd-guardian` +135,104 (of which `receipts.json` +133,464, `evidence.json` +1,629); `src-tauri/src` +36,962/−1,849
(186 files); `tests/` root +43,451; `tests/tooling` +13,768; `src` +10,683/−2,255 (168 files); `docs/adr` +7,654 (57 files);
`docs/test` +6,898. Product source is ~48k of the 277k; the receipt registry is 49%; tests ~62k.

#### 1a. User-visible features (real value)

All from `CHANGELOG.md` `[Unreleased]` and the ledger diff (`git diff v0.3.5 origin/master -- docs/feature-ledger.md`):

| Feature | Commits | Ledger state change |
|---|---|---|
| Save As (real, with target-held and symlink races closed) | `242c0f9b`, `73dd0c1b`, `d410d1b5` | 另存为 `Stub` → `Shipped` |
| WYSIWYG Find & Replace (docked bar) | `d6aa1833`, `0351f880` | WYSIWYG 查找替换 `Absent` → `Shipped` |
| Switch Documents (MRU), Windows/Linux full-screen | `242c0f9b` | new `Shipped` rows |
| v2 command table + keyboard shortcut defaults across native menu, WYSIWYG, Source, Settings (M1a/M1b) | `b606c6dc`, `8662d432`, `5218b24e`, `d82cc220`, `d40a8db0`, `2c2cacb9`, `e5fa31e1`, `37e0e869`, `7b801703` | 快捷键改键 `Stub` → shipped-with-conflict-refusal |
| macOS menu rebuilt from the command table (M4) | `2a9fa451`, `e1cc7d11`, `c17ead3e` | — |
| Source-mode formatting commands (bold, italic, code, fences, math, lists, underline mark) | `5b88bf14`, `3b889b30`, `eab5bffd` | ~10 editing rows gain Source paths; 下划线 new `Shipped` |
| Settings: Keyboard Shortcuts page lists every command (M7), unified ToggleSwitch, outline rail, scrollable rail | `a555dbb9`, `b267473e`, `9a0aed26` | — |
| Image insert via native picker (`pick_image`) | `3b889b30` | 插入图片命令 / `pick_image` new `Shipped` |

Ledger totals: Shipped 82 → 99, Partial 68 → 78, Stub 14 → 11, Absent 30 → 29, Unknown 99 → 99.
One row went the other way: 保存 `Shipped` → `Partial` — not a regression, but a more honest state: D214's undo-clean behaviour
is "单元验证，真机未验" (`docs/feature-ledger.md`, row `| 保存 |`).

#### 1b. Data-safety fixes (the part Option 1 cannot afford to lose)

Every one of these is after `v0.3.5` (checked `git merge-base --is-ancestor <sha> v0.3.5` → no for `b94d302a`, `2ee2a0c3`;
the rest are dated 10-17 or later):

- **Save**: `f3488d0c` cancel stale saves after document replacement; `96a0ea5b` document lifetime vs baseline; `3ec32908`
  recheck before deferred writes; `e053a78e` ask before recreating an ignored deleted file (D290). `a7670312`, `592a47cd`,
  `ffa4d4d6`, `bb688100`, `7961e4a3` — D214 baseline epochs: undo-to-saved is clean, external change mid-save is *not* a
  clean point.
- **Close / window**: `b94d302a`, `6d3825e0` (D253) a secondary window closes with its last tab and the close guard decides in
  the pass that closes; `dd2312db` a held close reply never removes a reopened document; `277f329d`, `2d8d0f93` (D294 phases);
  `2a22c991` (D297) a tabless window mounts no editable editor, so typed text cannot vanish on close.
- **Draft / Recovery**: `eb6ee0ce`, `87d1e290` (D299, ADR-0127) another session's unrecovered draft is never erased;
  `3c2289ae`, `198f013c` (D305) Discard removes drafts written while the prompt was open, fenced by saved revision;
  `68610d32`, `db4ccfe1` (D241) Recovery waits for other modals and live MCP requests; `49adf213` (D273) focus trap;
  `dab5b6b1`, `699086e0` (D291) focus return.
- **Menu routing**: `8c46d9c0`, `a118914f`, `124311c1`, `527579af` (D261) a menu action goes to one window — before, every window
  acted on every click, so with two windows open Save could run in the wrong one; `e92fec44`, `698fdd77`, `9b9cd404`, `32fa5b96`
  (D319) the AppKit click-owner race, device-passed in B8b/B8c (`docs/test/20261025-b8b-b8c-d319-menu-race-device-check.md`).
- **Open routing**: `86404018`, `360c4e94`, `500dccc2` (D279) a second launch's paths go to one window.
- **Watcher**: `2ee2a0c3` (D246 H-1/H-2, ADR-0111) change→delete→recreate within 500 ms ends on "modified", not "deleted".
- **Settings**: `9e9943fe`, `2dd8b612`, `6e92438e`, `aecb0165`, `bcfd4415` (WI-4.3b, D293) one writer per settings group, no
  value "saved" that was never written.
- **Security**: `286eae60` ammonia 4.1.8 (RUSTSEC-2026-0373), `76d5f04b` drop updater `zip` (3 advisories, ADR-0122),
  rustls-webpki/webpki-root-certs (D304). `rust-audit-daily.yml` is green on master through 2026-10-30 (`d586c509`).

#### 1c. Test and tooling investment

Test files 727 → 1044 (`git ls-tree -r v0.3.5|origin/master tests | grep .test.`). Scripts 106 → 149 files. New
subsystems: receipt evidence + replay (`c010bab8`, `5647761d`, `scripts/tdd/`, ADR-0145/0149), load guard
(`681aeb5b`, `scripts/load-guard/`), verification control channel (`b8ba3679`…`acca8361`, ADR-0047 WI-009),
device identity (`e4d72b80`, `c77f3278`), Windows driver (`636116c3`, `f3aba360`), delegator skill (`.agents/` +2,019).
Churn signal: 20 `fix(tdd)` commits, 11 of them on 2026-10-29/30 alone (`cf183a31`, `bcfdd22d`, `d16db0fa`, …) — the
receipt mechanism was reworked repeatedly, which the outside audit also names (its item 7, PR #551, 27 commits).

#### 1d. Process docs

ADRs 109 → 156 (+47 in 14 days). Rules 14 → 16 files, +759 lines. `docs/audit/audit-log.md` 104 table rows, 61 gate-exception
rows. Receipts 311 → 866 entries. 68 PRs merged since 2026-10-16 (`gh pr list --state merged --search 'merged:>=2026-10-16'`).

#### Verdict on value vs churn

Real value: 1a and 1b in full (the product is substantively more capable and safer than v0.3.5), plus the security bumps.
Mixed: 1c — the control channel, identity check and load guard addressed real incidents (D326, the Mac mini OOM), but the
receipt/replay rework and the Windows driver are tooling that has consumed more fix rounds than the product code it guards.
Churn: a large share of the 273 docs commits are status fills, gate-exception rows and ADR revisions; +133k lines of
`receipts.json` is registry growth, not knowledge.

### 2. Quality of master now

**Build and tests.** The last non-docs commit on master is `5a5b0110` (2026-10-30). Its PR run on
`chore/adr0149-receipt-evidence` passed `ci-gate` (run 2026-10-30T07:15, `gh run list --workflow ci.yml`). PR #549's head
also shows `ci-gate pass`, `frontend (ubuntu-latest) pass 15m46s`, `rust-test (ubuntu-latest) pass`, `rust-audit pass`
(`gh pr checks 549`). So master builds and its unit lanes are green **on Linux**.
Caveat (confirmed): `.github/workflows/ci.yml:1-10` runs nothing on a push to master; `:84` and `:142` run macOS only on
`refs/tags/v*`. Branch protection has `enforce_admins: false` (`gh api repos/anzchy/mdpro/branches/master/protection`), so the
ci-gate requirement does not bind an admin push. Both are #556 problems 2 and 7.

**Known open defects** (`docs/plans/20260912-frontend-backend-sequencing-order.md`, 107 rows still marked 「已登记，未修」):
- D294 (line 731) BLOCK, High, carried to 0.3.7 under ADR-0129/0132: closing a secondary window at minimum width crashes WebKit
  (1/16 and 1/30 in device runs). `CHANGELOG.md:13` carries it as a Known issue.
- D313 (line 752) MUST: Linux-only — a v1 custom Save key of Ctrl+Shift+M highlights instead of saving after the v2 migration.
  **Introduced by M1b on master**; `CHANGELOG.md:12` Known issue, fix-by 0.3.7.
- D314 (line 753) MUST: first keystroke lost in Source after Recovery resolves (2/3 device runs, B1), moved to 0.3.7, root cause
  unproven.
- D321 (line 760) MUST: whole app quits after closing a second window with Don't Save — seen once in B9, 0/5 in B10; user ruled
  「Ship, keep row open」.
- D50 (line 488) NOTE: Windows Ctrl+Shift+L never reaches the shortcut handler — FAIL again in W036 (`8aeb1c19`). This predates
  v0.3.5 (first FAIL 2026-10-20 on `f1bac1c`, and v0.3.5 shipped the same binding).
- D336–D338 (line 775 ff.): Windows test-driver defects, blocking the W036 Windows menu batch.

**W036 device results.** `docs/test/20261028-w036-windows-menu-device-check.md:14-20`: D261, MENU-D261-WI-1, MENU-M3a,
D255-windows, D264 all NOT EXERCISED (driver failures D336/D337/D338); D50 FAIL. The macOS batches did better: B8b/B8c D319
PASS, B9 6 PASS, B2 4 PASS / 0 FAIL, B5 25 PASS lines but M3b and Switch Documents FAIL at the time (since fixed as D318/D320,
`77d53ba6` device-verified in B8). `CHANGELOG.md` `[Unreleased]` carries **15** entries still marked "device check pending".

**Is anything worse than v0.3.5 for a user?**
- Proven worse: D313, Linux only, only for users who had customised Save to Ctrl+Shift+M.
- Candidate, unproven: D294/D321. The faulting code path `src-tauri/src/commands/window_close_order.rs` does not exist at
  v0.3.5 (`git ls-tree v0.3.5 -- …` → empty) and D253 (`b94d302a`) is master-only, but the crash is in WebKit teardown frames
  (`WebPageProxy::dispatchSetObscuredContentInsets`, `ScrollingTree::takePendingScrollUpdates`; sequencing row 731), the
  hide/no-hide variants were indistinguishable, and v0.3.5 was never run through the same 30-close probe. It may well crash too.
- Everything else moved toward the user: D261 (wrong-window Save in v0.3.5) is fixed, D214 false-dirty prompts are gone,
  Save As exists, drafts from other sessions are safe.

### 3. Option 1 — fork from v0.3.5: cost and risk

**What is lost or must be redone.** Every item in §1b: ~30 product commits of save/close/draft/menu/open/watcher/settings
hardening, three security bumps, and the ADR-0111/0127/0132 decisions they implement. v0.3.5 still has D261 (every window acts
on every menu click — a wrong-window *save*), the D246 recreate-within-500ms "deleted" misreport, the WI-4.3b settings
never-saved values, and the three RustSec advisories. These are not optional polish; they are the data-loss class rule 60
calls BLOCK.

**Re-landing vs cherry-picking.** The product commits are interleaved with the command-table/menu rewrite (M1a/M1b/M4 touched
~170 files per the audit §3 item 4) and with ADR-0145/0149 receipt tooling that the tests reference (`tests/` +43k lines).
Cherry-picking `fix(save)`/`fix(draft)` onto v0.3.5 without the `baselineEpoch.ts`, `menu_layout.json` and `tabMru.ts` they
build on means re-resolving conflicts in `App.tsx` (985 lines), `commands/file.rs` (1,892 lines) and `useKeyboardShortcuts.ts`
by hand, each landing again through the rule-70 pipeline (verifier + two auditors + ci-gate) that Option 1 is trying to escape.
Realistically that is weeks of re-work to reach a state master already has.

**Release history and the updater.** `src-tauri/tauri.conf.json:62-64` points every installed 0.3.5 at
`releases/latest/download/latest.json`. A fork can still publish 0.3.6 from any branch (release.yml takes `ref=<sha>`,
ADR-0073), so the updater itself is not broken by a fork — but the published `latest.json` must come from exactly one lineage.
Two lineages (a v0.3.5-fork and a master that keeps 481 commits of CHANGELOG `[Unreleased]`) means the `[Unreleased]` section,
the ledger and 47 ADRs describe code the shipped build does not contain.

**Open work.** PR #549 (D332–D334), `fix/d336-d338-windows-driver` (`129a30f5`, worktree `mdpro-wt/gpt-imple-1`),
`fix/d50-windows-sidebar-shortcut` (`mdpro-wt/opus-imple-2`), `docs/specs/i556/r4` with issues #557–#563 and
`docs/specs/d50/r1` all have `master` as their base. The 866 receipts, 29 `refs/receipts/*` trees and 104 audit-log rows cite
master SHAs; `docs/specs/i556/r4/manifest.md` pins issue bodies by SHA-256 against the master tree. A fork orphans all of them.

**Rule 70 / ADR-0083.** `docs/adr/0083-…md` Decision 1: "`master` is the only permanent branch"; Decision 3 allows a
`release/x.y` branch cut from a tag only for a hotfix, cherry-picked *from* master ("upstream first"). A redevelopment branch
from `v0.3.5` is exactly the pattern ADR-0083 and ADR-0083's predecessor (`frontend-backend-redesign`, frozen) were written to
end; it would need a superseding ADR and would reopen the two-trunk drift that cost the 2026-10-12 consolidation.

**Does it remove the audit's problems?** No. The audit's own Executive Summary (`docs/audit/mdpro 工程质量…md:7`): 「目前更突出的是
Agent Harness 与验证体系的结构性缺陷，而不是产品代码普遍低质量」, and §十: 「最值得优先重构的不是整个 React/Rust 产品架构，而是代码交付与验证之间的接口」.
Its ten root causes (lines 101-117) are: Linux CI vs macOS reality, no lifecycle modelling, gates not machine-enforced,
`land-guard.mjs --docs-only` (confirmed at `scripts/codex-rules/land-guard.mjs:10`), dead `ai-verifier.yml` (confirmed:
`:3` workflow_dispatch only, `:25,:31` read `pull_request.*`), stale rules, receipt rework, Mac mini OOM. Every one of these lives
in `.github/`, `scripts/`, `.claude/` and the roster's habits — all of which a fork from v0.3.5 would carry over unchanged
(v0.3.5 already had the same `ci.yml` trigger shape, rules 70/71 and the receipt system; counts 14 rules, 109 ADRs, 311 receipts).
The audit explicitly did not call for reverting product code.

### 4. Option 2 — continue on master: cost and risk

**Accumulated complexity, measured.**
- 300-line rule: Rust files over 300 lines 28 → 60 (`src-tauri/src/commands/file.rs` 1,892; `services/markdown.rs` 1,597;
  `services/http_server.rs` 1,414; `commands/logging.rs` 1,043; several `*_tests.rs` modules); frontend stays at 7 (`App.tsx` 985).
  Most of the growth is Rust test modules and `menu_*` splitting, but `file.rs` was already over at v0.3.5 — this is not new debt,
  it is unpaid debt.
- Tooling weight: 149 script files, 1,044 test files, a 133k-line receipt registry committed to the tree, 61 gate exceptions.
- Rules/ADRs: 16 rule files; rule 70 538 lines, rule 71 400, CLAUDE.md 494 (#556 problem 5); ADR-0147 (shrink always-on rules)
  accepted 2026-10-27 and not implemented.
- 107 open 「已登记，未修」 rows; 15 CHANGELOG items awaiting device checks; the Windows menu batch blocked on the driver.

**What makes master trustworthy** is already specified, approved and in plan review: #557 with tickets #558–#563
(`docs/specs/i556/r4/`, ADR-0159 Proposed): one `land-check` that refuses `--ff-only` without a verifier PASS for the exact SHA
(T-01), both auditors' latest reports clearing it (T-02), device evidence matching the SHA (T-03), a single gate-exception
override (T-04), policy files off the docs-only path with policy tests (T-05), and the rule 70/71 switch-over (T-06). The
remaining #556 items — macOS-only Rust tests on PRs touching `menu_target*` (#556 solution 7), the `identity.mjs` timeout vs
mismatch (solution 6), deleting `ai-verifier.yml` (solution 8), ADR-0147 (solution 3), D323 lifecycle property tests
(solution 5) — are each one PR. None requires a different base; all require that feature work stop competing for the three slots.

**Main risk of Option 2:** the same process that produced 20 `fix(tdd)` commits in 10 days keeps generating tooling churn, and the
6 gated #556 tickets go through the very two-auditor/two-round pipeline the audit calls over-costly. If #557 lands slowly, the
"device check pending" backlog (15 items) and the 107 open rows keep growing.

### 5. A middle path

**Keep master, freeze features, cut 0.3.6 slim, then land #557.** Concretely:

1. **Feature freeze now, except the three slots already granted** (D336–D338 driver, D50, PR #549). Nothing new from the menu
   plan (M8 is already out of 0.3.6 per the gate at sequencing line 430), no new ADRs beyond 0159.
2. **Cut 0.3.6 from master after the Windows menu batch reruns**, carrying D294/D313 as Known issues exactly as
   `CHANGELOG.md:12-13` already does. The gate paragraph (line 430) already defines exit: three device batches, build-only
   rehearsal, RC regression on the locked SHA, 0.3.5→0.3.6 canary. This gives 0.3.5 users the D261/D214/D246/security fixes
   within days instead of months.
3. **Then the #557 tickets, T-01…T-06, one PR each**, as the only non-fix work, followed by #556 solutions 7, 6, 8 and ADR-0147.
4. **Pay down the most dangerous large files when touched**, not as a sweep: `file.rs` and `App.tsx` only.

Why not "cherry-pick a curated set onto v0.3.5": it costs the re-landing of §3 to reach roughly the current master minus the
features users already saw in `[Unreleased]`, and it still inherits every process problem. Why not "freeze until #557 lands
before any release": 0.3.5 users would keep the wrong-window Save (D261) and three RustSec advisories for however long six gated
tickets take under the two-round cap.

### 6. Recommendation

**Option 2, with the middle-path freeze: continue on master.**

Top three reasons:
1. **The code on master is better and safer than v0.3.5, provably.** ~30 data-loss fixes (§1b), Save As and WYSIWYG find shipped
   (ledger Shipped 82 → 99), three security advisories cleared, CI green on the last code commit (`5a5b0110`), and only one
   proven user-visible regression (D313, Linux custom-key edge case). The audit that triggered this question says the product
   code is not the problem (`docs/audit/…md:7`, `:508-519`).
2. **Forking does not touch any root cause the audit named.** All ten are in CI triggers, `land-guard.mjs`, agent rules,
   receipt tooling and machine capacity — identical at v0.3.5. The fix for them (#557, ADR-0159, six tickets) is already in plan
   review on master and is process code, not product code.
3. **Forking destroys the evidence chain and violates ADR-0083.** 866 receipts, 29 receipt refs, 104 audit-log rows, 47 new ADRs,
   `docs/specs/i556/r4/manifest.md` hashes, three in-flight branches and one open PR all anchor to master SHAs; ADR-0083 Decision 1
   makes master the only permanent branch and was itself the cure for the last two-trunk episode.

Main risk of the recommended path: **tooling churn crowds out the gate work.** The 20 `fix(tdd)` commits and 61 gate exceptions
show the harness consuming the slots; if the freeze is not held, #557 lands late and master stays "green on Linux, unproven on
device". Mitigation is the freeze itself plus landing T-01…T-06 before any new feature grant.

### Verdict

Master is not a mess to walk away from; it is v0.3.5 plus the Save-As/find/shortcut features users were promised, roughly thirty
save/close/draft/menu data-loss fixes, three security bumps and a green ci-gate on its last code commit — with one Linux-only
regression (D313) and one WebKit crash (D294) that may be older than any of it. The outside audit's complaint is about the
harness and gates, which a fork from `67715ea2` would inherit byte for byte while throwing away the fixes, orphaning 866 receipts
and three live branches, and breaking ADR-0083. Continue on master, freeze features, ship 0.3.6 from it with the Known issues
already written, and spend the slots on #557's six tickets so that the next landing is checked by a script rather than a rule.
