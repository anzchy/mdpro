# 0098. Launcher, tooling and perf tests move into their own folders under `tests/`

## Status

Accepted, 2026-10-15. Decided by the user, relayed by mdpro-delegator: 「Accept (Recommended)」, on
revision 7, after Codex's confirm-only pass returned READY TO ACCEPT (job `review-plan-mv95jjs7-v4s8a4`,
Critical 0, High 0, Medium 0, Low 0). Proposed by mdpro-a6 for mdpro-delegator.

User's direction, relayed by the delegator in queue 2026-10-15d: 「Yes, plan it with an ADR」. After the
Codex review of revision 1 (NEEDS REVISION, `a6-adr0098-codex-review.md`) the user chose
「Two phases (Recommended)」. This record decides **phase 1** only. Phase 2 needs its own ADR.
Revision 3 answered the re-review of revision 2 (`codex-rereview-adr0098-rev2.md`: D2.2, D2.5, D5.1,
N1–N4); revision 4 answered the third pass (`codex-rereview-adr0098-rev3.md`: R3.1–R3.7); revision 5
the fourth (`codex-rereview-adr0098-rev4.md`, job `review-plan-mv91tskk-0e752s`: N1–N5, and the
manifest growing to 167); revision 6 the fifth (`codex-rereview-adr0098-rev5.md`, job
`review-plan-mv934hxg-ztzop4`: P5.1, P5.2); revision 7 the sixth (`codex-rereview-adr0098-rev6.md`, job
`review-plan-mv94lp1l-rjqhva`: N6.1, N6.2).

Files named `a6-*` and `codex-*` below are the drafts, inventories and reviews kept under
`~/.mdpro-redesign/prep/` on the MacBook; they are not in the repo. The drafts called `a6-adr0098-*`
land as `scripts/redesign/adr0098-manifest.py`, `scripts/redesign/adr0098-apply.mjs` and
`tests/tooling/adr0098-apply.test.ts`.

## Context

`tests/` holds 819 tracked files at `74a4804`. 670 of them sit flat at the top, 664 of those test files.
The root `perf/` (4 files: the D12 heap harness) sits outside `tests/` altogether. A filename does not say
what system a test exercises. The 84 `control-*` and launcher tests, which test `scripts/control`, and
the 78 that test release, CI, ledger, lint and hook tooling, are mixed in with the app's tests. Those
two groups are the easiest to separate cleanly, and readers of app tests rarely need them.

The 15-project survey (`a6-repo-tree-research.md`) supports only a narrow claim. None of those projects
keeps hundreds of tests in one flat folder, but they split them by many different axes: kind (`e2e/`,
`bench/`), API area, package or crate, and co-location. So the survey does not pick an axis; mdpro's own
maintenance needs do.

The forces, measured at baseline `5604f23` (inventory scripts and outputs under `~/.mdpro-redesign/prep/`):

- **Collection is already recursive.** `vitest.config.ts` includes `tests/**/*.test.{ts,tsx}`, the slow
  glob is `tests/**/*.slow.test.{ts,tsx}`, and `setupFiles` is `tests/setup.ts`. No tdd-guardian lane
  names a test path. Coverage `include` is `src/`, `scripts/control/**` and `scripts/release/*`, so a
  move does not change it.
- **The only executable inbound references** from outside the moving files are `vitest.perf.config.ts` (`include: ["perf/**/*.perf.ts"]`)
  and `tsconfig.test.json` (`include` lists `"perf"`). Everything else that names a moving file is a
  comment or prose: 9 `.claude/hooks` files, `.github/scripts/canonicalize-body.mjs`,
  `.github/workflows/cc-feature-approval-recorder.yml`, `scripts/control/{buildInputsGuard,commentBlanker,persistenceRoots}.mjs`,
  `scripts/device/dragPlan.mjs`, `scripts/lint/no-bare-store-hook.mjs`, the `$comment` in
  `src-tauri/persistence-roots.json` (a JSON string; not read by any test, but it is under `src-tauri/`), 10 `tests/support|helpers` module headers, the feature ledger
  (md + html, 18 references), the sequencing doc (50), other docs (46), one ADR (0076), and 184 receipt citations.
