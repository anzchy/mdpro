# Why shipping a feature in mdpro is hard: mdpro against vmark and marktext

opus-auditor, 2026-11-01. Request: `delivery-friction-request.md` (herdr-delegator; user: 「让Opus-auditor 全面对比当前project与xiaolai vmark project的差异 … 当前mdpro codebase有些问题，导致ship new feature非常困难，我想看看原因到底出在哪里」, 「marktext也纳入对比」).

Read-only. Nothing was written in any repository, nothing committed or posted, no token printed, no win-desktop or GUI command run. The `582-*` files were not read.

Inputs: mdpro at `origin/master` `cf9e975a` (read from the main checkout; the `gh` queries ran against `anzchy/mdpro`), vmark `e4155423` (0.9.110) and marktext `17174e42` (0.23.0) shallow clones, GitHub API for the competitors' PR, commit and CI-run figures, `docs/audit/audit-log.md`, `docs/audit/escapes.md`, the sequencing doc, `~/.mdpro-redesign/herdr-spike/*/`, my `PR575-assessment.md` (2026-11-01) and `rework-assessment.md` (2026-10-31), the user's untracked `docs/audit/mdpro 工程质量与 AI Agent 开发流程深度审计.md` (2026-10-30, called "the 10-30 audit" below), and `docs/knowledge/20261027-repeated-development-and-token-cost.md`.

Every number in a table under "Measured" came from a command I ran today; the command shape is given in the evidence index. Everything under "Judgment" is mine.

---

## 0. The answer in one paragraph

Measured, mdpro's product is small: 50k lines of TypeScript and CSS and 47k lines of production Rust, the same order as marktext's desktop package and a fifth of vmark. What is large is everything around it. Since 2026-09-12 the repository took 1,435 commits, of which 1,266 touched only docs, `.claude`, `.agents` or `.codex` and 426 touched `src` or `src-tauri`; 161 ADRs exist, 47 of them written in the last sixteen days; every session loads 1,936 lines (18.6k words) of always-on instructions, against 127 lines in vmark and 301 in marktext; the test tree is 4.4 times the size of the product it tests, 288 of its files test the tooling and 84 of them model Windows PowerShell on a Mac; and each PR carries, on average, ten to twenty files of bookkeeping (receipts, sequencing rows, ledger, audit log) that every other PR also edits. vmark and marktext ship with one maintainer or a community, one CI run, and an automated real-app suite (52 bridge journeys; 147 Playwright specs). mdpro ships through a five-agent roster, two blind audits per PR, a receipt gate that produced 25 of the 38 recorded gate exceptions and caught no recorded defect, and device proof that is driven by hand or by agents on a shared Mac mini and a remote Windows PC. The ranked causes are in § 3; the controls that earned their keep are in § 4; the sequence for after 0.3.6 is in § 6. The one-line version: **the process was built to make a wrong landing impossible, and it succeeded by making every landing slow; the product's own structure contributes less than the pipeline that proves it.**

---

## Part 1. Process and tooling layer

### 1.1 Measured: size of the layer

| Item | mdpro (`cf9e975a`) | vmark (`e4155423`) | marktext (`17174e42`) |
|---|---|---|---|
| `CLAUDE.md` | 494 lines | 6 lines (`@AGENTS.md` plus one note: no project memory) | none |
| `AGENTS.md` | 163 lines, 1,720 words | 121 lines, 1,557 words ("rules only; the reasoning lives in the script that enforces it") | 301 lines, 2,004 words |
| **Always-on per session** (CLAUDE.md + rules without `paths:`) | **1,936 lines, 18,605 words**; the 10-27 retrospective measured this at 31–36k tokens, rules 70 and 71 alone ≈ 17k | **127 lines, 1,583 words** (all 14 rules are path-scoped) | **301 lines, 2,004 words** |
| `.claude/rules/` | 16 files, 2,109 lines; 7 always-on (10, 12, 22, 25, 50, 60, 70, 71), rule 70 = 538 lines, rule 71 = 450 | 14 files, 1,285 lines; 0 always-on | none |
| `.claude/hooks/` | 12 files, 1,803 lines. Wired: 3 `PreToolUse` on **every** `Bash` call (`block-target-scan`, `role-guard`, `receipt-rustfmt-guard`), `role-guard` also on every `Write`/`Edit`/`AskUserQuestion`, 1 `UserPromptSubmit`, 1 `PostToolUse` on **every** tool call (`session-size-guard`) | 4 files, 938 lines (2 guards + their tests). Wired: 2 `PreToolUse` on `Write`/`Edit` only, each scoped to a path list in its header | husky `pre-commit` → `lint-staged` |
| `.claude/agents/` | 3 (264 lines): landing verifier, fable auditor, number registrar | 6 (102 lines): auditor, impact-analyst, manual-test-author, release-steward, spec-guardian, test-runner | none |
| Skills and commands | `.claude/skills` 17 (2,160 lines), `.claude/commands` 14 (1,676), `.agents/skills` 72 files (3,811; 19 `.ps1`, 20 `.sh`, 1 `.cs`), `.codex` 24 files (1,852) | `.claude/skills` 24 (4,913), `.claude/commands` 7 (826), `.codex` 3 files (45) | none |
| `scripts/` | 163 files, 25.8k lines: `tdd/` 23 files 6,247 (incl. the vendored tdd-guardian 0.10.2 engine), `control/` 46 files 7,454, `ledger/` 8 files 1,448, `lint/` 3 files 731, `ci/` 308, `device/`, `codex-rules/` | 454 files, 82.5k lines: 177 `check-*` files (71 gates + their tests), **45 `lint:` scripts** in `package.json`, 159 gate tests run as their own vitest tier | 8 files, 571 lines (licences, locales, release merge) |
| CI workflows | 13 files, 1,591 lines | 17 files, 5,004 lines | 14 files, 940 lines |
| ADRs | **161** (44 in Sept, 115 in Oct, 2 in Nov); 47 added since 2026-10-16; by title 56 are about process or tooling, and ADR-0115 → ADR-0164 are almost all process (slots, rosters, caps, receipts, fresh context, load guard, freezes) | **19** (`ADR-001`..`019`), plus plan-scoped ids; the index marks several "drifted" or "false in practice"; `lint:adr-refs` fails on an id with no record | 0 ADRs; 13 developer docs (ARCHITECTURE, IPC, RELEASE…) published on the website |
| Plans and specs | `docs/plans/` 53 files, 24.6k lines; the sequencing doc 1,110 lines with **251 D rows** (`d100`..`d353`); `docs/specs/` 70 files (three features at r1–r5) | tracked plans in `.claude/tdd-guardian/` (10 md files); the rest gitignored under `dev-docs/` | GitHub issues |
| Feature ledger | 798 lines, 333 commits since 09-12, `pnpm ledger:check` (1,448 lines of scripts) | 5,630 lines, joined to `scripts/feature-map.json` (65 features) by `lint:feature-map`; **not loaded into any agent context** | none |
| Receipts | `receipts.json` **11.3 MB, 336k lines, 1,001 receipts, 385 commits** since 09-12; `evidence.json` 212 KB; 6.2k lines of entry scripts | tdd-guardian `state.json` (last gate, coverage, work items); the TDD rule is enforced by the two scoped hooks and a coverage ratchet; no receipt is a landing condition | none; lint + typecheck + tests + CI |
| Roster | 5 live agents + delegator (rules 70/71, 988 lines; ADR-0124/0133/0134/0137/0156) | one maintainer + Claude Code; Codex for `review-plan` on plans > 500 lines; "VMark takes issues, not pull requests" | community PRs to `develop`; "you must understand the code you submit" |

