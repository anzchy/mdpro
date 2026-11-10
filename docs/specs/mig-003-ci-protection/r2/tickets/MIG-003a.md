## Parent

#700 (MIG-003 row). Spec: #752 (r2), snapshot `docs/specs/mig-003-ci-protection/r2/`. Decisions MIG003-r1-D1–D4, D9, D14, D16, D19, D20; r2 fixes MH2, MM2, MM6, MM8.

## What to build

`scope` tells the delegator which **risk classes** a PR touches, and the Required Gate is seen red for three fault classes.

- The change-scope script keeps `code` and `classifyPaths` byte-identical. It adds an exported classifier from paths to the six risk classes (`deps`, `editor`, `pipeline`, `ci`, `ipc`, `platform`) and writes six more `<class>=true|false` lines after the `code=` line. It still always exits 0.
- **Semantics**: a path may set several classes; a prose path sets none; a code path matching no class sets none while `code` stays true; an empty BASE, a git failure or an empty diff sets all six true.
- **Table**: exactly the spec's § Risk classes table (globs, `[Mm]` a character class), one case per row.
- **Summary**: the CLI appends `Risk classes: deps=<b> editor=<b> pipeline=<b> ci=<b> ipc=<b> platform=<b>` to `$GITHUB_STEP_SUMMARY` when it is set, with ` (all true: no PR base)`, ` (all true: git failed)` or ` (all true: empty diff)` when forced.
- **`ci.yml`**: `scope`'s `outputs:` gains exactly six lines `<class>: ${{ steps.scope.outputs.<class> }}`; no step changes; nothing else reads them; `ci-gate` is unchanged.
- **Pin edits** (spec § Pins; no other): `gh639-frontend-shard-shape` › "keeps every other job byte-identical to the base" compares `scope` after removing exactly those six lines; `ci-change-scope` › the three CLI cases expect the exact seven-line output.
- **Fault fixtures** (mutation-RED, over the real gate jq, `shard-reports`, `compare-report` and `change-scope`): missed shard (missing blob; missing or empty report); classifier failure (a crashed `scope` job turns the gate red, with the classifier's `code=true` fail-safe as the green control); pending test (i) a required identity reported `pending` or `todo`, (ii) an identity collected but never started.
- **Live runs**: one `ci-fault/<class>` branch per class (missed shard, classifier failure, pending), one commit with a subject starting `DO NOT MERGE`, committed locally. The handoff names each SHA, the job expected red and the decisive line (spec § Fault injection table); the delegator pushes, opens draft PRs, records run ids and decisive lines, and closes them unmerged.

## Acceptance criteria

- [ ] Each table row has a classifier or CLI case that sets exactly its classes, including `src/utils/milkdownFocusCarry.ts` and `src/utils/focusActiveMilkdownAtEnd.ts` → `editor`, and a `src/services/editor/` path → `editor` and `ipc`; overlap (a `pipeline` path also sets `editor`), prose (none), unmatched code (none, `code=true`), empty BASE, git failure and an empty diff (all true) each have a case.
- [ ] The `code=` line is the first output line and byte-identical to today's for every existing `ci-change-scope` case; the CLI exits 0 on every input.
- [ ] The summary line is written once per run by the CLI, in the stated form, with each of the three forced suffixes; nothing is written to the summary when `$GITHUB_STEP_SUMMARY` is unset.
- [ ] A case shows `scope` exposes exactly the six new outputs and that no job other than `scope` names a risk-class output.
- [ ] The two pin edits are exactly as spec § Pins states. Mutation-RED cases show the edited GH639 case still fails on a one-line change to `scope` outside the six lines, on a seventh output, and on a one-line change to `prose-checks`, `rust-test` and `rust-audit`; and the edited CLI cases fail on a changed `code=` line or class value.
- [ ] `ci-workflow-gate` › "preserves the ci-gate decision bytes from GH607's pinned base" and `gh639-frontend-shard-shape` › "keeps each shard's setup steps as they were, unconditioned, once each, and none of them in the merge job" pass unedited; the handoff's `tests/tooling/` diff touches no other existing case. Any other existing test this change turns red stops the ticket for the delegator.
- [ ] Each fault class has a fixture that fails against the mutation and passes against the unmutated input, with a RED receipt naming the mutation.
- [ ] Pending (i) and (ii) each have a named mutation; if neither mutation of a kind can turn `ci-gate` red, the ticket stops for the delegator and the gap becomes its own issue (MIG003-r1-D19).
- [ ] The handoff lists three fault SHAs, the job each turns red and its expected decisive line; the confirm record holds each run id, closed draft PR number and the quoted decisive line from the run's log. A red without that line is not evidence.
- [ ] Remote `ci-fault/*` branches are kept (ADR-0084); no local branch is deleted without the user (rule 25).
- [ ] No `ci-inventory.json` change and no feature-ledger row.
- [ ] Size: about 120 counted production lines (`audit-dimensions.md` § Split recommendation).

## Citations (master `93c7e9bb`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| fail-safe | `tests/tooling/ci-change-scope.test.ts` › "answers code for an empty list (fail-safe)" | yes | test title |
| CLI output | `tests/tooling/ci-change-scope.test.ts` › "writes code=false for a prose-only range" | yes | `toEqual({ status: 0, output: "code=false\n" })` |
| scope output | `tests/tooling/ci-workflow-gate.test.ts` › "scope exposes the change-scope output" | yes | `…"code")?.inline).toBe("${{ steps.scope.outputs.code }}")` |
| gate pin | `tests/tooling/ci-workflow-gate.test.ts` › "preserves the ci-gate decision bytes from GH607's pinned base" | yes | `toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"])` |
| scope byte pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "keeps every other job byte-identical to the base" | yes | `for (const id of ["scope", "prose-checks", "rust-test", "rust-audit"]) expect(job(TEXT, id), id).toBe(job(base, id))` |
| frontend pin | `tests/tooling/gh639-frontend-shard-shape.test.ts` › "keeps each shard's setup steps as they were, unconditioned, once each, and none of them in the merge job" | yes | `expect(now.slice(0, profileIndex + 1)).toEqual(base.slice(0, profileIndex + 1))` |
| missing blob | `tests/tooling/gh639-shard-reports.test.ts` › "refuses when a shard's artifact is missing, and writes nothing" | yes | test title; `shard-reports.mjs:49` `blob artifact missing` |
| missing report | `scripts/ci/shard-reports.mjs:83` | yes | `.ci-vitest-results.json missing or empty` |
| started identities | `scripts/ci/shard-reports.mjs:175` | yes | `merged started identities differ from shard reports` |
| pending | `tests/tooling/adr128-ci-comparator.test.ts` › "rejects an unexplained static or runtime skip in a partially passing file" | yes | `for (const status of ["skipped", "pending"]) …not.toBe(0)` |
| pending line | `scripts/ci/compare-report.mjs:81`, `:77` | yes | `Incomplete or failed test:`; `Inventory test incomplete:` |
| todo | `scripts/ci/compare-report.mjs:96` | yes | `item.status !== "todo"` |
| gate line | `.github/workflows/ci.yml`, `ci-gate` decision step | yes | `ci-gate: a job ended in failure, was cancelled, or skipped without scope's code=false` |
| summary precedent | `scripts/ci/failure-summary.mjs:151` | yes | `if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(…)` |
| ADR-0084 | `docs/adr/0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md` | yes | "A branch on `origin` is kept thirty days after its work lands" |