- **Path references inside the 166 moving files**, counted by syntax, not by text search
  (`a6-adr0098-ast-inventory.mjs`, TypeScript's parser, reading git objects at the baseline;
  output `a6-adr0098-ast-inventory-5604f23.json`). Each must still reach the same file after the
  move:
  - **418 module references** (import, export-from, `import()`, `require()`, `vi.mock` and its
    kin, `import("…")` types): 203 `../scripts/…`, 191 `./support/…`, 16 `./helpers/…`, 3 `../src/…`,
    3 `./d12Heap` (perf, moves with its importers), 1 `../.github/…`, 1 `../vitest.workers`;
  - **44 anchor calls**: a `path.*` call or `new URL` that combines a directory anchor (`__dirname`,
    `import.meta.url`, `import.meta.dirname`) with a relative literal, e.g.
    `path.resolve(__dirname, "..")`, `new URL("../scripts/control", import.meta.url)`;
  - **53 derived anchors**: consts that hold such a directory (`REPO_ROOT`, `REPO`, `HERE` in
    `feature-loop-body-hash.test.ts:10`, …). The name is not rewritten; the anchor call that defines it is,
    and every later `path.join(REPO, "tests/…")` keeps working because it is repo-root-relative.
  - **Not references**: source text inside string or template literals. `control-build-inputs-guard*.test.ts`
    feed the guard fixture programs whose `import "../x"` and `new URL(…, import.meta.url)` resolve
    against a simulated `src/a/b.ts`. Those strings are test data and keep their bytes. So do comments,
    `process.cwd()` reads (2, `control-launcher-secrets`) and the 29 repo-root-relative `"tests/…"`
    literals, none of which depends on the file's depth.
  - Revision 2's 435 came from a regex and counted some fixture strings. It is withdrawn.
- **Receipts.** Two records are open on master: `ADR47-WI-1` (a Rust file) and `D182-WI-1`
  (`tests/d182-build-mac-masked-failure.test.ts`, recorded `runner-missing`, `red: false`). D182's
  record would settle as SEPARATION-BROKEN (`false-red`) whether or not the file moves. Settling it rewrites a
  parent record, which `mdpro-landing-verifier` step 4 rejects. tdd-guardian 0.10.2 never fingerprints a
  settled receipt again, but an open receipt whose file moved settles BROKEN (`spec-deleted-under-green`),
  permanently. Rewriting paths inside records is also rejected by the verifier.
- **CI.** `scripts/ci/change-scope.mjs` classifies `tests/` as code, so the PR runs the frontend and the
  Rust jobs, and rule 70 lands only on a green `ci-gate` at the exact SHA.
- **Build identity** hashes `tests/`, so any move changes the build id once.

## Options considered

1. **Status quo.** Free, and every citation stays live. Lost: the user asked for structure, and the flat folder
   grows with every D item.
2. **Full migration in one step** (revision 1: kind folders for all 670, `tests/helpers/` merged into
   `tests/support/`, manual notes moved). Lost on review:
   - its categories mixed system under test (`app`, `control`, `tooling`) with purpose (`contract`, `perf`);
   - the helper merge breaks `nodeEnvironmentGuard`'s own-path check;
   - moving `quick-test.md` breaks its `./assets/` image link;
   - D182's open receipt has no clean settlement;
   - about 2,800 specifier lines would change in one diff that needs a machine-wide freeze.
3. **Two phases (chosen by the user).** Phase 1 separates the two groups whose system under test is
   unambiguous (`scripts/control` and repo tooling) plus `perf/`, and does it in one atomic commit. Phase 2 regroups the
   app's tests by subsystem under a separate ADR, once its map has been reviewed.
4. **Path alias first (`@src/…`).** Lost for now. Phase 1 changes only 3 `../src/` specifiers, so an alias buys it
   nothing. Revisit in phase 2, where about 1,800 external specifiers would move.
5. **Co-locate tests under `src/`.** Lost: rule 10 and `vitest.config.ts` fix `tests/`, and ADR-0049's node
   marker assumes it.

Renaming `dNNN-*` files is out of scope in both phases. Rows, receipts and ADRs cite those names.