### 1.2 Measured: what the layer does per change, and what it has caught

Delivery figures, same window (2026-09-12 → 2026-11-01):

| | mdpro | vmark | marktext |
|---|---|---|---|
| Commits on the default branch | **1,435** (docs 734, fix 365, feat 84, chore 84, test 74, refactor 30) | 1,230 | 334 |
| …of which touch `src` or `src-tauri` | 426 | — (shallow clone) | — |
| …of which touch only docs, `.claude`, `.agents`, `.codex` | **1,266** | — | — |
| Merged PRs | 139 | 130 | 320 |
| Issues opened | 29 | 62 | 273 |
| Releases | 0.3.1 → 0.3.5 on 10-11 → 10-16 (five in five days), **none since 10-16** (16 days; 0.3.6 pending, 54 Unreleased bullets, 2 under Added) | three in the last three days (0.9.108 → 0.9.110), daily cadence | 23 in 2026, weekly-ish (0.20.0 → 0.23.0 since 10-02) |
| Product `feat` commits since 10-16 (touching `src`/`src-tauri`) | 25, of which 5 are the control channel or device identity | — | — |
| Merged PR: median files / lines | **20 / 3,162** (last 60; `receipts.json` alone adds 400–8,500 lines per PR) | 9 / 214 (last 20) | 7 / 189 (last 20) |
| PR open → merge, median | 0.6 h over 100 PRs, but rising: 0.2 h (10-15/16, before herdr), 1.2 h (10-20/23), **5.8 h (10-24/30), 9.9 h (10-30/11-01)** | 0.8 h | 2.3 h |
| Comments per PR, median | 1 (max 16; the audit rounds are posted there) | 0 | 1 |
| `ci.yml` wall time | **25 min** (frontend job 1,106 files, 30-min ceiling, two cancellations on #575) | 12–19 min for 13 jobs incl. WebKit and Rust on three OSes | unit 3–4 min; e2e 22 min; six-target build 13 min |

Per-item wall clock, from the brief's first file to the last handoff in `herdr-spike/` (mtimes, so an upper bound on the implementor's share only; audits, verifier, CI and device runs come after):

