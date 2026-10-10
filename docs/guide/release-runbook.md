# Release runbook

How to cut a release with `.github/workflows/release.yml`. Why it works this way is recorded in
[ADR-0073](../adr/0073-release-workflow-auto-publishes-only-after-verifying-the-uploaded-draft.md).
Version bumping is covered in [rule 40](../../.claude/rules/40-version-bump.md) and `/bump`.

**Pushing a tag builds nothing.** The workflow runs only on `workflow_dispatch`. GitHub runs
the copy of the file on the ref you dispatch from, so this version applies only once it is on
`master`.

## Before dispatching

1. Bump the three files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`)
   and land the commit on `master`.
2. Lock the release SHA. **Precondition for `mode=draft`:** the 0.3.1 device regression has
   passed on that exact SHA (sequencing doc, `#release-031-gate`).
3. Tag caveat: `/bump` pushes `v<version>` at the bump commit. Preflight accepts an existing
   tag only when it points at `ref`. If the locked SHA is a later commit, `mode=draft` refuses
   with "tag vX.Y.Z already exists at …". In that case either release the tagged commit, or
   bump again. Never move the tag.
4. Never run `gh release create` by hand. That is how v0.3.0 shipped empty.

## Dispatch inputs

| Input | Value | Checked by |
|---|---|---|
| `ref` | A 40-hex SHA, or exactly `vX.Y.Z` | preflight: checkout HEAD = ref's commit |
| `version` | `X.Y.Z`, no `v` | preflight: equals all three files at `ref`; in `draft` mode it must be a later patch than the latest published release |
| `mode` | `build-only` (default), `draft` or `rehearsal-draft` | see below |

```bash
gh workflow run release.yml --ref master -f ref=<sha> -f version=0.3.1 -f mode=build-only
gh run watch                                   # or: gh run view <id> --log-failed
```

- **`build-only`:** runs preflight, build and verify. It uploads the artifacts `build-<platform>`
  and `release-set` (3-day retention) and creates nothing on GitHub Releases.
  Run this first.
- **`rehearsal-draft`:** adds a draft named `rehearsal-d76-<sha7>` with the full verified
  set. `may-publish` and `verify-release` always refuse that tag, so it can never go public.
  Use it to check the upload path. Then delete the draft, with confirmation (rule 25).
- **`draft`:** the real release. Creates draft `v<version>` targeting the SHA, then checks the
  uploaded assets against `manifest.json` (`gate.mjs post-upload`), then runs `verify-release`
  and `gate.mjs may-publish`. Only then does it run `gh release edit v<version> --draft=false`,
  the only publishing command in the file.

## What the checks trust

- **The scripts run from the SHA being released.** Every job checks out the preflight SHA, so
  `check-source`, `collect-assets`, `verify-assets`, `gate` and `verify-release` are the
  versions at that commit. A fix to a release script has to land before the SHA is locked;
  a bug in the scripts at that SHA is a bug in the check itself.
- **Windows and Linux are optional per file, not per platform.** `assetSet.mjs` skips any
  optional file whose installer and `.sig` are both absent, so a set holding the Linux `.deb`
  but no `.rpm` passes `verify-assets` and `verify-release`. In a normal run the build job
  prevents this: `collect-assets.mjs` needs exactly one source for every expected file of its
  row, and every matrix row is required. The verify-side gap only matters if the set loses a
  file between build and verify. The intent (D-3) is optional *platforms*; tightening the
  verifier to all-or-none per optional platform has been proposed alongside D127.

## Rehearsals

- **R1 (`build-only`)** is first. It also confirms the Actions billing lock is gone (a job
  that actually starts).
- **R2 (`rehearsal-draft`)** creates `rehearsal-d76-<sha7>`. **The session that dispatched it
  deletes it** once the run has been read: `gh release delete rehearsal-d76-<sha7> --yes`,
  without `--cleanup-tag` (a draft has no git tag). It is deleted only after the user confirms
  that command (rule 25). For the D76 rehearsal that is mdpro-85.
- **Negative rehearsal** (WI-8): put one broken `.sig` into a rehearsal draft and confirm
  that verification refuses it. Today `verify-release.mjs` refuses every rehearsal tag
  before it reads a single asset, so this needs a rehearsal-only checking mode first. That
  mode checks the target, the bytes and the signatures, and `may-publish` still refuses the
  tag. Until that lands, the negative path is covered only by the unit tests.

## After the release

- Generalise CLAUDE.md "Release Workflow": "Precondition: the 0.3.1 device regression…"
  becomes "this release's device regression…". Step 2 above changes the same way.

## Reading a run

Jobs run in order: `preflight → build (4 rows) → verify → draft → publish`. Each failing script
prints `::error::` lines, and these show as annotations on the run summary. A job that never
started (no runner, 0 steps) is an account problem, not a YAML one. Check
`gh api repos/anzchy/mdpro/check-runs/<job-id>/annotations`; v0.3.0 died of a billing lock.

## What each failure leaves behind

| Failed in | Left behind | Action |
|---|---|---|
| preflight | Nothing | Fix the inputs, the versions or the tag, then re-dispatch |
| build (any row, Windows/Linux included) | Artifacts from finished rows (expire in 3 days); no release | Fix and re-dispatch. Every row is required (fail-closed) |
| verify | `build-*` artifacts; no release | Read the asset or signature errors |
| draft: decide | Nothing. A release for the tag already exists (draft or published) | Inspect it. Delete a stale draft only with confirmation |
| draft: create or post-upload | A **draft** release, possibly partial. GitHub creates the git tag only when a draft is published | Delete the draft with confirmation, then re-dispatch |
| publish: verify-release or may-publish | A complete **draft**, not published | Read why. Re-dispatching refuses while the draft exists |
| publish: `gh release edit` | A complete draft | Re-run that job. The checks are read-only |

Nothing in the workflow deletes a release or a tag. Leftovers are cleaned up by hand, and each
deletion is confirmed first (rule 25). Keep v0.2.6: it is the last release a 0.2.x updater
can install from until 0.3.1 ships.

## Concurrency

All release runs share the group `release`, and a running release is never cancelled. GitHub
keeps only one *pending* run per group, so dispatching a third run while one runs and one waits
replaces the waiting one.
