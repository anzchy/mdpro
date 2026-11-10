## Parent

#700 (MIG-003 row). Spec: #752 (r1), snapshot `docs/specs/mig-003-ci-protection/r1/`. Decisions MIG003-r1-D1–D4, D9, D14, D16, D19, D20.

## What to build

`scope` tells the delegator which **risk classes** a PR touches, and the Required Gate is seen red for three fault classes.

- The change-scope script keeps `code` and `classifyPaths` byte-identical. It adds an exported classifier from paths to the six risk classes (`deps`, `editor`, `pipeline`, `ci`, `ipc`, `platform`) and writes six more `<class>=true|false` lines. It still always exits 0.
- **Semantics**: a path may set several classes; a prose path sets none; a code path matching no class sets none while `code` stays true; an empty BASE or a git failure sets all six true.
- **Table**: exactly the spec's § Risk classes table, one case per row.
- **`ci.yml`**: `scope` exposes the six outputs and appends one summary line, `Risk classes: deps=<b> editor=<b> pipeline=<b> ci=<b> ipc=<b> platform=<b>`, with ` (all true: no PR base)` or ` (all true: git failed)` when forced. Nothing else reads them; `ci-gate` is unchanged.
- **Fault fixtures** (mutation-RED, over the real gate jq, `shard-reports`, `compare-report` and `change-scope`): missed shard (missing blob; missing or empty report); classifier failure (a crashed `scope` job turns the gate red, with the classifier's `code=true` fail-safe as the green control); pending test (i) a required identity reported `pending` or `todo`, (ii) an identity collected but never started.
- **Live runs**: one `ci-fault/<class>` branch per class (missed shard, classifier failure, pending), one commit with a subject starting `DO NOT MERGE`, committed locally. The handoff names each SHA and the job or finding expected red; the delegator pushes, opens draft PRs, records run ids and closes them unmerged.

## Acceptance criteria

- [ ] Each table row has a CLI or classifier case that sets exactly its classes; overlap (a `pipeline` path also sets `editor`), prose (none), unmatched code (none, `code=true`), empty BASE and git failure (all true) each have a case.
- [ ] The `code=` line and `classifyPaths` results are unchanged for every existing `ci-change-scope` case; the CLI still exits 0 on every input.
- [ ] The summary line is written once per run, in the stated form, including both forced suffixes.
- [ ] `ci-workflow-gate`'s "preserves the ci-gate decision bytes from GH607's pinned base" passes unchanged; a new case shows `scope` exposes the six outputs and that no job other than `scope` names a risk-class output.
- [ ] Each fault class has a fixture that fails against the mutation and passes against the unmutated input, with a RED receipt naming the mutation.
- [ ] Pending (i) and (ii) each have a named mutation; if neither mutation of a kind can turn `ci-gate` red, the ticket stops for the delegator and the gap becomes its own issue (MIG003-r1-D19).
- [ ] The handoff lists three fault SHAs and the job or finding each turns red; the confirm record holds their run ids and closed draft PR numbers.
- [ ] Remote `ci-fault/*` branches are kept (ADR-0084); no local branch is deleted without the user (rule 25).
- [ ] No `ci-inventory.json` change and no feature-ledger row.
- [ ] Size: about 120 counted production lines (`audit-dimensions.md` § Split recommendation).

## Citations (master `ddc60447`)

| Cited | Path and name | Exists | Quoted |
|---|---|---|---|
| fail-safe | `tests/tooling/ci-change-scope.test.ts` › "answers code for an empty list (fail-safe)" | yes | test title |
| bad base | `tests/tooling/ci-change-scope.test.ts` › "writes code=true and exits 0 when the base cannot be resolved" | yes | test title |
| scope output | `tests/tooling/ci-workflow-gate.test.ts` › "scope exposes the change-scope output" | yes | `…"code")?.inline).toBe("${{ steps.scope.outputs.code }}")` |
| gate pin | `tests/tooling/ci-workflow-gate.test.ts` › "preserves the ci-gate decision bytes from GH607's pinned base" | yes | `toEqual(["scope", "prose-checks", "frontend", "frontend-merge", "rust-test"])` |
| missing blob | `tests/tooling/gh639-shard-reports.test.ts` › "refuses when a shard's artifact is missing, and writes nothing" | yes | test title |
| started identities | `scripts/ci/shard-reports.mjs:175` | yes | `merged started identities differ from shard reports` |
| pending | `tests/tooling/adr128-ci-comparator.test.ts` › "rejects an unexplained static or runtime skip in a partially passing file" | yes | `for (const status of ["skipped", "pending"]) …not.toBe(0)` |
| todo | `scripts/ci/compare-report.mjs:96` | yes | `item.status !== "todo"` |
| ADR-0084 | `docs/adr/0084-remote-branches-are-kept-thirty-days-after-their-work-lands.md` | yes | "A branch on `origin` is kept thirty days after its work lands" |