| Item | Files in the agent's folder | First → last | Then |
|---|---|---|---|
| D255-WI-3c find bar (#532) | 21 | 10-23 15:44 → 20:32 (≈ 5 h) | 2 audit rounds, landed the same day |
| D305 drafts (#531) | 21 | 10-23 15:40 → 21:22 (≈ 6 h) | 3 rounds, G531-1 |
| M1b shortcuts (#530) | 19 | 10-22 23:01 → 10-23 15:07 (≈ 16 h) | 3 rounds, G-M1b-1 (12 receipts, three rulings), C-H3 landed open as D313 |
| D319 menu target (#533 + #539) | 69 + 8 | 10-24 09:35 → 16:34, then 10-25 11:49 → 20:27 | 3 + 1 rounds, two device FAILs between (escapes #2, #3) |
| D336–D338 Windows driver (#573) | 52 | 10-30 09:02 → 10-31 11:31 (≈ 26 h) | 2 rounds + CI review; then W036b stopped on D342 (escape #5) |
| D342 (#575, first commit) | 72 | 10-31 17:32 → 11-01 12:37 (≈ 19 h) | 5 rulings for a few-line type fix |
| D346 (#575) | **392 files, 21 rulings, 12 stops** | ≈ 2 days | three device runs, no PASS yet |
| T-01 jack-tdd-workflow (#577) | 33 | 10-31 22:25 → 11-01 14:17 (≈ 16 h) | r1 clean, G577-1 (57 receipts flagged) |

Per-control record, from `audit-log.md`, `escapes.md` and the `herdr-spike/` folders:

| Control | Cost per change (measured) | Catches (measured) |
|---|---|---|
| **Receipt contract** (rule 10, ADR-0125/0145/0149; `red-receipt.mjs` record → verify → `check-pending` → replay) | `receipts.json` in every PR (+386 to +8,456 lines); **25 of the 38 gate-exception rows** up to 10-30 are receipt rulings, 45 rows today; the user is asked per landing; D346 ruling 1/3, D305 fix 2b, ADR0149-entry ruling 1, WI2 rulings 2–3 exist only to repair receipts; seven tooling PRs (#516, #518, #522, #551, #564, #566, #577) ≈ 16 audit rounds on the mechanism itself | `escapes.md` credits no defect to a receipt; the Findings table credits all 13 Highs to an auditor's trace. The 10-27 retrospective: "14 of 23 PRs waived" |
| **Dual blind audit + challenge** (rule 70 item 4, ADR-0115/0143) | Two fresh-context requests per round; gpt-auditor 0.67–1.5 M input tokens and 100–290 s per request (cost table rows 4–10); 46 ranges: 17 one round, 13 two, 9 three, 6 two-plus-post-cap, 2 four-or-five | **13 Highs in the Findings table** (F508-1/2/3 settings overwrite across windows, F519-1/2 recovery, F518-1/2/3 receipt lane, F516-1/2, F517-1 wrong-document first key, F514-1 table insert), all data-loss or wrong-document; D290 H1–H4, D305 H1, B7-H1 cross-window input. 5 escapes against 46 ranges |
| **Gate exceptions** (ADR-0129 d8) | 45 rows, each a user ruling with a quoted answer; 25+ receipts, 6 load/CI, 4 device, the rest slot/cap/pause | None by themselves; they are the valve |
| **Brief + self-acceptance table + matrix attack** (rule 71) | A six-section brief per grant; `<item>-test-matrix.md` and `-attack.md`; six rulings that only say "no third attack round" (D319, ADR47-WI010, ADR0150-WI1, WI2-followup, D326 fix 1, W036 cards) | Rule 71 credits the matrix step with M3b H1, D290 H1/H2; attack gaps became later REDs (D319 case 14, ADR0150 gap 10, D326 F2h) |
| **Rule 12 planning gate** (ADR-0148, 10-28) | I556 spec r2 → r5 in 27 h (four plan-review rounds), T567 r1 → r5 in 24 h, D50 r1 → r2; D50 was paused on the gate (G-D342-1); the fast-check item got an exemption (G-ADR0163-1) | None recorded yet (no gated item has landed) |
| **Feature ledger** | 333 commits; a row rewrite in every behaviour PR; `ledger:check` | The gate catches unlisted surfaces; no defect recorded |
| **ADRs** | 47 since 10-16, each with two blind plan reviews of 1–3 rounds (`herdr-spike/opus-auditor/ADR-01xx-r{1,2,3}.md`: 0136, 0138, 0139, 0141, 0144, 0145, 0146, 0147, 0148, 0149, 0155, 0157, 0162, 0163) | The round cap changed three times in eight days (0120 → 0142 → 0143); the roster five times; rules 70/71 took 55 commits since 10-16 |
| **Roster and delegator** (rules 70/71) | gpt-imple-1's folder: 1,152 files, 88 rulings, 65 handoffs, 21 stops; the delegator's docs-only commits: 12–44 per day since 10-23 | The verifier caught D305's overwritten record and D319 Fix 1's three unclaimed paths |

What vmark and marktext have for each:

- **Receipts.** vmark: none as a landing condition. TDD is enforced where it is cheap to enforce: two `PreToolUse` hooks refuse an edit to a listed high-risk production file that has no sibling test, and `test:coverage` is a ratchet (floors only go up). The plugin's `state.json` records the last gate result. marktext: none; `lint`, `typecheck`, unit, e2e and a six-target build on every PR.
- **Audits.** vmark: a `claude-audit.yml` and `baseline-review.yml` workflow, an `auditor` subagent (15 lines), Codex `review-plan` only for plans over 500 lines or three phases (rule 60 § 6); one maintainer merges. marktext: maintainer review; CI is the gate; "all PRs must pass CI before merge".
- **Gate exceptions.** vmark: ratcheting baselines re-checked at the merge base, with a manifest `allowRaise` entry that must carry a reason and goes stale once merged (rule 60 § 11); `CHANGE-SIZE-ACK:` in the PR body over p90 size (150 files / 10,000 lines). No per-landing user ruling. marktext: none.
- **Briefs and self-acceptance.** vmark: work items `WI-N.M` in a plan, linked by commit tag or test header, checked by `check-wi-linkage.sh`; phase DoD scripts (`check-gha-phase.sh`). marktext: an issue and a PR template.
- **Planning gate.** vmark: a plan for anything over a day or five files, in `dev-docs/` (local) or `.claude/tdd-guardian/` (tracked), cross-model review above a size; grills under `dev-docs/grills/`. marktext: "open a feature request issue first".
- **Feature ledger.** vmark has the heavier one (5,630 lines, 65 features, generated metrics), but it is a CI join, not a context load; mdpro's 798-line ledger is a hand-edited table rewritten in every behaviour commit.
- **ADRs.** vmark keeps 19 and is honest about drift ("False in practice", "Reversed in practice"). marktext keeps none; architecture lives in published docs.
- **Roster.** Neither has one. vmark's `CONTRIBUTING.md` says the code is written by AI under the maintainer's supervision; marktext takes human PRs.

### 1.3 Judgment on Part 1

1. **The always-on load is fifteen times vmark's, and half of it is roster history.** Rules 70 and 71 (988 lines) carry dated user decisions, retired roles and superseded clauses with "where this file elsewhere says X, ADR-NNNN wins" notes. ADR-0147 ("always-on instructions become a routing map") was accepted on 2026-10-27 and is not executed: the files are the same size today. The 10-27 retrospective put the re-read cost at ≈ 80 M weighted tokens. vmark pays zero for this because every rule has `paths:` and the role model is one maintainer.
2. **The receipt contract is the one control whose cost is measured and whose catch is zero.** This is the same conclusion as my 10-31 rework assessment (C1) and the 10-30 audit (§ 3.4, § 6.3). The user ruled 「Keep as is」 and ADR-0162 froze it; that ruling stands until 0.3.6. The number has moved since: 45 exception rows now, G575-1/2 and G577-1 added this weekend, 57 receipts flagged on #577 alone.
3. **Dual blind audit is the control that earned its keep**, and the comparison does not weaken that: vmark and marktext have no equivalent and rely on one maintainer's eye plus CI. The 13 data-loss Highs would not have been found by `lint:ipc-contract`. What the comparison does show is that mdpro runs it at full strength on every PR, including docs-only cards (#548: Low tier, two auditors, two rounds, one High about a leftover test file) and tooling (#564, #574, #576, #577), where ADR-0121's tiering was meant to lighten it and ADR-0143 then made both auditors mandatory everywhere.
4. **The process changes faster than the items it governs.** 47 ADRs and 55 rule commits in sixteen days, each reviewed by two auditors; items were granted under one contract and landed under another (D326's gpt-only round one; D50 paused by rule 12 mid-grant; G-ADR0146-1's receipt broken by the approved draft's heading move). vmark's `60-ai-governance.md` is 138 lines and the long form is `git show 12c98051e:…`.
5. **The roster multiplies coordination, not throughput.** With one unlanded item per implementor and three machine-wide, the throughput ceiling is three items; the measured product output since 10-16 is 25 `feat` commits and zero releases. The delegator's own docs-only commits (12–44 a day) move `master` under every open branch, which is what forces the "rebase, tree-identity re-verify" step on nearly every landing row in the audit log.

---

## Part 2. Architecture, macOS and Windows

### 2.1 Measured: code structure

| | mdpro | vmark | marktext |
|---|---|---|---|
| Frontend production | `src/` 403 files, **50.3k lines** (TS/TSX/CSS); utils 11.7k, components 9.2k, plugins 8.8k, hooks 8.0k, services 3.7k, stores 2.4k; 7 files > 300 lines, **`App.tsx` 985** | `src/` 2,039 production files, 262.9k lines; plugins 63.7k, services 61.9k, components 42.4k, utils 29.0k, lib 24.9k; 41 files > 300 | `packages/desktop/src` 381 files, 58.0k lines (Vue), 38 > 300, `editor.vue` 2,108; `packages/muya/src` 628 files, 109k lines (own editor engine) |
| Backend production | `src-tauri/src` **242 production `.rs` files, 46.6k lines**, 22 > 300, **63 at ≤ 80 lines**; plus **380 `*_tests.rs` files, 73.8k lines**; `services/` root is flat: 213 files, 43.3k lines; `quit_guard/` **106 files, 19.0k lines**; 51 `menu*.rs` files, 10.6k lines; `commands/file.rs` 1,892 lines | 672 production `.rs`, 113k lines; 511 `.test.rs` siblings, 125k lines; `menu/` 18 files; `window_manager/` 10 files; `loc-guardian` cap of 300 **pure** lines with tests in `#[cfg(test)]` at the bottom | Electron main 14 dirs (`menu/` 27 files, `keyboard/` 5 per-platform keybinding files) |
| Tests | `tests/` **1,283 files, 223k lines**: app 728, `tooling/` 288 files 36.5k lines, `control/` 97 files 19.5k lines, 22 slow; **301 of 732 app test files are named after a D or ADR id**; 84 files / 6.9k lines model the Windows driver; Rust `#[test]` 2,063 | 2,363 co-located test files, 537k lines; 35 real-WebKit tests; 159 gate tests; Rust 4,782 `#[test]`; `e2e/` 92 files: **52 journeys** through the Tauri MCP bridge, smoke, IME, soak | desktop unit 156 specs, 41k lines; **e2e 147 Playwright specs** on the real Electron app; muya 144 e2e specs + CommonMark/GFM conformance with a locked expected-failures list |
| Test : production lines | **4.4 : 1** (TS), 1.6 : 1 (Rust) | 2.0 : 1 (TS), 1.1 : 1 (Rust) | 0.7 : 1 |
| IPC surface | 61 `#[tauri::command]`, 56 `invoke()` names, 18 emitted event names, 6 `listen()` names, 14 HTTP routes, 24 `MENU_*` ids, 12 stores | 240 commands, 187 `invoke()` names, 32 `listen()` names; `lint:ipc-contract` makes every `invoke("x")` resolve to a registered `fn x` | 114 `mt::` IPC channels, typed in `shared/types/ipc.ts`; sandboxed renderer, `contextBridge` only; 13 Pinia stores |
| Editor | Milkdown (ProseMirror) + CodeMirror 6; 26 Milkdown plugin entries, 20 CodeMirror | Tiptap (ProseMirror) + CodeMirror; **ADR-003 "Tiptap over Milkdown"**; 88 plugin dirs behind a `lint:store-coupling` boundary (plugins may not import stores/services/hooks/components; host seams under `plugins/shared/`) | Muya, a separate workspace package with no Electron import; CodeMirror for source mode |
| Menu and shortcuts | command table in TS → generated `menu_layout.json` → Rust reader → native menu; dispatch through `menuActionTable.ts` + `useMenuEvents.ts`; **one action (toggle sidebar) is named in 9 production files across both layers** (16 with docs); rule 41 keeps five files in sync; the click-time target model is 5 `menu_target*` files | `shortcutDefinitions.ts` is the source of truth, Rust `accel(...)` and the website page are mirrors, **`lint:keybinding-manifest` fails on drift**; `menu/events.rs` emits `menu:{id}` generically | per-platform keybinding files; `menu/actions`, `menu/templates`; `keyboard/shortcutHandler.ts` |
| Concurrency model | per-feature: `save_as_transaction.rs` (async lock, re-check), `draftWriteCoordinator.ts` (in-flight set, `saveOrder`), `useWindowCloseGuard.ts` (`attemptRef`, latch), `quit_guard` (four-phase protocol, 106 files); D323 (model/property tests) reviewed, not started | documents as the unit of state (ADR-009, "drifted"); `lint:window-thread` makes window-creating commands async | one renderer process per window; main owns IO |

### 2.2 Measured: platform strategy and the test pyramid

| | mdpro | vmark | marktext |
|---|---|---|---|
| PR CI matrix | **ubuntu only** (`frontend`, `rust-test`); macOS only when the ref is a `v*` tag; `rust-audit`; `ci-gate` | fe-static, fe-test, fe-coverage, fe-servers, fe-build, **webkit** (real WebKit), website, bench, **rust-test on macos/ubuntu/windows**, rust, rust-audit; `paths-filter` skips app tiers on docs-only PRs | `test.yml` on **ubuntu + windows**; `e2e.yml` Playwright under xvfb; **`build.yml` on six targets** (ubuntu x64/arm64, windows x64/arm64, macos intel/arm) on every PR; lint, licences |
| Windows build | `build-windows.yml`, **`workflow_dispatch` only**, 142 lines | in `release.yml` (tag push) and `rust-test` on PRs | `build.yml` on every PR, `release.yml` on tag |
| How Windows is tested | A remote pwsh/C# driver (1,622 lines in `.agents/skills/remote-windows-device-test/scripts/windows/`) over SSH from the Mac, driving WebView2 and native input through a Scheduler task; **84 unit test files model PowerShell 5.1 and Win32 in pwsh 7 on macOS**; the driver itself needed four PRs (#540, #573, #575 with D342–D346, each defect found one per host run) | `#[cfg(not(target_os = "windows"))]` on `tauri::test` items; "macOS is primary; never break it to fix Windows/Linux (best effort)"; `cargo test` runs on `windows-latest` in CI | unit tests run on `windows-latest`; installers built on every PR; community reports |
| Real-app automation | ADR-0047 control channel (feature-gated `verify-run`/`control-channel` Cargo features, `scripts/control` 7.4k lines, 97 tests) for probes; 9 device **cards** in `docs/test/cards/` run by an agent or by hand with computer use; identity check (D326) | `pnpm e2e:journeys`: 52 journeys over the Tauri MCP bridge in a debug build, zero-dependency Node, disk fixtures, screenshot on failure; `e2e:smoke`, `e2e:ime`; 35 `*.webkit.test.ts` in real WebKit in CI | 147 Playwright specs on the real Electron app in CI; muya e2e in Chromium |
| Signing and updater | `release.yml` 298 lines, manual dispatch, refuses an unsigned build, `verify` → `draft` → `publish` with re-verification of the uploaded draft (ADR-0073); updater `latest.json`; **ADR-0164 (today): 0.3.6 ships macOS and Linux only** | `release.yml` on `v*` tag: four platforms, notarized DMG, pre-signed MCP sidecar; `pre-push` hook refuses a tag whose commit CI did not pass (`check-tag-green.sh`) | unsigned macOS builds (no Developer ID; users clear quarantine); NSIS/AppImage/snap/deb |

### 2.3 Measured: coupling and shared files

What a product PR touches (`git diff --numstat base..head`, categories: `src`, `rust`, `tests`, `receipts` = `.claude/tdd-guardian/`, `docs`, `tooling`):

| PR | Commits | src | rust | tests | receipts | docs | tooling |
|---|---|---|---|---|---|---|---|
| #532 find bar | 2 | 10 f +485 | 3 f +36 | 12 f +940 | 1 f **+784** | 5 f | 2 f |
| #529 Save As / window commands | 3 | 15 f +230 | 42 f +2,060 | 15 f +593 | 1 f **+4,154** | 4 f | — |
| #530 M1b shortcuts | 6 | 46 f +841 | 36 f +1,033 | 80 f +3,030 | 1 f **+6,055** | 7 f | — |
| #514 M3b menu dispatch | 3 | 10 f +559 | — | 5 f +771 | 1 f +919 | 4 f | — |
| #515 D290 save/recreate | 14 | 22 f +911 | — | 15 f +1,299 | 1 f +2,364 | 12 f | 11 f |
| #528 D255-WI-3b | 6 | 22 f +523 | 17 f +880 | 31 f +2,017 | 1 f **+7,822** | 4 f | — |
| #508 WI-4.3b settings | 5 | 17 f +884 | 3 f +270 | 27 f +2,106 | 1 f +2,350 | 5 f | — |
| #527 M4 menu tree | 3 | 12 f +194 | 26 f +4,241 | 10 f +591 | 1 f **+5,920** | 4 f | — |
| #533 D319 fix 1+2 | 3 | — | 12 f +2,387 | 2 f | 1 f +5,448 | 4 f | — |
| #539 D319 fix 3 | 1 | — | 10 f +1,611 | — | 1 f +2,378 | 4 f | — |
| #573 D336–D338 driver | 8 | — | — | **72 f +4,438** | 2 f **+8,456** | — | 26 f +1,844 |

Shared files every PR edits, and their churn since 09-12: `.claude/tdd-guardian/receipts.json` **385 commits**, the sequencing doc **738 commits** (1,110 lines), `docs/feature-ledger.md` 333, `docs/audit/audit-log.md` 63, `CLAUDE.md` 43, rule 70 44, rule 71 35. The audit log records the consequences: "only `receipts.json` merged" (#538), "receipts union only" (#522), "`evidence.json` rebase conflict dropped eight entries" (#575 ruling 16), "rebased by the delegator over docs-only master moves, tree-identical" on #573, #574, #576, #577, #543, #544, #545, #547, #548, #550.

### 2.4 Judgment on Part 2

1. **The product is not where the mass is.** mdpro's product is about 97k lines; its tests, tooling, scripts and agent configuration are about 330k. vmark is ten times larger as a product and carries a 2:1 test ratio; marktext ships at 0.7:1 with a real-app e2e suite doing the heavy lifting. A 4.4:1 ratio where 301 of 732 app test files are named after a defect number is a suite that accreted one regression test per audit finding rather than one that models the behaviour. It also explains the 25-minute `frontend` job at its 30-minute ceiling: 1,106 files, most of them small jsdom tests, several spawning `pwsh` per case.
2. **The tests model the platform instead of running on it, and the three platforms that matter are absent from PR CI.** The 10-30 audit's first root cause ("Linux CI passes, which says nothing about macOS native menus") is confirmed by the numbers: no macOS job on a PR, no Windows job at all, no automated real-app run anywhere in the pipeline. The device proof (ADR-0144) is correct in principle and is done by an agent with computer use (51 % of the Claude spend in the 10-27 retrospective: 1,759 `sleep` calls, 1,584 screenshots) or by the user at the desk. vmark proves the same things with 52 journeys over an automation bridge and 35 WebKit tests, in CI, in a 20-minute job; marktext with 147 Playwright specs. mdpro already built the bridge (ADR-0047's control channel, 7.4k lines of scripts, 97 tests) and uses it for probes, not for journeys.
3. **The 300-line rule, applied to Rust as a file-count rule, fragmented the backend.** 380 `*_tests.rs` files beside 242 production files; `quit_guard` is 106 files for one protocol; the menu is 51 files in the crate root; 63 production files are at or under 80 lines; and `services/` is a flat directory of 213 files where feature boundaries exist only in filenames (`file_watcher.rs`, `file_watcher_fanout.rs`, `file_watcher_holders_fanout.rs`, `file_watcher_route.rs`, `file_watcher_save_notice.rs`…). vmark enforces the same limit on **pure** lines with tests in `#[cfg(test)]` at the bottom and modules per feature (`menu/`, `window_manager/`, `hot_exit/`). The effect on delivery: a change to one behaviour fans across many small files, every one of which is a separate blob for the verifier's tree identity, the receipts' pinned trees and both auditors' reading.
4. **Cross-layer coupling is real but moderate, and it is the same shape vmark has; the difference is that vmark gates it with a lint.** One menu action in nine production files across TS and Rust is a lot, but vmark's three-surface shortcut sync is the same problem, solved by `lint:keybinding-manifest` failing CI instead of by rule 41 asking an agent to remember. mdpro's command table → `menu_layout.json` generator is the right design and already exists; what is missing is the lint that makes the generator the only way.
5. **Concurrency is solved per feature, each time from scratch.** `save_as_transaction`, `draftWriteCoordinator`, `useWindowCloseGuard` and the four-phase `quit_guard` are four different lock-and-epoch designs for one problem (a document's owner changes during an `await`). This is the 10-30 audit's second root cause and my rework assessment's C3, and it is why D290 took four rounds and D305 three: each audit round found the next interleaving the local patch did not cover. D323 (model and property tests) was reviewed on 10-27 and has not been granted a slot.
6. **Windows is a separate product with its own bugs, and the bugs are in the test driver.** D342–D346 are all driver defects (string budgets, array shape, EXE loader, job DACL); none is a product defect; ADR-0164 drops Windows from 0.3.6 for lack of a proof, not for a known bug. vmark and marktext spend nothing on a remote driver because a `windows-latest` runner builds and unit-tests for them and users report the rest. mdpro's choice to prove Windows menus with a hand-built Scheduler-task driver over SSH is the single most expensive line in the whole comparison: 1,622 lines of PowerShell and C#, 84 model-test files, four PRs, three device runs, and the platform still shipped without it.

---

## Part 3. Diagnosis

### 3.1 Root causes, ranked by impact on delivery time

**RC1. The proof pipeline is serial, host-last, and spends most of its rounds on itself.**
Evidence: of 46 audited ranges, 22 are tooling, process or harness items and they account for 14 of the 17 ranges that needed three or more rounds or a post-cap fix (rework assessment § 0). 25 of 38 gate exceptions are receipt rulings; `escapes.md` credits none of the five escapes to a receipt and the Findings table credits every High to an auditor. Three of the five escapes (#2, #3, #5) were platform truths that reached the host only after landing: AppKit's `DidEndTracking`/`WillSend` order (D261 → D319, three PRs, seven audit rounds, three device rounds, 10-17 → 10-25) and PowerShell's string comparison of `-PollMs 25` (D336–D338 → D342, two days). #575's D342–D346 were found one per host run, each run ≈ half a day. CI sits at 25 of 30 minutes and cancelled twice on #575; ADR-0162 d3 then makes the audits wait for it.
How vmark and marktext handle it: the proof is one CI run on the target OSes plus an automated real-app suite; there is no receipt, no device card, no ruling; a host-only truth fails a Playwright spec or a journey before merge.
Concrete change for mdpro: (a) demote the receipt verdict from landing gate to audit evidence (an auditor asks for a replay only when it disputes that a specific High's regression test fails without the fix), stop the receipt tooling line (#567 T-02/T-03 and successors) until a receipt has caught an escape; (b) turn the ADR-0047 control channel into a journey runner on the Mac mini for the device cards that are already written (D261, MENU-*, D255-windows's macOS half, D50) and run it on the PR head before round one; (c) add `windows-latest` to `ci.yml` for `cargo test` and `pnpm build`, and run `build-windows.yml` on PRs that touch `src-tauri`.
Cost and risk: (a) is a docs-only superseding ADR plus removing `check-pending` from the verifier's conditions, about a day; it reopens the risk that an implementor writes tests after code, which the two auditors' reading from the diff outward already catches. (b) is one to two weeks of harness work on an existing channel, and it moves the computer-use agent from driver to observer; the risk is a harness that proves the harness (the same trap #575 fell into), mitigated by starting from the nine cards that already have decisive log-line oracles. (c) costs ≈ 10 CI minutes per PR and gives up nothing.

**RC2. Bookkeeping is the majority of the work, and it changes under the items it governs.**
Evidence: 1,266 of 1,435 commits since 09-12 touch only docs and agent configuration; 734 commits are `docs`; 47 ADRs and 55 rule commits in sixteen days; the delegator commits 12–44 docs-only commits a day; the sequencing doc has 738 commits and 251 D rows (123 new D numbers since 10-16); 1,936 always-on lines per session, ≈ 31–36k tokens, re-read ≈ 80 M weighted tokens over the measured window. Rules changed mid-item on D326 (gpt-only round), D50 (rule 12), G-ADR0146-1 (approved draft moved). PR open-to-merge rose from 0.2 h to 9.9 h median across the four herdr weeks while product features fell to 25 commits.
How vmark and marktext handle it: vmark loads 127 lines, keeps 19 ADRs and marks drift honestly, batches rule edits, puts the long form behind a `git show`, and enforces by script what mdpro enforces by prose (45 `lint:` gates). marktext has one 301-line file and GitHub issues.
Concrete change: execute ADR-0147 (accepted 10-27, not done): rules 70/71 become a one-page routing map and the dated decisions move to `docs/agents/<role>.md`; D rows for tooling stumbles become issues, not sequencing rows; one docs commit per landing instead of per event; a freeze on new process ADRs after the current one (ADR-0162 d5 already says this until 0.3.6; extend it to "an ADR needs an escape or a user request").
Cost and risk: a week of editing and one plan review; the risk is losing a decision that only lived in rule 71's prose, mitigated by the ADRs (they are immutable and already hold every quoted decision).

**RC3. The pyramid is inverted and models the platform.**
Evidence: 223k test lines on 50k product lines; 288 tooling tests, 84 of them pwsh models; 301 defect-named test files; no macOS or Windows job on a PR; 25-minute CI at its ceiling; the device half done by a computer-use agent at 51 % of spend.
How vmark and marktext handle it: 2:1 and 0.7:1 ratios, real-app suites in CI, a WebKit tier, Rust on three OSes.
Concrete change: stop adding jsdom tests for host-only behaviour (menus, focus, Scheduler tasks, DACLs) and put those cases in journeys; move the `pwsh`-spawning D346 enumerations to the slow tier (ADR-0050) now; raise `timeout-minutes` to 45 as #575 M3 proposed; after 0.3.6, add macOS to the PR matrix for `rust-test` (the tag-only matrix exists; flipping the condition is one line).
Cost and risk: macOS runners are slower and cost more minutes; the journey suite needs the control channel to grow a few verbs (menu click, key chord, focus read), which ADR-0047 WI-010 already started.

**RC4. Concurrency and ownership are solved per feature, so each audit round finds the next interleaving.**
Evidence: D290 four rounds (H1 → H3 → H4, each "something during an `await`"), D305 three, WI-4.3b five, D255-WI-3d three with a fix-introduced F1; four distinct lock designs in the code; D323 planned and idle; escape #1 (D315) is an id change during an autosave.
How vmark handles it: ADR-009 "document as the unit of state" plus a lint that makes window-creating commands async; its journeys include the Tier-0 data-integrity set (multi-doc save isolation, dirty-close guard, autosave, failed-save preservation, external-change reload).
Concrete change: grant D323 first after 0.3.6 as the design step the rework assessment's C3 asked for: one document-ownership model (window, document, revision, holder) with property tests over generated event sequences, then migrate `save_as_transaction`, `draftWriteCoordinator`, `useWindowCloseGuard` onto it one at a time.
Cost and risk: two to three weeks and the first High-tier product PRs after the freeze; the risk is a model that does not match the native event order, which is exactly what the journeys (RC1 b) are for.

**RC5. Shared files make every PR conflict with every other.**
Evidence: `receipts.json` 11.3 MB, 385 commits, +400 to +8,500 lines in every PR, two rebase-drop incidents; the sequencing doc 738 commits; "rebased over docs-only master moves, tree-identical" on ten of the last fifteen landing rows; the verifier re-runs by tree identity on each.
How vmark and marktext handle it: no append-only shared JSON; vmark's ledger is checked by CI, not hand-edited per PR; plans are per-feature files.
Concrete change: falls out of RC1 (a) and RC2: per-item receipt files under `refs/receipts/` only (the pinned trees already live there), the sequencing rows for new work become issues (rule 12 already did this for specs), and the delegator batches docs commits.
Cost and risk: none beyond RC1/RC2; the audit-log and ledger stay as the record.

**RC6. Windows is proved by a bespoke driver instead of by a runner and users.**
Evidence: § 2.2 and § 2.4 item 6; ADR-0164.
How vmark and marktext handle it: `windows-latest` in CI, installers on every PR (marktext), "best effort" (vmark).
Concrete change: after 0.3.6, keep the driver for the few cards that need native input (D264, physical chords) and prove everything else on a `windows-latest` job plus a by-hand card run with `mdpro.log` as the oracle, the route the D50 recheck used on 10-31. Do not grant more driver items until a journey has passed on it.
Cost and risk: Windows parity claims get weaker (no automated native-menu proof); that is the state ADR-0164 already accepted.

### 3.2 What complexity is essential and should stay

| Control | Why it earned its keep (measured) |
|---|---|
| Blind dual audit with challenge-by-counter-proof (rule 70 item 4, ADR-0143 d1–2) | 13 data-loss Highs in the Findings table; D290 H1–H4, D305 H1, B7-H1; the D305 dispute was real and was settled by a lock-order argument. Keep, but tier it (ADR-0121's tiers exist): both auditors on High, one on Medium, none on Low and docs |
| CI as a landing gate (ADR-0095) with the `conditional-tests` lint and the inventory comparator (ADR-0128) | caught the vanishing registration (ADR128 r1) and every Linux-only break before `master`; vmark's whole gate is this |
| Device ACs before landing (ADR-0144) and the escapes ledger with release-time presence checks (ADR-0129 d5) | caught G-D326-2's false FAIL; would have caught D342; the five escape rows are the only replay set the project has |
| The landing verifier's ancestry, scope and receipts-union checks | caught D305's overwritten record, D319 Fix 1's unclaimed paths, the rebase unions |
| Worktree isolation, the heavy lock and the load guard (ADR-0134/0135/0150) | the load failures in G518-1, G-WI2-2, G-PAUSE-1 are what it was built against; the mini stayed up |
| ADR immutability and the audit log's quoted rulings | the only reason this report, the 10-30 audit and the rework assessment could be written from records |
| The command table → generated menu layout | the right design; it needs the lint, not removal |
| The matrix-and-attack step (rule 71) | credited with M3b H1 and D290 H1/H2; its cost is the "no third round" rulings, fixable by letting the implementor answer in-scope gaps (rework C6) |

### 3.3 Where my #575 assessment § 2 agrees or disagrees with this broader view

- **Agrees, and the broader view generalises it.** § 2 items 1 (serial discovery, one defect per host run), 2 (the fix loop stops on tooling more than product: nine of twenty rulings), 5 (a moving `master`) and 6 (heavy timing tests on a shared machine) are single instances of RC1, RC1, RC5 and RC3. The comparison shows they are structural: no competitor has a host-last proof, a receipt gate, a per-event docs commit or a 4:1 pyramid.
- **Disagrees on one framing.** § 2 item 4 ("one host, one operator, no retry") treated the wall-time cost of a failed Windows run as the price of quality. Against vmark and marktext it reads differently: the cost exists because the proof has no automated form on the target platform, so every failure needs a human-paced round. The fix is a harness or a runner (RC1 b/c, RC6), not more operator discipline. The recommendation I made there (decouple 0.3.6, run W036b by hand) was adopted as ADR-0164, which is consistent with this.
- **Disagrees on emphasis.** § 2 item 3 (a predicted failure was not pre-empted; the fix briefs skipped the matrix attack) suggested the attack step be kept on fix rounds. I still think so, but the broader record (six "no third round" rulings) says its cost is in the stop-and-ask shape, so the change is the one in § 3.2's last row, not more attack rounds.
- **The 10-30 audit and the 10-31 rework assessment** reach the same three priorities as this report (machine-verified landing, real-device smoke before landing, state-model tests for concurrency). The one place I weight differently from the 10-30 audit is its P0 "wire `land-guard` to the structured audit/device/AC state": with vmark and marktext as the reference, I would first remove the controls that catch nothing (RC1 a, RC2) and only then automate the ones that remain. Automating 45 kinds of exception is how the receipt line grew.

---

## 4. Separating facts from judgment

Facts: every table in § 1.1, § 1.2, § 2.1–2.3 and the evidence index. Judgment: § 1.3, § 2.4, § 3 and § 6. Two caveats on the facts:

- The competitor clones are shallow, so their commit and PR figures come from the GitHub API, which counts the default branch; marktext's `develop` is its integration branch, so its 334 commits understate activity (320 PRs merged).
- PR open-to-merge in mdpro understates the item's wall clock, because the PR is opened after the brief, matrix, attack, RED cycles and handoff; the `herdr-spike/` mtime table is the better bound, and it is still only the implementor's share.

"vmark has less process" is not by itself evidence that mdpro's is wasted. The evidence is in § 1.2's per-control table: the receipt gate's cost is measured and its catch is zero; the dual audit's cost is measured and its catch is thirteen data-loss Highs. The comparison only sharpens which is which.

---

## 5. Measured deltas that a four-week follow-up should watch

From the 10-30 audit § 9, with today's baseline:

| Metric | Today |
|---|---|
| Docs-and-config commits : code commits | 1,266 : 426 (3.0 : 1) |
| Always-on lines per session | 1,936 |
| Gate exceptions per landing | 45 rows over 46 ranges (≈ 1 per landing); 25+ receipt |
| Audit rounds per range (mean) | ≈ 2.0 (17×1, 13×2, 9×3, 6×2+pc, 2×4–5) |
| Escapes per audited range | 5 / 46 |
| PR open → merge, median, last week | 9.9 h |
| Product `feat` commits per week | ≈ 10 (25 in 2.3 weeks), 0 releases since 10-16 |
| CI wall time | 25 min, ceiling 30 |
| Test : product lines | 4.4 : 1 |

---

## 6. A short sequenced plan

**Now, inside the freeze (ADR-0160, ADR-0162 d5: no rule or ADR edits):**

1. **Stop granting tooling items.** No new receipt-tooling (#567 T-02/T-03), driver, load-guard or roster item until 0.3.6 ships; #575 continues on its own clock as ADR-0164 says. Grants are the delegator's; this needs no rule change.
2. **Stop registering a D number for a tooling stumble.** A PATH, lock, inventory or load failure gets a line in the handoff, not a sequencing row. Rule 70 says "the delegator registers"; it does not say every stumble is a D.
3. **Batch the delegator's docs commits to one per landing.** CLAUDE.md § User questions already permits batching "while a code handoff is in flight"; apply it to every docs-only commit. This alone removes most of the "rebased over docs-only master moves" rows.
4. **Move the `pwsh`-spawning D346 enumerations to `*.slow.test.ts`** (ADR-0050, no rule change) and raise `ci.yml` `timeout-minutes` to 45 (one line; the delegator's reading of ADR-0162 d5 on whether a budget is a gate condition).
5. **Run the Linux CI head before round one** (ADR-0162 d3, already decided) and keep doing it.

**First after 0.3.6, in this order:**

1. **One superseding ADR** that (a) demotes the receipt verdict to audit evidence and removes `check-pending` from the landing conditions (supersedes ADR-0145 d1/d4, ADR-0149 d2/d6, rule 10 § receipts), (b) tiers the audits as ADR-0121 intended (both on High, one on Medium, none on Low/docs; supersedes ADR-0143 d1 for the Low and Medium tiers), (c) executes ADR-0147 (rules 70/71 to a routing map). One plan review, one user decision, about a week.
2. **D323 as the first product grant**: the document-ownership model and property tests, then migrate the three ad hoc coordinators.
3. **The journey runner on the control channel**, starting from the nine cards; the device agent becomes the observer of a failed journey, not the driver. Add macOS `rust-test` to the PR matrix (flip the tag-only condition) and a `windows-latest` `cargo test` + `pnpm build` job.
4. **Consolidate `src-tauri`**: feature modules under `services/<feature>/` with tests in `#[cfg(test)]` and the 300-line rule read as pure lines (vmark's `max_pure_loc`); start with the file watcher and the menu, where the fan-out is worst.
5. **Add the lints that replace prose**: a keybinding-manifest lint over the command table, `menu_layout.json` and `keyboard-shortcuts.md` (rule 41 becomes a script); an `invoke`-to-command lint (vmark's `lint:ipc-contract`); the colour-literal ban already exists.
6. **Re-measure § 5 after four weeks** and retire whatever did not move.

---

## Evidence index

- Process sizes: `wc -l`, `find … | wc -l` over `CLAUDE.md`, `AGENTS.md`, `.claude/{rules,hooks,agents,skills,commands}`, `.agents/skills`, `.codex`, `scripts/*`, `.github/workflows`, `docs/{adr,plans,specs,audit,test/cards}` in each repo; always-on = `CLAUDE.md` plus every rule whose first 12 lines carry no `paths:`; hook wiring from `.claude/settings.json`.
- Delivery: `git log --since=2026-09-12` on `master` (type prefixes; paths `src src-tauri`; docs-only filter); `gh api search/issues q='repo:… is:pr is:merged'` (created/merged timestamps, comments); `gh pr list --json additions,deletions,changedFiles`; `gh api search/commits`; `gh api repos/…/releases`; `gh run list --workflow ci.yml` and `repos/…/actions/workflows/<w>/runs` for durations.
- Audit record: `docs/audit/audit-log.md` (46 range rows, 45 exception rows, 13 findings, 10 cost rows), `docs/audit/escapes.md` (5 rows); `~/.mdpro-redesign/herdr-spike/*/` file counts (`ls | grep -c ruling|handoff|stop|brief`), `ls -lT` mtimes.
- Architecture: `find`/`wc` by directory; `grep -c '#\[tauri::command\]'`; distinct `invoke(`/`listen(`/`emit` literals; `grep -rl toggle_sidebar|toggleSidebar|TOGGLE_SIDEBAR|toggle-sidebar`; `git diff --numstat base head` for the PR table with bases from the audit log; `git log --format=%h -- <file> | wc -l` for shared-file churn; `python3 -c json.load` on `receipts.json` (1,001 receipts).
- Competitors: `AGENTS.md`, `.claude/README.md`, `.claude/rules/{10,60,00,41}`, `.githooks/*`, `CONTRIBUTING.md`, `e2e/README.md`, `package.json` scripts (vmark); `AGENTS.md`, `packages/*/`, `.github/workflows/{test,e2e,build,release}.yml`, `packages/desktop/test/e2e` (marktext).
- Earlier assessments: `PR575-assessment.md`, `rework-assessment.md`, the user's 10-30 audit, `docs/knowledge/20261027-repeated-development-and-token-cost.md`, ADR-0147/0160/0162/0164 status lines.

---

## 中文摘要（给用户）

1. mdpro 的产品本身不大：前端 5 万行、Rust 产品代码 4.7 万行，与 marktext 桌面包同量级，是 vmark 的五分之一。大的是产品周围的东西。
2. 9 月 12 日以来 1,435 次提交，其中 1,266 次只动文档和 agent 配置，426 次动产品代码；161 份 ADR，16 天内新增 47 份；每个 session 常驻加载 1,936 行规则（vmark 127 行，marktext 301 行）。
3. 测试是产品代码的 4.4 倍（vmark 2 倍，marktext 0.7 倍），732 个应用测试里 301 个以 D 号或 ADR 号命名，84 个文件在 Mac 上模拟 Windows PowerShell；PR CI 只跑 Ubuntu，没有 macOS、没有 Windows、没有自动化真机用例。
4. 收据门禁（receipts）占 38 条门禁例外里的 25 条，`receipts.json` 11 MB、385 次提交、每个 PR 带进几千行；记录里没有一个缺陷是它抓到的。双盲审计抓到了 13 个会丢数据的 High，这是该保留的。
5. 10 月 16 日以来产品 feat 提交 25 次、零发布；PR 从开到合的中位数从 0.2 小时升到 9.9 小时；D346 一项 392 个文件、21 条裁定、12 次停工。
6. 根因排序：① 证明链路串行、真机最后、大半轮次花在工具自身；② 流程簿记占了多数工作且在任务进行中变更；③ 测试金字塔倒置、在 Mac 上模拟平台；④ 并发/所有权每个功能各写一套；⑤ 共享文件（收据、排序文档、ledger）让每个 PR 互相冲突；⑥ Windows 靠自研远程驱动而不是 CI runner。
7. vmark 的做法是 45 个 lint 脚本和 52 条真机 journey 替代人工规则；marktext 是 147 个 Playwright 用例和六平台构建；两者都没有收据、没有多 agent 编制、没有逐 PR 的双审计。
8. 与我 11-01 的 #575 评估一致，只是把那些现象归到结构原因；不同点是「单主机、无重试」不是必然代价，而是没有自动化真机证明的后果。
9. 冻结期内就能做：停止新授予工具类事项、工具性小故障不再登记 D 号、delegator 文档提交按落地批量、慢测试移到 slow tier、CI 超时提到 45 分钟。
10. 0.3.6 之后第一步：一份 ADR 把收据降为审计证据、按风险分级审计、落实 ADR-0147 精简规则 70/71；然后 D323 所有权模型、把控制通道做成 journey runner、PR CI 加 macOS 和 Windows、合并 src-tauri 零散文件、用 lint 替代 rule 41 和 IPC 对照。
11. 该保留的：双盲审计加反证挑战、CI 门禁、真机 AC、落地校验器、worktree 隔离与负载保护、ADR 不可变。
12. 四周后按第 5 节的基线重新量一次，没动的控制就退役。

DONE /Users/jack/.mdpro-redesign/herdr-spike/opus-auditor/delivery-friction-report.md
