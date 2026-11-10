Part of #700 (MIG-003 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §5 MIG-003, §15 row MIG-003, §17 metrics. Map #678; decisions resolved in #685 (user: all eight "(Recommended)"). Grill record `MIG003-r1-D1`…`D24` (user: 「all recommended」, 「all yes」, then 「All five (Recommended)」); seams (user: 「Yes, these seams (Recommended)」); the gate-sensitive handoff rule (user: 「GS draft, tickets independent (Recommended)」). Revision r2 closes the round-1 plan review (merged C0 H2 M8 L4: MH1, MH2, MM1–MM8, four Lows) with `MIG003-r2-D25`…`D28` (user, after a read-only Codex consult: 「Issue, lane on, owner+date (Recommended)」, 「Exact-mismatch list (Recommended)」, 「Provisional + definitions (Recommended)」, 「New ticket c0, c blocked by it (Recommended)」). Tier High (CI); gated (rule 12); record Issue; ADR flag on ticket c (test dependency, draft attached to the handoff); the five tickets are not gate-sensitive, and the handoff rule is a separate gate-sensitive decision-log draft; no device AC. Landing dep: MIG-001 (#697), whose slice a (#706) has landed. Snapshot: `docs/specs/mig-003-ci-protection/r2/` (r1, committed at `8f19748a`, is superseded). Written at master `8f19748a`.

## Problem Statement

The Tiptap migration rewires the editor, the Markdown pipeline, the dependency tree and, for Windows Preview, platform Rust code. Today's CI protects mdpro well where it already looks, and not at all where the migration will hurt:

- **`scope` knows one thing.** `change-scope.mjs` answers only `code=true|false` (prose-only or not). A change to `pnpm-lock.yaml`, the Milkdown presets, the IPC commands or Windows-only Rust is just "code", so nothing tells the delegator that such a change needs evidence beyond the Linux PR run.
- **Native platforms are not checked before a release.** `rust-test` runs on Ubuntu for PRs and adds macOS only on `v*` tags. Windows is built only by the hand-dispatched `build-windows.yml`. `cargo clippy` runs nowhere. "Linux green" is all a Windows-affecting PR can show.
- **No real WebKit runs the editor.** Every editor test runs in jsdom. The app runs in WKWebView. Milkdown's behaviour in a real WebKit has no baseline, so M2 has nothing to compare Tiptap-on-WebKit against.
- **The gate's fault handling is proved only in pieces.** Fixture tests cover parts of a missing shard (`gh639-shard-reports`), a pending result (`adr128-ci-comparator`) and the classifier's fail-safe (`ci-change-scope`), but no single place shows that each named fault class turns the Required Gate red, and none has been seen red on GitHub.
- **No CI metrics baseline exists.** Plan §17 defines PR wall-clock, queue time, runner minutes and flake rate, but nobody collects them, so a milestone cannot say whether CI got slower.

Policy bounds the fix. ADR-0095 decision 7, as folded into `landing-and-audit.md` § PR CI by the 2026-11-08 decision, keeps the native platform lanes and the real-WebKit lane off the pull-request run; `ci-gate`'s `needs` and decision bytes are pinned by tests. GitHub dispatches a workflow only when its file is on the default branch, so a new advisory workflow can produce run evidence only after it lands.

## Solution

Minimal CI protection, in five tickets, none of which changes a PR's gate result:

- **Risk classes from `scope`.** `scope` keeps `code` byte-identical and adds six informational outputs, `deps`, `editor`, `pipeline`, `ci`, `ipc` and `platform`, from a written path-to-class table; the CLI writes one job-summary line. Nothing in `ci.yml` reads them.
- **Fault injection.** Each of four fault classes (missed shard, classifier failure, pending test, platform failure) has a mutation-RED fixture test and one live red run on GitHub whose run id and decisive failing line are recorded.
- **A native advisory workflow.** `platform-advisory.yml` runs `cargo check`, `cargo clippy -D warnings` and `cargo test` on macOS and Windows, nightly on master and on `workflow_dispatch`. A vacuous or failed run is red.
- **A browser-safe corpus seam, then a WebKit advisory workflow.** The shared MIG-001 corpus modules drop their Node-only APIs behind the same exports; then `webkit-advisory.yml` runs categories a, d, g and l in real WebKit through Vitest browser mode, against the committed baselines and a user-approved exact-mismatch list. It adds two devDependencies (ADR draft).
- **A bootstrap.** Each advisory workflow lands on static evidence (file pins and checker cases); the delegator then dispatches it on master and records the first runs. A red first run becomes an owned follow-up issue; the lane stays enabled.
- **A metrics script.** `scripts/ci/metrics.mjs` is a local, read-only reader of the GitHub Actions API that the delegator runs at the M0 baseline and at each milestone gate, writing outside the repo, and reporting each lane against a provisional time budget.
- **A handoff rule, separately.** When a risk class is true, landing needs a successful advisory run at the handoff SHA. That is a landing condition, so it is a gate-sensitive decision-log draft with its own review and the user's approval (MIG003-r1-D24); no ticket waits for it, and each lane's mapping activates only after that lane's first green master run (MIG003-r2-D25).

## User Stories