## Decision

### Membership: classified by the system under test, never by the filename

| Folder | A test belongs here when | Phase-1 count |
|---|---|---|
| `tests/control/` | its system under test is `scripts/control/**` or the launcher: `control-*` files, and any file whose imports or read paths reach `scripts/control` | 84 |
| `tests/tooling/` | it imports nothing from `src/`, and its system under test is repo tooling: `.github/` workflows and scripts, `.claude/hooks`, `scripts/{ci,ledger,lint,release,device}`, `heavy-lock`, the vitest configs. Reaching it through a `tests/support` reader counts | 78 at `5604f23`, 79 at `a436b0b` |
| `tests/perf/` | a `*.perf.ts` run by `vitest.perf.config.ts`, and its helper | 4 |
| `tests/` (root) | everything else, i.e. app behaviour, until phase 2 | ≈ 500 |

**Precedence**: control before tooling, and both win only when the file imports no `../src/`. A test that
touches both app source and tooling stays at the root. There is no `contract/` folder: purpose is not an
axis here.

**Future files**: rule 10 § File placement names the three folders and this table. A new test goes where its system
under test puts it, and anything in doubt stays at the root.

**One known override**: `tests/release-workflow-blocks.test.ts` → `tooling`. It reaches `release.yml` only
through `tests/support/workflowBlocks.ts`, which names no workflow path.

**Not moved in phase 1**:
- `tests/support/`, `tests/helpers/`, `tests/setup.ts`, every fixture folder, the manual notes. `nodeEnvironmentGuard`'s
  self-path and `quick-test.md`'s image link are therefore untouched.
- `tests/d182-build-mac-masked-failure.test.ts`, whose receipt is open. It is tooling by class and waits for phase 2,
  when its disposition is decided.

### The manifest and the two scripts

- **Manifest**: one machine-readable file, `docs/reference/adr-0098-test-move-map.json` (schema
  `mdpro-test-move-map/1`), committed in the moving commit and linked from this ADR. It names its
  baseline SHA and lists:
  - `{from, to, class}` moves sorted by `from`;
  - `excluded` entries, with reasons;
  - `overrides` entries, with reasons;
  - `stays_for_review`: tests that import `../src/` and also reach tooling. By the membership rule they
    stay at the root, and they are listed for a reviewer's eye, not moved (R3.1).

  It describes only `<baseline> → <migration SHA>`. Old paths in settled receipts, ADRs and sequencing
  rows are resolved through it, and are not rewritten.
- **Generator**, `scripts/redesign/adr0098-manifest.py <repo> <sha>`:
  - reads every file from git objects at `<sha>`, never from the working tree, so its output depends only
    on the SHA;
  - emits the whole manifest, including the four perf moves, the D182 exclusion and the override;
  - a borderline file stays at the root and is reported, so a legitimate new test never stops a
    regeneration;
  - at `5604f23`, `1d7aa9f`, `9b7e948` and `9cbde30` it emits the same reviewed 166 moves; at `a436b0b`
    it emits 167 (84 control, 79 tooling, 4 perf), the one addition being
    `tests/d223-snapshot-selectors.test.ts` → `tests/tooling/`, still with 1 exclusion, 1 override and
    an empty `stays_for_review`. Step 3 is where such a delta is accepted.

  Draft: `a6-adr0098-gen-manifest.py`.
