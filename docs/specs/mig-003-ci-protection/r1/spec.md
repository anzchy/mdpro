Part of #700 (MIG-003 row). Plan: `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` §5 MIG-003, §15 row MIG-003, §17 metrics. Map #678; decisions resolved in #685 (user: all eight "(Recommended)"). Grill record `MIG003-r1-D1`…`D24` (user: 「all recommended」, 「all yes」, then 「All five (Recommended)」); seams (user: 「Yes, these seams (Recommended)」); the gate-sensitive handoff rule (user: 「GS draft, tickets independent (Recommended)」). Tier High (CI); gated (rule 12); record Issue; ADR flag on ticket c (test dependency, draft attached to the handoff); the four tickets are not gate-sensitive, and the handoff rule is a separate gate-sensitive decision-log draft; no device AC. Landing dep: MIG-001 (#697), whose slice a (#706) has landed. Snapshot: `docs/specs/mig-003-ci-protection/r1/`. Written at master `ddc60447`.

## Problem Statement

The Tiptap migration rewires the editor, the Markdown pipeline, the dependency tree and, for Windows Preview, platform Rust code. Today's CI protects mdpro well where it already looks, and not at all where the migration will hurt:

- **`scope` knows one thing.** `change-scope.mjs` answers only `code=true|false` (prose-only or not). A change to `pnpm-lock.yaml`, the Milkdown presets, the IPC commands or Windows-only Rust is just "code", so nothing tells the delegator that such a change needs evidence beyond the Linux PR run.
- **Native platforms are not checked before a release.** `rust-test` runs on Ubuntu for PRs and adds macOS only on `v*` tags. Windows is built only by the hand-dispatched `build-windows.yml`. `cargo clippy` runs nowhere. "Linux green" is all a Windows-affecting PR can show.
- **No real WebKit runs the editor.** Every editor test runs in jsdom. The app runs in WKWebView. Milkdown's behaviour in a real WebKit has no baseline, so M2 has nothing to compare Tiptap-on-WebKit against.
- **The gate's fault handling is proved only in pieces.** Fixture tests cover parts of a missing shard (`gh639-shard-reports`), a pending result (`adr128-ci-comparator`) and the classifier's fail-safe (`ci-change-scope`), but no single place shows that each named fault class turns the Required Gate red, and none has been seen red on GitHub.
- **No CI metrics baseline exists.** Plan §17 defines PR wall-clock, queue time, runner minutes and flake rate, but nobody collects them, so a milestone cannot say whether CI got slower.

Policy bounds the fix. ADR-0095 decision 7, as folded into `landing-and-audit.md` § PR CI by the 2026-11-08 decision, keeps the native platform lanes and the real-WebKit lane off the pull-request run; `ci-gate`'s `needs` and decision bytes are pinned by tests.

## Solution

Minimal CI protection, in four tickets, none of which changes a PR's gate result:

- **Risk classes from `scope`.** `scope` keeps `code` byte-identical and adds six informational outputs, `deps`, `editor`, `pipeline`, `ci`, `ipc` and `platform`, from a written path-to-class table, plus one job-summary line. Nothing in `ci.yml` reads them.
- **Fault injection.** Each of four fault classes (missed shard, classifier failure, pending test, platform failure) has a mutation-RED fixture test and one live red run on GitHub whose run id is recorded.
- **A native advisory workflow.** `platform-advisory.yml` runs `cargo check`, `cargo clippy -D warnings` and `cargo test` on macOS and Windows, nightly on master and on `workflow_dispatch`. A vacuous run fails.
- **A WebKit advisory workflow.** `webkit-advisory.yml` runs the existing MIG-001 corpus runners for categories a, d, g and l in real WebKit through Vitest browser mode, against the committed baselines. It adds two devDependencies (ADR draft).
- **A metrics script.** `scripts/ci/metrics.mjs` is a local, read-only reader of the GitHub Actions API that the delegator runs at the M0 baseline and at each milestone gate, writing outside the repo.
- **A handoff rule, separately.** When a risk class is true, landing needs a successful advisory run at the handoff SHA. That is a landing condition, so it is a gate-sensitive decision-log draft with its own review and the user's approval (MIG003-r1-D24); no ticket waits for it.

## User Stories