1. As the delegator, I want `scope` to name which risk classes a PR touches, so that I know which advisory run the landing needs without reading the diff.
2. As the delegator, I want the job summary to show the risk classes on one line, so that I can read them from the PR's checks page.
3. As the delegator, I want every risk class true when `scope` has no PR base, git fails or the diff is empty, so that an unknown change asks for every lane.
4. As a reviewer, I want `code` and `ci-gate` byte-identical, so that adding risk classes cannot change a single PR's gate result.
5. As a reviewer, I want every existing pin that a ticket must edit named in the ticket with its exact permitted edit, so that a pin is never loosened mid-cycle.
6. As a reviewer, I want each edited pin shown to still fail on a change it guarded, so that the edit narrows nothing else.
7. As an implementor, I want a path-to-class table with one test case per row, so that I can tell which class my change sets before I hand it off.
8. As an implementor, I want a change to `pnpm-lock.yaml` or `Cargo.lock` to set `deps`, so that a dependency bump is checked on native runners.
9. As an implementor, I want a change under the Milkdown plugins, the editor component, the editor port or a Milkdown helper (whatever its capitalisation) to set `editor`, so that it is checked in real WebKit.
10. As an implementor, I want a change to the Markdown presets, link definitions, list spread, empty paragraphs, tables, sanitizer or export to set `pipeline` (and `editor`), so that serialization changes are checked in real WebKit.
11. As an implementor, I want a change to IPC commands, capabilities or the `invoke()` wrappers to set `ipc`, so that both sides of the contract are compiled on native runners.
12. As an implementor, I want any `src-tauri/**` change to set `platform`, so that Windows-only and macOS-only Rust is compiled where it runs.
13. As an implementor, I want a change to `.github/**`, `scripts/ci/**` or the WebKit lane's own files to set `ci`, so that it is visibly a CI change, whose evidence is the PR's own `ci-gate`.
14. As an implementor, I want a prose-only change to set no class, so that docs work asks for nothing.
15. As an implementor, I want a code change matching no class to set none, while `code` stays true, so that ordinary UI work needs no advisory run.
16. As the delegator, I want a missed shard to turn `ci-gate` red in a fixture and in one live run, so that I have seen the gate catch it.
17. As the delegator, I want a crashed `scope` job to turn `ci-gate` red in a fixture and in one live run, so that a classifier failure never skips the heavy jobs silently.
18. As the delegator, I want the classifier's own fail-safe (`code=true` on an error) kept as the green control, so that the fault fixtures distinguish a crash from a safe answer.
19. As the delegator, I want a required test reported as `pending` or `todo` to turn the gate red, so that an unfinished test cannot pass as a pass.
20. As the delegator, I want a test collected but never started to turn the gate red, so that a lost test cannot pass silently.
21. As the delegator, I want a fault class that no mutation can turn red to stop ticket a as a finding, so that a real hole in the gate is reported rather than papered over.
22. As the delegator, I want each live red run accepted only with its decisive failing line quoted, so that a red for an unrelated reason is not evidence.
23. As the delegator, I want a deliberately failing `cargo test` on a fault branch to turn the native lane red on that test, so that I have seen a platform failure show.
24. As the delegator, I want every live red run's id, branch SHA, draft PR number and decisive line in the confirm record, so that the evidence can be found again.
25. As the user, I want fault branches named `ci-fault/<class>`, marked DO NOT MERGE and closed unmerged, so that a mutation never reaches master.
26. As the user, I want the native lane on macOS and Windows with `fail-fast: false`, so that one platform's failure does not hide the other's result.
27. As the user, I want `clippy -D warnings` on both platforms, never narrowed without my approval, so that platform-specific warnings are caught before a release.
28. As the delegator, I want a native run with zero tests, no `test result:` line or a `test result: FAILED` line to fail, and the pipe never to mask `cargo test`'s exit, so that neither a vacuous nor a failed run is green.
29. As the delegator, I want the native lane to stub the sidecar binary as `rust-test` does, so that the lane does not build the release sidecar.
30. As the delegator, I want the native lane's Rust cache saved only by the nightly master run, so that a PR branch never seeds master's cache.
31. As the delegator, I want both advisory workflows to run nightly on master, so that drift on master shows within a day.
32. As the delegator, I want each new workflow to land on static evidence and be dispatched by me right after, so that the first-run evidence exists at all.
33. As the delegator, I want a red first run to become an issue with an owner and a target date while the lane stays on, so that a broken lane is visible and owned rather than hidden.
34. As the user, I want a lane's handoff-rule mapping to activate only after its first green master run, so that a broken lane never blocks every landing.
35. As the delegator, I want to dispatch either advisory workflow on a branch with `gh workflow run --ref`, and check the run's `head_sha`, so that a run is evidence only for the commit it ran on.
36. As the user, I want neither advisory workflow to run on `pull_request`, `push` or `v*`, so that heavy checks stay off the PR run as § PR CI requires.
37. As the user, I want a red nightly to reach me by GitHub's failed-run email and the Actions tab, with the delegator opening an issue when one is seen, so that no automation posts on my behalf.
38. As the MIG-001 owner, I want the browser-safe corpus seam proved byte-identical under jsdom, so that the corpus's existing results cannot move.
39. As the delegator, I want the WebKit lane to reuse the corpus driver, comparator, fixtures and baselines unchanged, through one browser entry, so that WebKit and jsdom results compare case by case.
40. As the delegator, I want categories a, d, g and l picked up from the corpus data as each lands, so that the WebKit lane needs no edit when MIG-001 adds one.
41. As the delegator, I want a WebKit mismatch that is not on the accepted list to turn the run red, so that a WebKit difference is seen and triaged.
42. As the user, I want each accepted WebKit mismatch to pin the exact observed output, with an issue and a reason, approved by me, so that an exception cannot hide a new regression in the same case.
43. As the delegator, I want a listed mismatch whose output changed, or a listed case that now matches, to fail the run, so that the list never goes stale.
44. As the M2 planner, I want each WebKit run's actual outputs and browser versions kept as an artifact, so that Tiptap-on-WebKit is compared against Milkdown-on-WebKit.
45. As the delegator, I want a WebKit run with no case to fail, so that a vacuous green is impossible.
46. As the user, I want the WebKit test dependencies as devDependencies with the browser installed only in CI, so that nothing reaches the app bundle or a developer's `pnpm install`.
47. As the user, I want the WebKit lane never described as replacing the macOS WKWebView device card, so that device evidence stays the device tester's.
48. As the delegator, I want ticket c to start with a spike that runs one category-a case in browser mode, so that a dead end stops before the full lane is built.
49. As the delegator, I want `metrics.mjs` to report PR wall-clock P50/P90, queue time, runner minutes by OS, the rerun rate and the flake rate, so that each milestone has the §17 numbers.
50. As the delegator, I want runner minutes to include both advisory workflows, so that the macOS and Windows cost is visible.
51. As the delegator, I want an advisory nightly pass rate per workflow, so that a lane that is often red is seen at the milestone gate.
52. As the delegator, I want each lane's job wall time reported against its budget, with "insufficient data" below five runs, so that a slow lane is seen without a misleading number.
53. As the delegator, I want test-level flake reported as `unavailable(n runs)` when the artifacts have expired, so that a missing number is never shown as zero.
54. As the user, I want metrics written only under `~/.mdpro-redesign/metrics/`, with no file content and no scheduled workflow, so that nothing about my documents leaves my machine.
55. As the delegator, I want the M0 window to be the four weeks before the first run, so that the baseline is fixed and repeatable.
56. As an implementor, I want my handoff to list the risk classes from a local `change-scope.mjs` run at my SHA, so that the delegator knows which lane to dispatch.
57. As the delegator, I want the handoff rule to be a gate-sensitive decision-log entry with a truth table, reviewed by both auditors and approved by the user, so that a new landing condition goes through the route every landing condition takes.
58. As the delegator, I want lane runs recorded but not required until that entry lands, so that the tickets can land without waiting for the policy review.
59. As a reviewer, I want each advisory workflow's triggers, permissions, concurrency, shell and timeouts pinned by a test, so that a later edit cannot add a `pull_request` trigger or mask a failure unnoticed.
60. As the delegator, I want the spec to name the timer-flush success-count event as MIG-005 (#704) or MIG-026's, so that §17's save/flush failure rate has an owner outside MIG-003.

## Implementation Decisions

### Vocabulary

- **Risk class** (MIG003-r1-D1): a named area a change touches (`deps`, `editor`, `pipeline`, `ci`, `ipc`, `platform`) for which a handoff needs a successful advisory-lane run at its SHA, once the handoff rule is in force. It never decides how a change lands or which PR checks run. It is not the glossary's **Change scope** (prose, policy or code). Candidate glossary entry: planner `glossary-candidates.md`.
- **Advisory workflow**: a workflow outside `ci.yml`, triggered only by `schedule` on master and `workflow_dispatch`, whose red never fails a PR check.
- **Vacuous run**: a lane run that ran no test (zero tests, no summary line, or zero corpus cases). It counts as a failure.
- **Fault class**: one of missed shard, classifier failure, pending test and platform failure.
- **Bootstrap run**: the delegator's first dispatch of a newly landed advisory workflow on master (and, for b, on `ci-fault/platform`).
- **Accepted mismatch**: one WebKit corpus case whose exact observed output differs from its committed jsdom baseline, listed with an issue and a reason and approved by the user.

### Risk classes from `scope` (ticket a; MIG003-r1-D2, D16)

- `change-scope.mjs` keeps `classifyPaths` and the `code=` line byte-identical. It adds an exported pure classifier from a list of paths to the six booleans, and the CLI appends six more `<class>=true|false` lines to `$GITHUB_OUTPUT` (stdout when unset), after the `code=` line. It still always exits 0.
- **Semantics.** A path may set several classes. A prose path (today's prose lists) sets none. A code path that matches no class sets none, and `code` stays true. An empty BASE (tags, dispatch), a git failure, or an empty diff (where `classifyPaths([])` already answers `code`) sets every class true.
- **Path-to-class table** (one test case per row; globs relative to the repo root; `[Mm]` is a character class):

  | Class | Globs |
  |---|---|
  | `deps` | `package.json`, `pnpm-lock.yaml`, `patches/**`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `scripts/deps/**` |
  | `editor` | `src/plugins/**`, `src/components/Editor/**`, `src/services/editor/**`, `src/utils/cursorSync/**`, `src/utils/*[Mm]ilkdown*`, `src/utils/editorMenu*`, and every `pipeline` glob |
  | `pipeline` | `src/plugins/milkdown/commonmarkPreset.ts`, `src/plugins/milkdown/gfmPreset.ts`, `src/plugins/milkdown/linkDefinitions/**`, `src/plugins/milkdown/listSpread/**`, `src/plugins/milkdown/emptyParagraph/**`, `src/plugins/milkdown/table/**`, `src/services/sanitizerPolicy.ts`, `src/services/exportService.ts`, `src/services/mathRender.ts`, `src/services/highlightSyntax.ts` |
  | `ci` | `.github/**`, `scripts/ci/**`, `scripts/heavy-lock.sh`, `vitest*.ts`, `tests/ci-inventory.json`, `tests/webkit/**` |
  | `ipc` | `src-tauri/src/commands/**`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/**`, `src/services/**` |
  | `platform` | `src-tauri/**` |

  `src/services/editor/**` does not exist at `8f19748a`; it is the editor port's home (MIG-005, rule 50) and sets both `editor` and, through `src/services/**`, `ipc`.
- **Job summary.** The CLI, not a workflow step, appends one line to `$GITHUB_STEP_SUMMARY` when it is set (as `failure-summary.mjs` does): `Risk classes: deps=<b> editor=<b> pipeline=<b> ci=<b> ipc=<b> platform=<b>`, followed by ` (all true: no PR base)`, ` (all true: git failed)` or ` (all true: empty diff)` when forced.
- **`ci.yml`.** The `scope` job's `outputs:` gains exactly six lines, `<class>: ${{ steps.scope.outputs.<class> }}`. No step changes. No other job reads the new outputs. `ci-gate`'s `needs`, its decision step and its `continue-on-error` are unchanged.
- **Not gate-sensitive** (MIG003-r1-D9): no gate result changes. The pins this edit touches, and the exact permitted edit to each, are listed under § Pins.

### Pins (MH2)

Each ticket edits only the pins named here, and only as stated. Any other existing test the ticket's change turns red stops the ticket for the delegator; it is never edited to pass.

| Ticket | Pinned test | Why it breaks | Permitted edit | Still fails when |
|---|---|---|---|---|
| a | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "keeps every other job byte-identical to the base" | `scope` gains six `outputs:` lines, so `job(TEXT, "scope")` ≠ the base | compare `scope` after removing exactly the six lines `<class>: ${{ steps.scope.outputs.<class> }}` (one per class, in table order); `prose-checks`, `rust-test`, `rust-audit` and the job list unchanged | any other byte of `scope`, `prose-checks`, `rust-test` or `rust-audit` changes, or a seventh output appears |
| a | `tests/tooling/ci-change-scope.test.ts` › "writes code=false for a prose-only range", "writes code=true when the range touches code", "writes code=true and exits 0 when the base cannot be resolved" | each asserts the whole `$GITHUB_OUTPUT` as one `code=` line | the expected `output` becomes the exact seven-line string: the same `code=` line first, then the six class lines for that case | the `code=` line, the order, or any class value differs |
| c | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run" | c adds `vitest.webkit.config.ts` at the root | the expected root config set becomes the base set plus exactly `vitest.webkit.config.ts`; the `vitest.config.ts` byte check and the threshold checks unchanged | any other root `vitest*.config.*` is added, or `vitest.config.ts` changes |

- **Unedited guards that cover the rest**: `ci-workflow-gate.test.ts` › "preserves the ci-gate decision bytes from GH607's pinned base" (ci-gate), `gh639-frontend-shard-shape.test.ts` › "keeps each shard's setup steps as they were, unconditioned, once each, and none of them in the merge job" (frontend), and the other GH639 `frontend-merge` cases. Tickets a and c show, by a mutation-RED case for each edited pin, that it still fails as the last column says; and their handoff's diff of `tests/tooling/` touches no other pinned case.
- Tickets b, c0 and d expect no pin edit.

### Fault injection (ticket a, and ticket b for platform; MIG003-r1-D3, D4, D14, D19, D20)

- **Missed shard**: a shard's blob artifact is absent, or a shard's report is missing or empty. Red where `shard-reports.mjs` refuses it.
- **Classifier failure**: the `scope` job crashes (a non-zero exit before outputs are written). Red at `ci-gate`, which requires `scope` to succeed. The classifier's own fail-safe, `code=true` on a git error, is the green control.
- **Pending test**: (i) a required identity reported `pending` or `todo`; (ii) an identity collected but never started, so that shard and merged started identities differ. Ticket a's matrix names one mutation for each and its first cycle proves the fixture red. The live run uses a mutation that turns `ci-gate` red. If no mutation of (i) or (ii) can, that is a gate finding: ticket a stops for the delegator and the gap becomes its own issue.
- **Platform failure**: a deliberately failing `cargo test` on a fault branch, dispatched on `platform-advisory.yml` after b lands, turns that run red. This live run is b's bootstrap.
- **Fixtures** run the real gate jq, `shard-reports.mjs`, `compare-report.mjs` and `change-scope.mjs` on mutated inputs. Each fixture is a mutation-RED test: it fails against the mutation and passes against the unmutated input.
- **Decisive lines (MM2).** A live red counts only when the confirm record quotes the line that decides it, from the run's log:

  | Class | Decisive line (substring) |
  |---|---|
  | missed shard | `blob artifact missing`, or `.ci-vitest-results.json missing or empty` |
  | pending (i) | `Incomplete or failed test:` naming the mutated identity with `(pending)` or `(todo)`, or `Inventory test incomplete:` naming it |
  | pending (ii) | `merged started identities differ from shard reports` naming the mutated identity |
  | classifier failure | the `scope` job's failing step, and `ci-gate: a job ended in failure, was cancelled, or skipped without scope's code=false` |
  | platform failure | `test <the named fault test> ... FAILED`, on the OS the fault targets |

- **Live runs.** The implementor commits each mutation on a local `ci-fault/<class>` branch (one commit, subject starting `DO NOT MERGE`), and the handoff names each SHA, the job expected red and its decisive line. The delegator pushes it, opens a draft PR (or, for platform, dispatches after b lands), records the run id and decisive line, and closes the PR unmerged. Remote `ci-fault/*` branches stay thirty days (ADR-0084); a local branch deletion asks the user (rule 25).

### Bootstrap (tickets b and c; MIG003-r2-D25)

- A workflow can be dispatched only once its file is on the default branch. So b and c land on **static** acceptance (workflow pins, checker cases, the spike for c), and no AC needs a run before landing. No temporary `push` or `pull_request` trigger is ever added.
- **After the fast-forward**, the delegator dispatches the workflow on master (`gh workflow run <file> --ref master`), and for b also on the pushed `ci-fault/platform`. The landing record gives each run's id, `head_sha`, conclusion and, for a red, the decisive line.
- **b's clippy base run** is that master dispatch (this Mac has no clippy component; win-desktop is a device host). It settles whether today's code passes `clippy -D warnings` on both OSes.
- **A red bootstrap run** (other than the intended platform fault): the delegator opens a follow-up issue with an owner and a target date. The workflow stays enabled, so its nightlies stay red and visible. `-D warnings` is never narrowed by `cfg` or allow lists without the user's approval. For c, the follow-up issue's PR adds the user-approved accepted mismatches.
- **Activation.** A lane's mapping in the handoff rule takes effect only after that lane's first green run on master. Until then, a mapped class needs no citation (the GS draft's truth table carries this row).

### Native advisory workflow (ticket b; MIG003-r1-D5, D15, D17; MIG003-r2-D27)

- **`platform-advisory.yml`**, in the shape of `rust-audit-daily.yml`: `schedule` (`37 3 * * *`) and `workflow_dispatch` with no inputs; no `pull_request`, no `push`; `permissions: contents: read`; `concurrency` grouped per ref, never cancelling.
- **Matrix** `macos-latest` and `windows-latest`, `fail-fast: false`, `timeout-minutes: 60`.
- **Steps**: the stable toolchain with the clippy component; stub the sidecar for the target triple (`aarch64-apple-darwin`; `x86_64-pc-windows-msvc.exe`) as `rust-test` does; `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test` (all default targets, doc-tests included), its output piped to a file with `tee` in a step that sets `shell: bash` on both OSes (GitHub runs that as `bash -eo pipefail`, so the pipe cannot mask `cargo test`'s exit), then the vacuous checker.
- **Cache**: `Swatinem/rust-cache` under its own key `platform-advisory-<os>`, saved only on a `schedule` run on master.
- **Checker (MM3)**: a small Node CLI, a file in and an exit code out. It fails when no `test result:` line appears, when any `test result:` line says `FAILED`, or when the tests run total zero.

### Browser-safe corpus seam (ticket c0; MIG003-r2-D28)

- The shared corpus modules that the WebKit entry needs drop their Node-only APIs behind unchanged exports:
  - the recipe and metadata-guard SHA-256 checks use a synchronous SHA-256 that runs in both Node and a browser (a pure implementation in the corpus support, no new dependency), proved digest-identical to `node:crypto` on the committed recipes;
  - the negatives helper uses `TextEncoder` and `Uint8Array` in place of `Buffer`;
  - the runner is passed its environment explicitly (it already accepts `options.env`).
- **Proof**: the whole existing corpus suite passes unchanged under jsdom, and a test imports each changed module with Node built-ins unavailable.
- **Area**: these modules belong to MIG-001 (#697). The delegator sequences c0 against open MIG-001 tickets; c0 changes no corpus case, baseline or comparator rule.

### WebKit advisory workflow (ticket c; MIG003-r1-D6, D11, D12; MIG003-r2-D26, D27, D28)

- **Mechanism**: Vitest browser mode with the Playwright provider set to `webkit`, from **`vitest.webkit.config.ts` at the repo root**, which includes only `tests/webkit/**/*.webkit.tsx` (the perf lane's precedent: a non-`.test.` name that the default config never picks up).
- **Entry**: one browser entry under `tests/webkit/` loads the corpus manifests, fixtures and baselines for categories a, d, g and l with Vite raw imports, and runs each case through the unchanged driver, comparator and Tauri-boundary mocks (after c0). A category joins when its manifest lands; c does not wait for MIG-001 d, g or l. The six `corpus-a-driver-*` tests are out: they are driver unit tests, not corpus cases.
- **Dependencies** (ADR flag): `@vitest/browser` matching the repo's Vitest (`~3.2.7`) and an exact-pinned `playwright`, both devDependencies. The browser is installed in CI only, by `playwright install --with-deps webkit`. Draft: planner `adr-draft-webkit-test-dependency.md`.
- **Verdict (MM1)**: each case is compared with its committed corpus baseline. The run fails on an unlisted mismatch, on a listed mismatch whose observed output changed, on a listed case that now matches, and on any other error. Each **accepted mismatch** entry holds the case-id, the exact observed WebKit output for the differing part, an issue number and a reason; the user approves the initial list and every addition. c lands with an empty list. A run green under the list counts as `success` for the handoff rule; it means parity except the listed exceptions.
- **Artifact**: every run uploads the actual outputs for every case and the WebKit, Playwright and Vitest versions. This, with the list, is the WebKit baseline M2 compares against.
- **Checker**: the Vitest JSON report must hold at least one passed case.
- **`webkit-advisory.yml`**: `ubuntu-latest`; `timeout-minutes: 20`; `schedule` (`7 4 * * *`) and `workflow_dispatch` with no inputs; the same permissions and concurrency as the native workflow.
- **Spike first**: c's first cycle proves one category-a case green in WebKit through the entry. If the boundary mocks or another shared module still cannot run there, c stops for the delegator before the workflow is written.
- **Not device evidence**: macOS WKWebView acceptance stays on ADR-0144 device cards.

### Time budgets (MIG003-r2-D27; provisional, reviewed after measured runs)

| Lane | Timeout (red) | Budget (reported, never red) |
|---|---|---|
| native, per OS leg | 60 min | p90 ≤ 30 min on a warm cache (a `rust-cache` hit) |
| WebKit job | 20 min | p90 ≤ 10 min |
| `scope` on a PR | 5 min (unchanged) | the risk classes add ≤ 5 s; no other PR job changes |

- **Definitions**: job wall time is `started_at` → `completed_at`; queue time (`started_at − created_at`) is reported separately; the window is four weeks; fewer than five runs in the window reports `insufficient data`.
- An over-budget lane gets a delegator issue; only a timeout turns a run red. The metrics script is the check.

### Metrics (ticket d; MIG003-r1-D8, D21, D22; MIG003-r2-D27)

- `node scripts/ci/metrics.mjs --since <date> --until <date> --label <M0|Mn>`. Only read calls through the user's `gh` auth: runs, jobs, attempts and, for test-level flake, the merged JSON report artifacts.
- **Seam**: a pure function from recorded API responses to the metrics object; the CLI is a thin wrapper that fetches and writes.
- **Metrics** (§17): PR wall-clock P50/P90 over `ci.yml` `pull_request` runs of each PR's last head SHA, `run_started_at` to `ci-gate` completion, success and failure only; queue time; runner minutes by OS over `ci.yml`, `platform-advisory.yml` and `webkit-advisory.yml`; rerun rate (`run_attempt > 1` per head SHA); flake rate (a test identity failed then passed on the same head SHA) from artifacts, else `unavailable(<n> runs)`; advisory nightly pass rate per workflow; each lane's job wall time p90 against § Time budgets, warm-cache legs only for native, `insufficient data` under five runs.
- **Output**: `~/.mdpro-redesign/metrics/<label>-<date>.json` and a short markdown summary beside it. No file content, no repo write, no scheduled workflow.
- **Who and when**: herdr-delegator, at the M0 baseline (window: the four weeks before the first run) and at each milestone gate.
- **A red nightly** becomes an issue when the user or the delegator sees it; nothing posts automatically. The pass-rate row is the backstop.
- **Out**: the save/flush failure rate needs the timer-flush success-count event, owned by MIG-005 (#704) or MIG-026 (MIG003-r1-D10).

### Handoff rule (gate-sensitive draft; MIG003-r1-D7, D14, D24; MIG003-r2-D25, D26)

- **Mapping**: `platform`, `ipc` or `deps` → the native lane; `editor` or `pipeline` → the WebKit lane; `ci` → no lane (the PR's `ci-gate` is the evidence). Each lane's mapping takes effect only after its first green run on master.
- **The rule**: the implementor's handoff lists the risk classes from a local `change-scope.mjs` run at the handoff SHA. The delegator pushes, dispatches each active mapped lane on that ref, and the confirm record cites a run whose `head_sha` is the handoff SHA and whose conclusion is `success` (for WebKit, green under the accepted-mismatch list). Failure, cancelled, skipped, timed out, missing or another SHA is not evidence. Only the user waives, by words quoted in the confirm record.
- **Status**: an unnumbered, gate-sensitive decision-log draft, planner `gs-draft-advisory-lane-citation.md`, with its truth table. It needs both auditors' plan and policy review and the user's approval, and changes rule 70 § Commits and branches, `landing-and-audit.md` and the implementor handoff template when it lands. No ticket blocks on it. Until it lands, the delegator records lane runs but they are not a landing condition.

### Slices (MIG003-r1-D18; MIG003-r2-D28)

- a) risk classes, the summary line, the two pin edits, the fault fixtures and three live runs;
- b) the native workflow, its checker, the `ci-fault/platform` branch; bootstrap after landing;
- c0) the browser-safe corpus seam;
- c) the WebKit entry, config, checker, accepted-mismatch list (empty), workflow, the dependencies (ADR), the config-set pin edit; bootstrap after landing;
- d) the metrics script.

a blocks b and c; c0 blocks c; c0 and d have no MIG-003 blocker. c's grant also needs the dependency ADR accepted. Estimated counted production lines (`audit-dimensions.md` § Split recommendation): a ~120, b ~60, c0 ~0 (only `tests/` changes; it is not counted, but it touches MIG-001's area), c ~80, d ~280; `.github/`, `package.json` and the lockfile are not counted.

## Testing Decisions

- **A good test here** drives a script through its public interface (its exported function, or its CLI with a file or a temp git repo in and output lines or an exit code out) or reads a workflow file through the shared YAML block helpers. It never asserts on a private helper. A fault fixture is mutation-RED: it fails against the mutated input and passes against the unmutated one, and its RED receipt shows the mutation.
- **Seams** (user: 「Yes, these seams (Recommended)」):
  1. `change-scope`: the exported classifiers, plus the CLI run against a temp git repo, writing `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`. Prior art: `tests/tooling/ci-change-scope.test.ts`.
  2. Workflow YAML through `tests/support/workflowBlocks`: the ci-gate pin, the `scope` outputs, the two advisory workflows' triggers, permissions, concurrency, matrix, shell, timeouts and steps. Prior art: `tests/tooling/ci-workflow-gate.test.ts`, `tests/tooling/rust-audit-daily-workflow.test.ts`.
  3. Fault fixtures over the real gate jq, `shard-reports.mjs`, `compare-report.mjs` and `change-scope.mjs`. Prior art: `tests/tooling/gh639-shard-reports.test.ts`, `tests/tooling/adr128-ci-comparator.test.ts`.
  4. New: the two checkers as CLIs.
  5. New: `metrics.mjs` as a pure function over recorded API responses, fixtures under `tests/fixtures/`.
  6. WebKit reuses the corpus driver, comparator and data under the new config through one entry; its own tests are the config's selection, the entry's case discovery, the accepted-mismatch matching and the checker. c0's proof is the existing corpus suite plus an import test without Node built-ins.
- **Pins**: each edited pin keeps a mutation-RED case for what it still guards (§ Pins).
- **Live evidence** is not a test: each live red run, and each bootstrap run, is a run id with its decisive line in the handoff, confirm or landing record.
- **Placement** follows rule 10: `tests/tooling/*.test.ts`, Node environment; the WebKit entry under `tests/webkit/`, outside the default lane by its name. No new test needs a prerequisite tag, so `tests/ci-inventory.json` is unchanged.
- **Every ticket** follows `jack-tdd-workflow`: matrix, a fresh attacker's matrix attack, a RED receipt per case, then `/code-review`.

## Out of Scope

- Any change to `ci-gate`'s `needs`, its decision step, or which jobs a PR runs; any new `pull_request` or `push` job, temporary or not (§ PR CI).
- Making any advisory lane a PR check; that takes its own gate-sensitive entry.
- The Windows installer build (`build-windows.yml`) and the Windows App Journey device batches (WIN-005, ADR-0144 decision 6).
- macOS WKWebView device acceptance; Preview identity isolation (WIN-002).
- The timer-flush success-count event and the save/flush failure rate (MIG-005 #704 or MIG-026).
- Tiptap on WebKit (M2).
- Any corpus case, baseline or comparator rule change (MIG-001's).
- An Architecture Guard or IPC inventory check (MIG-007a/b, DEC-002).
- Automated notification of a red nightly; a scheduled metrics workflow.
- A feature-ledger row: nothing here is user-visible app behaviour.

## Further Notes

- **Plan drift (overridden here, fixed in the next plan revision):** §5's "必测路径" wording becomes informational risk classes (every class is already `code=true`); §17 and §5's "MIG-003/026" owner of the timer-flush event becomes MIG-005 (#704) or MIG-026. #700 names MIG-005 as #689, the closed wayfinder ticket; the row issue is #704.
- **Classification change from #700:** #700 says "No GS". The tickets are not gate-sensitive, but the handoff rule is a landing condition, which the 2026-11-08 decision says "needs its own gate-sensitive entry"; the user chose a separate draft that no ticket waits for (MIG003-r1-D24). #700's body note is the delegator's.
- **Ticket graph change in r2:** a fifth ticket, c0, and the edge c ← c0 (MIG003-r2-D28). a → b and a → c stand; d stays free.
- **Supersessions in r2:** D11's "runners unchanged" becomes "driver, comparator and data unchanged, through one entry"; D12's glob over runner files becomes the entry's discovery of category manifests; D13's "no WebKit baseline file" becomes the accepted-mismatch list plus run artifacts; D5's `timeout-minutes: 45` becomes 60, and its `--all-targets` applies to check and clippy, not to test.
- **Delegator flags:** ticket c's dependency ADR (draft, unnumbered); the gate-sensitive draft; glossary candidate **Risk class**; c0 touches MIG-001's area.
- **Open fact, now owned:** whether today's code passes `clippy -D warnings` is unknown at `8f19748a`; b's bootstrap master dispatch settles it on both OSes.

### Citations (checked at master `93c7e9bb`; no cited path changed since `8f19748a`)

| Cited | Path and name | Exists | Quoted assertion or sentence |
|---|---|---|---|
| change-scope fail-safe | `tests/tooling/ci-change-scope.test.ts` › "answers code for an empty list (fail-safe)" | yes | test title |
| change-scope CLI outputs | `tests/tooling/ci-change-scope.test.ts` › "writes code=false for a prose-only range" | yes | `expect(run("docs/adr/0001-x.md")).toEqual({ status: 0, output: "code=false\n" })` |
| change-scope CLI on a bad base | `tests/tooling/ci-change-scope.test.ts` › "writes code=true and exits 0 when the base cannot be resolved" | yes | `output: "code=true\n"` |
| scope output pinned | `tests/tooling/ci-workflow-gate.test.ts` › "scope exposes the change-scope output" | yes | `expect(entry(entry(scope, "outputs")?.body ?? null, "code")?.inline).toBe("${{ steps.scope.outputs.code }}")` |
| ci-gate byte pin | `tests/tooling/ci-workflow-gate.test.ts` › "preserves the ci-gate decision bytes from GH607's pinned base" | yes | `expect(list(job(TEXT, "ci-gate"), "needs")).toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"])` |
| scope job byte pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "keeps every other job byte-identical to the base" | yes | `for (const id of ["scope", "prose-checks", "rust-test", "rust-audit"]) expect(job(TEXT, id), id).toBe(job(base, id))` |
| root config pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "leaves vitest.config.ts byte-identical, adds no vitest config, and overrides thresholds only on the shard run" | yes | `expect(configs(fs.readdirSync(ROOT).join("\n"))).toEqual(configs(stdout))` |
| frontend setup pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "keeps each shard's setup steps as they were, unconditioned, once each, and none of them in the merge job" | yes | `expect(now.slice(0, profileIndex + 1)).toEqual(base.slice(0, profileIndex + 1))` |
| missed shard (artifact) | `tests/tooling/gh639-shard-reports.test.ts` › "refuses when a shard's artifact is missing, and writes nothing" | yes | test title; `scripts/ci/shard-reports.mjs:49` `blob artifact missing` |
| missed shard (report) | `scripts/ci/shard-reports.mjs:83` | yes | `.ci-vitest-results.json missing or empty` |
| started identities | `scripts/ci/shard-reports.mjs:175` | yes | `merged started identities differ from shard reports` |
| pending result | `tests/tooling/adr128-ci-comparator.test.ts` › "rejects an unexplained static or runtime skip in a partially passing file" | yes | `for (const status of ["skipped", "pending"]) expect(run(report([…]), list).status).not.toBe(0)` |
| pending in the comparator | `scripts/ci/compare-report.mjs:81` | yes | `if (result.status === "pending" \|\| result.status === "failed") findings.push(`Incomplete or failed test: …`)` |
| inventory incomplete | `scripts/ci/compare-report.mjs:77` | yes | `findings.push(`Inventory test incomplete: …`)` |
| todo leaves `required` | `scripts/ci/compare-report.mjs:96` | yes | `ci.filter((item) => item.status !== "todo" && …)` |
| ci-gate failure line | `.github/workflows/ci.yml`, `ci-gate` decision step | yes | `ci-gate: a job ended in failure, was cancelled, or skipped without scope's code=false` |
| no base outside a PR | `.github/workflows/ci.yml`, `scope` job comment | yes | "Outside a pull request (tags, manual runs) BASE is empty, and the script answers code=true." |
| summary precedent | `scripts/ci/failure-summary.mjs:151` | yes | `if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output)` |
| sidecar stub precedent | `.github/workflows/ci.yml`, `rust-test` step "Create sidecar stub for build.rs" | yes | `touch src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` |
| schedule + dispatch shape | `.github/workflows/rust-audit-daily.yml:6–7` (one sentence across two comment lines) | yes | "A failure shows only in the Actions tab and GitHub's failed-run email, not on any pull request." |
| dispatch needs default branch | GitHub Docs, "Events that trigger workflows" › `workflow_dispatch` (external) | external; quoted in both r1 audit reports | "This event will only trigger a workflow run if the workflow file exists on the default branch." |
| heavy lanes off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
| handoff rule is GS | `docs/agents/decisions/20261108-short-checks-may-run-on-prs.md`, Costs | yes | "MIG-003's rule that a handoff cites a native or WebKit success at its SHA is a landing condition. It is not decided here, and needs its own gate-sensitive entry." |
| GS definition | `docs/agents/decisions/README.md` § Gate-sensitive entries, lines 26–27 | yes | "An entry is gate-sensitive when it changes:" / "- a landing or CI condition;" |
| ADR-0107 decision 2 | `docs/adr/0107-cargo-audit-runs-in-its-own-job-outside-the-landing-gate.md` | yes | "**`ci-gate` does not need `rust-audit`.**" |
| ADR-0084 | `docs/adr/0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md` | yes | "A branch on `origin` is kept thirty days after its work lands" |
| dependency is ADR scope | `CLAUDE.md:114–115` § Architecture Decision Records (ADR-0165; wraps at "persisted") | yes | "an IPC or MCP contract, a persisted format or preference key, a dependency, …" |
| split counting | `docs/agents/audit-dimensions.md` § Split recommendation | yes | "Counted: `src/`, `src-tauri/src/`, `scripts/`, `.claude/` and `.agents/`." |
| corpus driver boundary | `docs/specs/mig-001-golden-corpus/r5/spec.md` § Engine driver | yes | "It replaces only the Tauri boundary: the API modules and the native opener." |
| runner is Node-bound | `tests/corpus-a-empty-paragraphs.any.test.tsx:5–6` | yes | `const { resolve, isAbsolute } = await import('node:path');` / `const { loadCorpus } = await import('../scripts/corpus/core.ts');` |
| crypto in recipes | `tests/support/corpus/recipes.ts:2` | yes | `import { createHash } from 'node:crypto';` |
| crypto in metadata guard | `tests/support/corpus/metadataGuard.ts:2` | yes | `import { createHash } from 'node:crypto';` |
| Buffer in negatives | `tests/support/corpus/negatives.ts:5` | yes | `const bytes = Buffer.from(text, 'utf8');` |
| runner env option | `tests/support/corpus/runner.ts:50` | yes | `const env = options.env ?? process.env;` |
| perf lane naming precedent | `vitest.perf.config.ts:16` | yes | `include: ["tests/perf/**/*.perf.ts"],` |
| default lane include | `vitest.config.ts:31` | yes | `include: ["tests/**/*.test.{ts,tsx}"],` |
| Milkdown helpers | `src/utils/milkdownFocusCarry.ts`, `src/utils/focusActiveMilkdownAtEnd.ts` | yes | files exist |
| category a runner | `tests/corpus-a-empty-paragraphs.any.test.tsx` | yes | file exists (category a, MIG-001a) |
| Vitest version | `package.json` devDependencies | yes | `"vitest": "~3.2.7"` |