- **Applier**, `scripts/redesign/adr0098-apply.mjs`, five modes:
  - `apply <repo> <manifest>`:
    - first refuses, before moving anything, on a duplicate destination, an existing destination or
      a missing source;
    - then `git mv`s, and rewrites only module specifiers and directory-anchor literals found by
      TypeScript's parser, at their AST positions;
    - each new path is computed from the reference's baseline target (mapped through the manifest if
      the target moves too) and the file's new directory, keeping the original's style (single string or
      split segments, `./`, extension or none).
  - `check`: in every moved file, every reference reaches its mapped baseline target, which exists, and
    **every byte outside the reference literals is identical** to the baseline file (R3.2). It runs
    right after `apply` and **before** `prose`; its output is kept as the byte proof (rev5 N1).
  - `check --refs-only`: the target half alone, for the tree after `prose` and the hand edits. Those
    change comments in moved files on purpose (11 files at `a436b0b`: the three perf tests,
    `control-build-smoke-checks`, `release-collect-assets`, `role-guard-hook`, `d177-h5-late-seen` and four
    `d184`/`d186` role-guard tests), so the byte half cannot hold there. What it would have proved is
    carried by step 7's rebuild comparison instead.
  - `prose`: whole-token replacement of old paths in non-history files (comments, docs, configs), and of
    glob citations a move made stale (a glob is stale when a moved file matched it at the baseline and
    no longer does). A glob is rewritten only when every file it matched moved to one folder; anything
    else is flagged for a hand edit. Its diff is reviewed by hand.
  - `residual`: no old path or stale glob is left outside the **explicit history list** (R3.4), and
    every entry on that list carries its reason. The list is in the applier and covers:
    - the manifest and the two scripts;
    - `receipts.json` and the tdd-guardian state;
    - ADR-0076 and ADR-0087 (immutable bodies);
    - **this ADR** (rev5 N5): it is accepted before the move, so its body (the override path above, the
      counts in Context) keeps baseline paths, with the manifest as the bridge;
    - two device records;
    - the d167 receipt-lines snapshot;
    - the sequencing doc (closed rows only; at `1d7aa9f` no open row cites a moved path, and the check is
      re-run at stage B);
    - the stage-4c plan (delivered);
    - the branch-consolidation plan (plan A kept as history; ADR-0083 took B);
    - the 2026-09-18 assessment (a dated snapshot);
    - the generated ledger HTML.

    Everything else, whatever its date, is a current instruction and is updated, for example the
    ADR-0047 control-channel plan and the vocabulary note (Status: Active). A new file citing an old path
    fails the check until it is updated or listed with a reason.
  - `tree [--expect <path>]…` (rev6 P5.1): `apply` (after its `git mv`), `prose`, the copies and
    `git apply` write the working tree only, so a bare `git write-tree` reads an index that never saw
    them. `tree` stages everything with `git add -A` (rewrites, renames, additions, deletions), then
    refuses with exit 4 if anything is still unstaged or untracked, if a destination or an `--expect`
    path is not in the index (an ignored file would otherwise drop out silently), or if a source still
    is. Only then does it print `git write-tree`. Steps 6 and 7 both take their tree from it. Every name
    list it reads comes from `-z` output, so a path Git would C-quote (a quote, a backslash, a control
    byte) is compared raw against the manifest (rev7 N6.1). A dangling `--expect` or any other flag
    exits 2 before anything is staged (rev7 N6.2).

  Draft: `a6-adr0098-apply-rev7.mjs` (rev6's with N6.1 and N6.2; rev6's and rev5's are kept).
- **Fixture tests** for the applier: `tests/tooling/adr0098-apply.test.ts`, run by the unit lane (rev5 N3).
  The draft (`a6-adr0098-apply.vitest.ts`) is a real Vitest file, not rev4's standalone runner:
  `// @vitest-environment node` (ADR-0049), `describe`/`it` with `expect`, typed helpers, the committed
  applier at `scripts/redesign/adr0098-apply.mjs` and the repo's own `typescript` reached from
  `__dirname`, each temp repo removed in `afterEach`, no `process.argv` and no `process.exit`. It passes
  `tsc` under `tsconfig.test.json`'s strict options (the repo has no prettier gate). In a scratch layout of
  the committed paths all **13 cases pass** against the rev7 applier; against rev6's, cases 11–13 fail;
  against rev5's, cases 9 and 10 fail too (no `tree` mode); against rev4's, case 8 fails as well. The
  cases cover:
  - imports, `vi.mock`, a `HERE` anchor, split segments, a repo-root `path.join(REPO, "tests/…")`, and
    `new URL`;
  - a fixture source string, and a comment naming an old path, both untouched;
  - a moving perf sibling, and an unmoved helper;
  - `check` failing on a byte changed outside the literals, and on a wrong target;
  - `apply` refusing a destination collision before moving anything, and refusing two moves to one place;
  - the N1 order: right after `apply` the byte check passes; `prose` then rewrites an old path in a moved
    file's comment; the byte check refuses that tree and `--refs-only` accepts it;
  - the P5.1 reconstruction: two rebuilds from the same base (`apply`, `prose`, a copied file) reach one
    tree through `tree`, and it is the tree of the commit made from that index; a bare `git write-tree`
    right after `apply` gives a different, stale tree;
  - `tree` refusing when an `--expect` file is gitignored;
  - the N6.1 names: a destination named `q"a.test.ts` is found in the index, and the same name left
    behind as a source is refused;
  - N6.2: `--expect` with no path, `--expect --expect x`, `--refs-only` and a stray word each exit 2,
    print no tree, and leave the index as it was.
- **Dry run** (2026-10-15, scratch clones at `5604f23`, outside the repo):
  - `apply`: 166 moved, 459 rewritten (3 perf-sibling `./d12Heap` imports needed none);
  - `check`: all 462 references (418 module, 44 anchor) reach their old targets, and every moved file is
    byte-identical outside its reference literals. The fixture strings in `control-build-inputs-guard*`
    keep their bytes;
  - moved control and tooling tests: 158 files, 3382 passed, 2 failed. Both failures are `ledger:check`
    correctly reporting the ledger's stale path claims before the hand edits;
  - the four moved `*.slow.test.ts`: 14 passed under the slow config. With the perf include edited,
    `vitest list` collects the 3 perf tests;
  - `prose` changed 45 files; `residual` then reports only the two perf-config globs, which are the hand
    edit.
- **Rev5 dry run** (2026-10-15, two independent `git clone --shared` scratch clones at `a436b0b`, the rev5
  applier and the 167-move map):
  - `apply`: 167 moved, 460 rewritten in 164 files; `check`: 463 references, 0 problems (the byte proof);
  - `prose`: 45 files changed, and the same two perf-config globs flagged for the hand edit;
  - after `prose`, `check` reports exactly the 11 files N1 named, and `check --refs-only` passes;
  - both clones end at the same tree, `059316c`, so the step-7 rebuild comparison is deterministic. That
    tree was taken after a hand `git add -A`; rev6's `tree` mode, and rev7's, run on both clones, pass their checks
    (167 destinations in the index, no source, nothing unstaged or untracked) and print the same
    `059316c`.

### Procedure

There are two stages. **Preparation** runs without a freeze. Only the **landing window** pauses
other sessions. Abort and success share one close (step 9), and a rollback gets the same lifecycle
as the migration (step 10).

**Stage A: preparation (no freeze)**

1. **Before any preparation edit**, the delegator:
   - runs `receipt.js show` in every worktree `git worktree list` prints, and confirms that no open
     receipt cites a manifest `from` path or a file the applier or `prose` will edit;
   - fences those paths. No new grant touches them. Existing grants that do are listed, and each either
     lands first or is held.

   Only `ADR47-WI-1` (Rust) and `D182-WI-1` (excluded) may be open.
2. On branch `refactor/adr0098-test-folders` in its own worktree (nothing here touches master):
   1. commit the generator, the applier and the applier's fixture test as **commit A1**, and record its
      SHA as the **source SHA** for stage B;
   2. run the generator, then `apply`, then `check` (keep its output: the byte proof), then `prose`, at the
      current master;
   3. make the hand edits, and save them as a patch next to the handoff:
      - `vitest.perf.config.ts` include → `tests/perf/**/*.perf.ts`, and `tsconfig.test.json` drops `"perf"`;
      - AGENTS.md:30 (the "directly under `tests/`" rule), rule 10 § File placement and `tests/README.md`
        name the three folders and the membership table;
      - the comments `prose` could not rewrite, and the `$comment` in `src-tauri/persistence-roots.json`;
      - the ledger's `.md`, then `pnpm ledger:build`;
   4. run every gate in step 7 once.

**Stage B: landing window (freeze)**

The order matters: the final map is fixed before any check that depends on it (R3.5).

3. **Regenerate and approve the final map.**
   - Run the source SHA's generator at master HEAD.
   - Diff the result against the reviewed map. The diff must be empty, or each addition and removal is
     accepted by the delegator.
   - The accepted map, plus the files `prose` and the hand edits will touch, is **the final scope**.
4. **Open the window on the final scope.**
   - Extend the fences to the final scope.
   - The delegator announces the window (at most 2 hours) and every session acknowledges.
   - Queue pulls (ADR-0097) pause, and no session records a receipt on a path in the final scope. The
     migration is the one item exempt from the cap.
5. **Receipt check on the final scope**, in every worktree. It must come back clean before step 6 starts.
6. **Build the one commit** on a fresh branch from master HEAD.
   - `git checkout <source SHA> -- scripts/redesign/adr0098-manifest.py scripts/redesign/adr0098-apply.mjs tests/tooling/adr0098-apply.test.ts`.
     The scripts and their test are staged with the migration (R3.3).
   - Write the final map to `docs/reference/adr-0098-test-move-map.json`.
   - Run `apply`, then `check`, whose output (0 problems) goes into the PR body as the byte proof, then
     `prose`, then `git apply` the stage-A hand-edit patch, fixing any hunk master moved. The patch as
     finally applied is saved as `hand-edits.patch` next to the handoff; step 7 replays it.
   - Run `tree --expect docs/reference/adr-0098-test-move-map.json` with an `--expect` for each of the
     three source-SHA files. It stages the whole result and refuses on anything left out (rev6 P5.1); the
     commit is made from that index and nothing else, so its tree is the one `tree` printed.
   - The result is **one atomic commit**: moves, rewrites, configs, references, manifest, scripts and their
     test. For review, the PR body gives `git diff -M --stat` and the diff with renames collapsed, as separate
     views of the same commit.
7. **Acceptance**. Every heavy command runs under `scripts/heavy-lock.sh`, `pnpm perf:d12` (about 90 s and
   more) included.
   - `vitest list --json=<file>` under each config (`vitest.config.ts`, `vitest.slow.config.ts`,
     `vitest.perf.config.ts`) at the base and at the migration SHA. Each base `file › test` identity is
     mapped through the manifest. **The migration set equals the mapped base set plus exactly the 13
     `tests/tooling/adr0098-apply.test.ts` identities** in the unit tier, and equals the mapped base set in
     the slow and perf tiers (rev5 N4).
   - Totals, compared the same way: in the unit tier, executed and passed are the base's plus 13, and skipped
     and todo are equal; in the slow and perf tiers all four are equal. Each of the 13 additions passes. The
     coverage summary is unchanged within rounding.
   - **Rebuild comparison** (rev5 N1, rev6 P5.1): in a fresh scratch clone at the base, run the source
     SHA's `apply` and `prose` with the final map, copy in the manifest and the three source-SHA files,
     and `git apply hand-edits.patch`. Then run `tree` with the same four `--expect` paths as step 6. It
     must exit 0, and the tree it prints must equal `git rev-parse <migration>^{tree}`. A bare
     `git write-tree` is not used: nothing after the `git mv` is staged until `tree` stages it. Together with the
     kept byte proof, this pins every byte of every moved file to `apply`'s literal rewrites, `prose`'s
     whole-token rewrites, or a reviewed patch hunk.
   - `typecheck:tests`, `build`, `ledger:check`, `check --refs-only` and `residual` all pass.
   - The local `rust` and `rust-verify-run` lanes run, because `src-tauri/persistence-roots.json` changes
     (rule 10).
   - PR CI on the exact SHA, including the Rust jobs that `change-scope` triggers.
   - The verifier and the mini audit (rule 70) are not skipped.
8. **Final check, then land.** Re-run step 5 immediately before `git merge --ff-only`. The delegator then
   fast-forwards and pushes.
9. **Close** (shared by success and abort, R3.7):
   - the delegator announces the window closed and which way it ended;
   - fences lift, held grants are released by name, and queue pulls resume;
   - after a landing, peers fast-forward before their next commit, and a branch that touches a moved file
     rebases (git's rename detection carries the edit);
   - after an abort, master is unchanged and peers continue on it as before;
   - the stage-B branch is left for rule-25 removal.

   **Abort** happens when:
   - the window runs out;
   - a gate fails twice;
   - the map diff is not accepted;
   - step 5 or step 8 finds a receipt in the final scope.

   An abort lands nothing, and stage B is rescheduled from step 3.
10. **Rollback after landing** (R3.6) follows the same lifecycle with the inverse map. The scope is
    **derived from the migration commit itself** (rev5 N2): every path in
    `git diff-tree --no-ext-diff -r -M --name-status <parent> <migration>`, i.e. both sides of each rename,
    every modified file, and every **added** file, which a revert deletes. That includes
    `tests/tooling/adr0098-apply.test.ts`, the two `scripts/redesign/` files and the manifest. A list kept by
    hand is not used.
    - The revert keeps `.claude/tdd-guardian/receipts.json` at master's current bytes: it is excluded from
      the inversion, so every parent record survives (the landing verifier's step 4).
    - Acceptance mirrors step 7, measured against the **rollback parent** (master HEAD when the revert is
      built), not against the migration commit (rev6 P5.2): tests may have landed in between, and they
      stay. Take `vitest list --json` under each config at the rollback parent and at the revert. Map
      each parent identity whose file is a migration destination back through the inverse map; leave
      every other identity as it is, including those added after the migration; remove the 13
      `adr0098-apply` identities. The revert's set must equal the result. Totals are computed against
      the same parent: in the unit tier executed and passed drop by exactly 13 and skipped and todo are
      equal; in the slow and perf tiers all four are equal. If a test that landed after the migration
      sits under a moved destination folder (`tests/control/`, `tests/tooling/`, `tests/perf/`) but
      is not in the inverse map, it has no baseline home: the rollback stops, and that file is either
      moved by hand under review or the defect is fixed forward.
    - Fence that scope, collect acknowledgements, and pause pulls and recording on it.
    - Run the receipt check, which must find no open receipt on it. Such a receipt was recorded after the
      migration, and a revert would delete or rewrite its file.
    - Build the revert commit, accept it under the same gates, re-run the check right before the
      fast-forward, then close as in step 9.
    - If any check finds a receipt, there is no revert, and the defect is fixed forward.

### Phase 2 direction (not decided here)

Group the app's ≈ 500 root tests by subsystem (editor, tables, files and watcher, MCP, export, UI shell, …),
using a semantic map reviewed file by file rather than an import heuristic. Phase 2 also has to settle:
- whether `helpers/` merges into `support/` (with the guard self-path fix);
- the manual notes and the `quick-test.md` link;
- a path alias before the move;
- D182's receipt disposition, a narrowly audited settlement route the landing verifier accepts.

It gets a new ADR and its own Codex review.

## Consequences

- Launcher and tooling tests stop crowding the app's. `perf/` leaves the root.
- **Costs**:
  - One diff of 167 renames (at `a436b0b`), 460 references rewritten by the applier, and hand edits in about
    30 files (references and comments).
  - Two committed one-off scripts (`scripts/redesign/`) and their 13-case fixture test, kept so the map can
    be re-derived from its baseline. The test runs in every unit lane from then on.
  - Step 7 grows a rebuild in a scratch clone, compared through a fifth applier mode (`tree`), and the byte proof covers the tree only up to `prose`; after
    that, correctness rests on the rebuild matching and on review of the hand-edit patch.
  - The local Rust lanes run once for a comment, and the PR's Rust CI jobs run for a change with no
    Rust effect.
  - A rebase for every open branch that touches a moved file.
  - A window of up to 2 hours with no queue pulls. Before it, a fence on mapped paths for as long as
    preparation takes.
  - The build id changes once.
  - 184 receipt citations, ADR-0076 and about 100 doc citations keep old paths for good; the manifest is
    their only bridge.
  - Two classifier rules ("no `../src/` import", "reaches tooling") have to be understood by whoever adds a test.
- **Forecloses** nothing. The root stays flat until phase 2, which can still pick another axis.
- **Risk worth naming**: a mapped file under an open receipt breaks that receipt permanently. That
  is why the receipt check runs before preparation (step 1), on the final scope once the map is
  fixed (step 5), right before the fast-forward (step 8), and through the same lifecycle on the
  inverse map before any revert (step 10).
