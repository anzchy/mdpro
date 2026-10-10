# 0073. The release workflow auto-publishes only after verifying the uploaded draft

**Status**: Accepted (2026-10-10). User's words: 「保留自动发布」. Implements
[D76](../plans/20260912-frontend-backend-sequencing-order.md#d76); the 0.3.1 gate is
[#release-031-gate](../plans/20260912-frontend-backend-sequencing-order.md#release-031-gate).

## Context

- **v0.3.0 shipped empty.** Run `24201526323` (tag push, 2026-04-09) failed in
  `create-release` after 4 s with no runner and zero steps. The logs are gone (HTTP 410), but
  `gh api repos/anzchy/mdpro/check-runs/70646137447/annotations` still returns "The job was not
  started because recent account payments have failed or your spending limit needs to be
  increased". Every CI run that day carries the same annotation. The cause was an Actions
  billing lock, not the YAML. Fourteen seconds later a release authored by `anzchy`, not
  `github-actions[bot]`, was published by hand (16:31:32Z) with zero assets. Since then
  `releases/latest`, the updater endpoint, has returned 404 to every 0.2.x client.
- **The old `release.yml` was unsafe to rehearse.** It ran on any `v*` tag push and created the
  draft *before* building. Failed builds left 5 stale drafts behind. It rewrote the three
  version files from the tag, uploaded through `tauri-action` with no check, and turned a
  missing signature into `""` with `|| true`. It then ran `--draft=false` unconditionally,
  and its "keep latest 2" cleanup deleted releases **and their tags** (`--cleanup-tag`).
- The repo is now public (user: 「github 目前已经是public，所以无需担心action 额度的事情」).
  That removes the spending-limit cause, but a failed payment locks Actions on public repos
  too. That the lock is gone is an **expectation, unverified** until WI-8 R1 starts a job.

## Decision

One manually dispatched run (`ref`, `version`, `mode` ∈ build-only | draft | rehearsal-draft),
fail-closed at every step:
preflight (`check-source.mjs`) → build per target (`pnpm tauri build --target --bundles`, then
`collect-assets.mjs`; no upload, D-5) → verify (`verify-assets.mjs`: closed asset set, minisign
signatures, `latest.json` with final-tag URLs, `manifest.json`) → draft (not build-only:
re-list every release for the tag, `gate.mjs decide`, `gh release create --draft --target
<sha>`, `gate.mjs post-upload`) → publish (mode `draft` only: `verify-release.mjs` on the
uploaded draft → `gate.mjs may-publish` → the file's single `gh release edit --draft=false`).

1. **Concurrency:** the constant group `release`, never cancelled in progress. This is
   stricter than a group per version: it also serialises the race on `latest`/`latest.json`.
2. **Target pinning:** `verify-release` requires `target_commitish` = the built SHA and no
   published release for the tag. Draft creation refuses when any release, draft or
   published, already exists for the tag.
3. **Three-file consistency:** `check-source` requires `package.json`, `tauri.conf.json` and
   `Cargo.toml` to equal `version`. The workflow never rewrites them.
4. **Process precondition:** no `mode=draft` dispatch until the 0.3.1 device regression has
   passed on the locked SHA.
5. D-3: Windows and Linux build as optional installers. They are not in `latest.json`.
   D-4: no cleanup step at all. D-7: `rehearsal-draft` drafts `rehearsal-d76-<sha7>`, which
   `may-publish` and `verify-release` always refuse. Top-level permissions are
   `contents: read`; only `draft` and `publish` get `contents: write`.

## Consequences

- **Cost: an unattended outward step.** Nothing stands between a green verify and a public
  release except the gate scripts and the `needs`/`if` wiring.
- **Cost: no actionlint.** A mistake in an `if:` or a `needs.*.outputs` expression surfaces
  only at dispatch. The static test covers the shape but not GitHub's expression parser, so
  WI-8 R1b is there to catch it.
- **Cost: integrity, not behaviour.** A bad build that is consistent with itself still
  publishes. The only mitigation is process: precondition 4.
- **Cost: leftovers stay.** A failed upload or post-upload check leaves a draft behind. It is
  deleted only by hand, with confirmation (rule 25).
- **Cost: fail-closed matrix.** A broken optional Windows or Linux build blocks the macOS
  release too.
- **Cost: queue limits.** GitHub keeps one *pending* run per group, so a third dispatch
  replaces the queued second one.
- **Cost: renaming is ours.** The asset renaming `tauri-action` used to do now lives in
  `assetNames.mjs` and `collect-assets.mjs`. A Tauri bundle-layout change breaks it, and R1
  is the first real check.
- **Cost: not live yet.** GitHub dispatches the workflow file from the chosen ref. The
  default branch keeps the old, unsafe file until this lands on `master`.
- **Gained:** nothing is created before the set verifies. Tested bytes are published bytes.
  Nothing deletes a release or a tag.