1. As the delegator, I want `scope` to name which risk classes a PR touches, so that I know which advisory run the landing needs without reading the diff.
2. As the delegator, I want the job summary to show the risk classes on one line, so that I can read them from the PR's checks page.
3. As the delegator, I want every risk class true when `scope` has no PR base or git fails, so that an unknown change asks for every lane.
4. As a reviewer, I want `code` and `ci-gate` byte-identical, so that adding risk classes cannot change a single PR's gate result.
5. As an implementor, I want a path-to-class table with one test case per row, so that I can tell which class my change sets before I hand it off.
6. As an implementor, I want a change to `pnpm-lock.yaml` or `Cargo.lock` to set `deps`, so that a dependency bump is checked on native runners.
7. As an implementor, I want a change under the Milkdown plugins or the editor component to set `editor`, so that it is checked in real WebKit.
8. As an implementor, I want a change to the Markdown presets, link definitions, list spread, empty paragraphs, tables, sanitizer or export to set `pipeline` (and `editor`), so that serialization changes are checked in real WebKit.
9. As an implementor, I want a change to IPC commands, capabilities or the `invoke()` wrappers to set `ipc`, so that both sides of the contract are compiled on native runners.
10. As an implementor, I want any `src-tauri/**` change to set `platform`, so that Windows-only and macOS-only Rust is compiled where it runs.
11. As an implementor, I want a change to `.github/**` or `scripts/ci/**` to set `ci`, so that it is visibly a CI change, whose evidence is the PR's own `ci-gate`.
12. As an implementor, I want a prose-only change to set no class, so that docs work asks for nothing.
13. As an implementor, I want a code change matching no class to set none, while `code` stays true, so that ordinary UI work needs no advisory run.
14. As the delegator, I want a missed shard to turn `ci-gate` red in a fixture and in one live run, so that I have seen the gate catch it.
15. As the delegator, I want a crashed `scope` job to turn `ci-gate` red in a fixture and in one live run, so that a classifier failure never skips the heavy jobs silently.
16. As the delegator, I want the classifier's own fail-safe (`code=true` on an error) kept as the green control, so that the fault fixtures distinguish a crash from a safe answer.
17. As the delegator, I want a required test reported as `pending` or `todo` to turn the gate red, so that an unfinished test cannot pass as a pass.
18. As the delegator, I want a test collected but never started to turn the gate red, so that a lost test cannot pass silently.
19. As the delegator, I want a fault class that no mutation can turn red to stop ticket a as a finding, so that a real hole in the gate is reported rather than papered over.
20. As the delegator, I want a deliberately failing `cargo test` on a fault branch to turn the native lane red, so that I have seen a platform failure show.
21. As the delegator, I want every live red run's id, branch SHA and draft PR number in the confirm record, so that the evidence can be found again.
22. As the user, I want fault branches named `ci-fault/<class>`, marked DO NOT MERGE and closed unmerged, so that a mutation never reaches master.
23. As the user, I want the native lane on macOS and Windows with `fail-fast: false`, so that one platform's failure does not hide the other's result.
24. As the user, I want `clippy -D warnings` on both platforms, so that platform-specific warnings are caught before a release.
25. As the delegator, I want a native run with zero tests or no `test result:` line to fail, so that a vacuous green is impossible.
26. As the delegator, I want the native lane to stub the sidecar binary as `rust-test` does, so that the lane does not build the release sidecar.
27. As the delegator, I want the native lane's Rust cache saved only by the nightly master run, so that a PR branch never seeds master's cache.
28. As the delegator, I want both advisory workflows to run nightly on master, so that drift on master shows within a day.
29. As the delegator, I want to dispatch either advisory workflow on a branch with `gh workflow run --ref`, and check the run's `head_sha`, so that a run is evidence only for the commit it ran on.
30. As the user, I want neither advisory workflow to run on `pull_request` or `v*`, so that heavy checks stay off the PR run as § PR CI requires.
31. As the user, I want a red nightly to reach me by GitHub's failed-run email and the Actions tab, with the delegator opening an issue when one is seen, so that no automation posts on my behalf.
32. As the delegator, I want the WebKit lane to run the MIG-001 corpus runners unchanged, so that WebKit and jsdom results compare case by case.
33. As the delegator, I want the WebKit lane to select categories a, d, g and l by glob, so that each joins on its own as its MIG-001 ticket lands.
34. As the delegator, I want a WebKit mismatch against a committed baseline to turn the run red, so that a WebKit difference is seen and triaged.
35. As the delegator, I want a WebKit run with no matched case to fail, so that a vacuous green is impossible.
36. As the M2 planner, I want Milkdown's WebKit results on the same baselines, so that Tiptap-on-WebKit is compared against Milkdown-on-WebKit.
37. As the user, I want the WebKit test dependencies as devDependencies with the browser installed only in CI, so that nothing reaches the app bundle or a developer's `pnpm install`.
38. As the user, I want the WebKit lane never described as replacing the macOS WKWebView device card, so that device evidence stays the device tester's.
39. As the delegator, I want ticket c to start with a spike that runs one category-a runner in browser mode, so that a dead end stops before the full lane is built.
40. As the delegator, I want `metrics.mjs` to report PR wall-clock P50/P90, queue time, runner minutes by OS, the rerun rate and the flake rate, so that each milestone has the §17 numbers.
41. As the delegator, I want runner minutes to include both advisory workflows, so that the macOS and Windows cost is visible.
42. As the delegator, I want an advisory nightly pass rate per workflow, so that a lane that is often red is seen at the milestone gate.
43. As the delegator, I want test-level flake reported as `unavailable(n runs)` when the artifacts have expired, so that a missing number is never shown as zero.
44. As the user, I want metrics written only under `~/.mdpro-redesign/metrics/`, with no file content and no scheduled workflow, so that nothing about my documents leaves my machine.
45. As the delegator, I want the M0 window to be the four weeks before the first run, so that the baseline is fixed and repeatable.
46. As an implementor, I want my handoff to list the risk classes from a local `change-scope.mjs` run at my SHA, so that the delegator knows which lane to dispatch.
47. As the delegator, I want the handoff rule to be a gate-sensitive decision-log entry with a truth table, reviewed by both auditors and approved by the user, so that a new landing condition goes through the route every landing condition takes.
48. As the delegator, I want lane runs recorded but not required until that entry lands, so that the tickets can land without waiting for the policy review.
49. As a reviewer, I want each advisory workflow's triggers, permissions and concurrency pinned by a test, so that a later edit cannot add a `pull_request` trigger unnoticed.
50. As the delegator, I want the spec to name the timer-flush success-count event as MIG-005 (#704) or MIG-026's, so that §17's save/flush failure rate has an owner outside MIG-003.

## Implementation Decisions

### Vocabulary

- **Risk class** (MIG003-r1-D1): a named area a change touches (`deps`, `editor`, `pipeline`, `ci`, `ipc`, `platform`) for which a handoff needs a successful advisory-lane run at its SHA, once the handoff rule is in force. It never decides how a change lands or which PR checks run. It is not the glossary's **Change scope** (prose, policy or code). Candidate glossary entry: planner `glossary-candidates.md`.
- **Advisory workflow**: a workflow outside `ci.yml`, triggered only by `schedule` on master and `workflow_dispatch`, whose red never fails a PR check.
- **Vacuous run**: a lane run that ran no test (zero tests, no summary line, or zero matched corpus cases). It counts as a failure.
- **Fault class**: one of missed shard, classifier failure, pending test and platform failure.

### Risk classes from `scope` (ticket a; MIG003-r1-D2, D16)

- `change-scope.mjs` keeps `classifyPaths` and the `code=` line byte-identical. It adds an exported pure classifier from a list of paths to the six booleans, and the CLI appends six more `<class>=true|false` lines to `$GITHUB_OUTPUT` (stdout when unset). It still always exits 0.
- **Semantics.** A path may set several classes. A prose path (today's prose lists) sets none. A code path that matches no class sets none, and `code` stays true. An empty BASE (tags, dispatch) or a git failure sets every class true.
- **Path-to-class table** (one test case per row; globs relative to the repo root):

  | Class | Paths |
  |---|---|
  | `deps` | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `scripts/deps/**` |
  | `editor` | `src/plugins/**`, `src/components/Editor/**`, `src/utils/cursorSync/**`, `src/utils/*Milkdown*`, `src/utils/editorMenu*`, and every `pipeline` path |
  | `pipeline` | the Milkdown `commonmarkPreset` and `gfmPreset`; the Milkdown `linkDefinitions`, `listSpread`, `emptyParagraph` and `table` folders; `src/services/{sanitizerPolicy,exportService,mathRender,highlightSyntax}.ts` |
  | `ci` | `.github/**`, `scripts/ci/**`, `scripts/heavy-lock.sh`, `vitest*.ts`, `tests/ci-inventory.json` |
  | `ipc` | `src-tauri/src/commands/**`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/**`, `src/services/**` |
  | `platform` | `src-tauri/**` |

- **`ci.yml`.** The `scope` job's `outputs:` gains six entries mapped from the step. A step appends one line to `$GITHUB_STEP_SUMMARY`: `Risk classes: deps=<b> editor=<b> pipeline=<b> ci=<b> ipc=<b> platform=<b>`, followed by ` (all true: no PR base)` or ` (all true: git failed)` when forced. No other job reads the new outputs. `ci-gate`'s `needs`, its decision step and its `continue-on-error` are unchanged.
- **Not gate-sensitive** (MIG003-r1-D9): no gate result changes; the existing ci-gate byte pin keeps holding, and a new case pins that no job other than `scope` names a risk-class output.

### Fault injection (ticket a, and ticket b for platform; MIG003-r1-D3, D4, D14, D19, D20)

- **Missed shard**: a shard's blob artifact is absent, or a shard's report is missing or empty. Red where `shard-reports.mjs` refuses it.
- **Classifier failure**: the `scope` job crashes (a non-zero exit before outputs are written). Red at `ci-gate`, which requires `scope` to succeed. The classifier's own fail-safe, `code=true` on a git error, is the green control.
- **Pending test**: (i) a required identity reported `pending` or `todo`; (ii) an identity collected but never started, so that shard and merged started identities differ. Ticket a's matrix names one mutation for each and its first cycle proves the fixture red. The live run uses a mutation that turns `ci-gate` red. If no mutation of (i) or (ii) can, that is a gate finding: ticket a stops for the delegator and the gap becomes its own issue.
- **Platform failure**: a deliberately failing `cargo test` on a fault branch, dispatched on `platform-advisory.yml`, turns that run red. This live run is ticket b's.
- **Fixtures** run the real gate jq, `shard-reports.mjs`, `compare-report.mjs` and `change-scope.mjs` on mutated inputs. Each fixture is a mutation-RED test: it fails against the mutation and passes against the unmutated input.
- **Live runs.** The implementor commits each mutation on a local `ci-fault/<class>` branch (one commit, subject starting `DO NOT MERGE`), and the handoff names each SHA and the job or finding expected red. The delegator pushes it, opens a draft PR (or dispatches, for platform), records the run id, and closes the PR unmerged. Remote `ci-fault/*` branches stay thirty days (ADR-0084); a local branch deletion asks the user (rule 25).

### Native advisory workflow (ticket b; MIG003-r1-D5, D15, D17)

- **`platform-advisory.yml`**, in the shape of `rust-audit-daily.yml`: `schedule` (`37 3 * * *`) and `workflow_dispatch` with no inputs; no `pull_request`, no `push`; `permissions: contents: read`; `concurrency` grouped per ref, never cancelling.
- **Matrix** `macos-latest` and `windows-latest`, `fail-fast: false`, `timeout-minutes: 45`.
- **Steps**: stub the sidecar for the target triple (`aarch64-apple-darwin`; `x86_64-pc-windows-msvc.exe`) as `rust-test` does; `cargo check --all-targets`; `cargo clippy --all-targets -- -D warnings`; `cargo test`, its output tee'd to a file and checked by the vacuous checker.
- **Cache**: `Swatinem/rust-cache` under its own key `platform-advisory-<os>`, saved only on a `schedule` run on master.
- **Vacuous checker**: a small Node CLI, a file in and an exit code out. It fails when no `test result:` line appears or the tests run total zero.
- **Existing warnings.** No workflow runs clippy today. Ticket b's first cycle runs the lane on its base; if clippy or a test is red on existing code, b stops for the delegator with the list, and the fix is its own issue. The lane is never weakened to turn green.

### WebKit advisory workflow (ticket c; MIG003-r1-D6, D11, D12, D13)

- **Mechanism**: Vitest browser mode with the Playwright provider set to `webkit`, from a separate Vitest config that runs the existing MIG-001 corpus runners unchanged, including their `vi.mock` Tauri boundary. It supersedes D6's `@playwright/test`.
- **Dependencies** (ADR flag): `@vitest/browser` matching the repo's Vitest (`~3.2.7`) and an exact-pinned `playwright`, both devDependencies. The browser is installed in CI only, by `playwright install --with-deps webkit`. Draft: planner `adr-draft-webkit-test-dependency.md`.
- **Selection**: runners matching `tests/corpus-{a,d,g,l}-*.any.test.tsx`. Category a exists today; d, g and l join as MIG-001 lands them. Ticket c does not wait for them.
- **Verdict**: each case is compared with its committed corpus baseline (Milkdown under jsdom). A mismatch makes the run red. The delegator triages each mismatch into an issue (jsdom artifact or real WebKit behaviour). No WebKit-specific baseline file exists.
- **Vacuous checker**: the Vitest JSON report must hold at least one passed case.
- **`webkit-advisory.yml`**: `ubuntu-latest`; `schedule` (`7 4 * * *`) and `workflow_dispatch` with no inputs; the same permissions and concurrency as the native workflow. The results are uploaded as an artifact.
- **Spike first**: c's first cycle proves one category-a runner green in WebKit. If the boundary mocks or a jsdom-only API cannot run there, c stops for the delegator before the workflow is written.
- **Not device evidence**: macOS WKWebView acceptance stays on ADR-0144 device cards.

### Metrics (ticket d; MIG003-r1-D8, D21, D22)

- `node scripts/ci/metrics.mjs --since <date> --until <date> --label <M0|Mn>`. Only read calls through the user's `gh` auth: runs, jobs, attempts and, for test-level flake, the merged JSON report artifacts.
- **Seam**: a pure function from recorded API responses to the metrics object; the CLI is a thin wrapper that fetches and writes.
- **Metrics** (§17): PR wall-clock P50/P90 over `ci.yml` `pull_request` runs of each PR's last head SHA, `run_started_at` to `ci-gate` completion, success and failure only; queue time (`started_at − created_at`); runner minutes by OS over `ci.yml`, `platform-advisory.yml` and `webkit-advisory.yml`; rerun rate (`run_attempt > 1` per head SHA); flake rate (a test identity failed then passed on the same head SHA) from artifacts, else `unavailable(<n> runs)`; advisory nightly pass rate per workflow.
- **Output**: `~/.mdpro-redesign/metrics/<label>-<date>.json` and a short markdown summary beside it. No file content, no repo write, no scheduled workflow.
- **Who and when**: herdr-delegator, at the M0 baseline (window: the four weeks before the first run) and at each milestone gate.
- **A red nightly** becomes an issue when the user or the delegator sees it; nothing posts automatically. The pass-rate row is the backstop.
- **Out**: the save/flush failure rate needs the timer-flush success-count event, owned by MIG-005 (#704) or MIG-026 (MIG003-r1-D10).

### Handoff rule (gate-sensitive draft; MIG003-r1-D7, D14, D24)

- **Mapping**: `platform`, `ipc` or `deps` → the native lane; `editor` or `pipeline` → the WebKit lane; `ci` → no lane (the PR's `ci-gate` is the evidence). The WebKit mapping takes effect when ticket c lands.
- **The rule**: the implementor's handoff lists the risk classes from a local `change-scope.mjs` run at the handoff SHA. The delegator pushes, dispatches each mapped lane on that ref, and the confirm record cites a run whose `head_sha` is the handoff SHA and whose conclusion is `success`. Failure, cancelled, skipped, timed out, missing or another SHA is not evidence. Only the user waives, by words quoted in the confirm record.
- **Status**: an unnumbered, gate-sensitive decision-log draft, planner `gs-draft-advisory-lane-citation.md`, with its truth table. It needs both auditors' plan and policy review and the user's approval, and changes rule 70 § Commits and branches, `landing-and-audit.md` and the implementor handoff template when it lands. No ticket blocks on it. Until it lands, the delegator records lane runs but they are not a landing condition.

### Slices (detailed by `/to-tickets`; MIG003-r1-D18)

- a) risk classes, the summary line, the fault fixtures and three live runs;
- b) the native workflow, its vacuous checker and the platform live run;
- c) the WebKit workflow, its config and checker, the dependencies (ADR);
- d) the metrics script.

a blocks b and c; d is independent. c's grant also needs the dependency ADR accepted. Estimated counted production lines (`audit-dimensions.md` § Split recommendation): a ~120, b ~60, c ~80, d ~250; `.github/`, `package.json` and the lockfile are not counted.

## Testing Decisions

- **A good test here** drives a script through its public interface (its exported function, or its CLI with a file or a temp git repo in and output lines or an exit code out) or reads a workflow file through the shared YAML block helpers. It never asserts on a private helper. A fault fixture is mutation-RED: it fails against the mutated input and passes against the unmutated one, and its RED receipt shows the mutation.
- **Seams** (user: 「Yes, these seams (Recommended)」):
  1. `change-scope`: the exported classifiers, plus the CLI run against a temp git repo, writing `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`. Prior art: `tests/tooling/ci-change-scope.test.ts`.
  2. Workflow YAML through `tests/support/workflowBlocks`: the ci-gate pin, the `scope` outputs, the two advisory workflows' triggers, permissions, concurrency, matrix and steps. Prior art: `tests/tooling/ci-workflow-gate.test.ts`.
  3. Fault fixtures over the real gate jq, `shard-reports.mjs`, `compare-report.mjs` and `change-scope.mjs`. Prior art: `tests/tooling/gh639-shard-reports.test.ts`, `tests/tooling/adr128-ci-comparator.test.ts`.
  4. New: the two vacuous checkers as CLIs.
  5. New: `metrics.mjs` as a pure function over recorded API responses, fixtures under `tests/fixtures/`.
  6. WebKit reuses the MIG-001 corpus runners unchanged under the new config; its own tests are only the config's selection and the checker.
- **Live evidence** is not a test: each live red run, and each lane's first green dispatch, is a run id in the handoff or confirm record.
- **Placement** follows rule 10: `tests/tooling/*.test.ts`, Node environment. No new test needs a prerequisite tag, so `tests/ci-inventory.json` is unchanged.
- **Every ticket** follows `jack-tdd-workflow`: matrix, a fresh attacker's matrix attack, a RED receipt per case, then `/code-review`.

## Out of Scope

- Any change to `ci-gate`'s `needs`, its decision step, or which jobs a PR runs; any new `pull_request` job (§ PR CI).
- Making any advisory lane a PR check; that takes its own gate-sensitive entry.
- The Windows installer build (`build-windows.yml`) and the Windows App Journey device batches (WIN-005, ADR-0144 decision 6).
- macOS WKWebView device acceptance; Preview identity isolation (WIN-002).
- The timer-flush success-count event and the save/flush failure rate (MIG-005 #704 or MIG-026).
- Tiptap on WebKit (M2); a WebKit-specific baseline.
- An Architecture Guard or IPC inventory check (MIG-007a/b, DEC-002).
- Automated notification of a red nightly; a scheduled metrics workflow.
- A feature-ledger row: nothing here is user-visible app behaviour.

## Further Notes

- **Plan drift (overridden here, fixed in the next plan revision):** §5's "必测路径" wording becomes informational risk classes (every class is already `code=true`); §17 and §5's "MIG-003/026" owner of the timer-flush event becomes MIG-005 (#704) or MIG-026. #700 names MIG-005 as #689, the closed wayfinder ticket; the row issue is #704.
- **Classification change from #700:** #700 says "No GS". The tickets are not gate-sensitive, but the handoff rule is a landing condition, which the 2026-11-08 decision says "needs its own gate-sensitive entry"; the user chose a separate draft that no ticket waits for (MIG003-r1-D24).
- **Delegator flags:** ticket c's dependency ADR (draft, unnumbered); the gate-sensitive draft; glossary candidate **Risk class**.
- **Open fact:** whether today's code passes `clippy -D warnings` on macOS is unknown at `ddc60447` (the planner's local run waited on the machine's heavy lock); ticket b's first cycle settles it on both platforms.

### Citations (checked at master `ddc60447`)

| Cited | Path and name | Exists | Quoted assertion or sentence |
|---|---|---|---|
| change-scope fail-safe | `tests/tooling/ci-change-scope.test.ts` › "answers code for an empty list (fail-safe)" | yes | test title |
| change-scope CLI on a bad base | `tests/tooling/ci-change-scope.test.ts` › "writes code=true and exits 0 when the base cannot be resolved" | yes | test title |
| scope output pinned | `tests/tooling/ci-workflow-gate.test.ts` › "scope exposes the change-scope output" | yes | `expect(entry(entry(scope, "outputs")?.body ?? null, "code")?.inline).toBe("${{ steps.scope.outputs.code }}")` |
| ci-gate byte pin | `tests/tooling/ci-workflow-gate.test.ts` › "preserves the ci-gate decision bytes from GH607's pinned base" | yes | `expect(list(job(TEXT, "ci-gate"), "needs")).toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"])` |
| missed shard (artifact) | `tests/tooling/gh639-shard-reports.test.ts` › "refuses when a shard's artifact is missing, and writes nothing" | yes | test title; `scripts/ci/shard-reports.mjs:49` `blob artifact missing` |
| missed shard (file) | `tests/tooling/gh639-shard-reports.test.ts` › "refuses a listed test file that no shard ran" | yes | test title |
| started identities | `scripts/ci/shard-reports.mjs:175` | yes | `merged started identities differ from shard reports` |
| pending result | `tests/tooling/adr128-ci-comparator.test.ts` › "rejects an unexplained static or runtime skip in a partially passing file" | yes | `for (const status of ["skipped", "pending"]) expect(run(report([…]), list).status).not.toBe(0)` |
| pending in the comparator | `scripts/ci/compare-report.mjs:81` | yes | `if (result.status === "pending" \|\| result.status === "failed") findings.push(…)` |
| todo leaves `required` | `scripts/ci/compare-report.mjs:96` | yes | `ci.filter((item) => item.status !== "todo" && …)` |
| no base outside a PR | `.github/workflows/ci.yml`, `scope` job comment | yes | "Outside a pull request (tags, manual runs) BASE is empty, and the script answers code=true." |
| sidecar stub precedent | `.github/workflows/ci.yml`, `rust-test` step "Create sidecar stub for build.rs" | yes | `touch src-tauri/binaries/mdpro_mcp-aarch64-apple-darwin` |
| schedule + dispatch shape | `.github/workflows/rust-audit-daily.yml` | yes | "A failure shows only in the Actions tab and GitHub's failed-run email, not on any pull request." |
| heavy lanes off the PR run | `.agents/skills/mdpro-delegator/references/landing-and-audit.md` § PR CI | yes | "the native platform lanes and the real-WebKit lane, which run on `schedule` and `workflow_dispatch` only (MIG-003)." |
| handoff rule is GS | `docs/agents/decisions/20261108-short-checks-may-run-on-prs.md`, Costs | yes | "MIG-003's rule that a handoff cites a native or WebKit success at its SHA is a landing condition. It is not decided here, and needs its own gate-sensitive entry." |
| GS definition | `docs/agents/decisions/README.md` § Gate-sensitive entries | yes | "An entry is gate-sensitive when it changes: a landing or CI condition; …" |
| ADR-0107 decision 2 | `docs/adr/0107-cargo-audit-runs-in-its-own-job-outside-the-landing-gate.md` | yes | "**`ci-gate` does not need `rust-audit`.**" |
| ADR-0084 | `docs/adr/0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md` | yes | "A branch on `origin` is kept thirty days after its work lands" |
| dependency is ADR scope | `CLAUDE.md` § Architecture Decision Records (ADR-0165) | yes | "an IPC or MCP contract, a persisted format or preference key, a dependency, …" |
| split counting | `docs/agents/audit-dimensions.md` § Split recommendation | yes | "Counted: `src/`, `src-tauri/src/`, `scripts/`, `.claude/` and `.agents/`." |
| corpus driver boundary | `docs/specs/mig-001-golden-corpus/r5/spec.md` § Engine driver | yes | "It replaces only the Tauri boundary: the API modules and the native opener." |
| category a runner | `tests/corpus-a-empty-paragraphs.any.test.tsx` | yes | file exists (category a, MIG-001a) |
| Vitest version | `package.json` devDependencies | yes | `"vitest": "~3.2.7"` |
