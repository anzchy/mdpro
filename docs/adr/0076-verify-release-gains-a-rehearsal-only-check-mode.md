# 0076. verify-release gains a rehearsal-only check mode; may-publish remains the sole publish refusal for rehearsal tags

**Status**: Accepted (2026-10-11). Supersedes **only** the `verify-release` clause of
[ADR-0073](./0073-release-workflow-auto-publishes-only-after-verifying-the-uploaded-draft.md)
D-7 ("`rehearsal-draft` drafts `rehearsal-d76-<sha7>`, which `may-publish` and
`verify-release` always refuse"). The rest of ADR-0073 stands. The delegator's ruling on
[D127](../plans/20260912-frontend-backend-sequencing-order.md#d127) asked for this mode.

## Context

- ADR-0073 plans a **negative rehearsal** for D76 WI-8: put a broken signature into a
  rehearsal draft and watch the check that guards publishing reject it.
- `verify-release.mjs` refused every `rehearsal-d76-<sha7>` tag before it read any asset. On
  a rehearsal draft, the target, byte and signature checks could never run. The only way to
  show they reject a real uploaded draft was to break a `v*` draft, which is the release
  itself.
- The refusal had two jobs: stop a rehearsal from being published, and stop `verify-release`
  from vouching for one. Only the first protects users. `gate.mjs may-publish` also does it,
  and the publish job runs `may-publish` after `verify-release`.
- Doing it by hand with a second script would duplicate the checks it is meant to prove.

## Decision

- `verify-release.mjs --rehearsal --tag rehearsal-d76-<sha7> --sha <sha> --version X.Y.Z`
  runs the same target, byte and signature checks on a rehearsal draft. It runs
  verify-assets in `rehearsal-draft` mode.
  - The tag must be the rehearsal tag for `--sha`.
  - It refuses a `v*` tag, another SHA's rehearsal tag, and a missing or malformed
    `--version` before any `gh` call.
  - On success it prints that the draft is **never publishable**.
- **Without `--rehearsal`, nothing changes.** A rehearsal tag is refused before any asset is
  read, and a test pins this with zero `gh` calls. Default mode now also refuses `--version`.
- **`may-publish` is the one publish refusal for rehearsal tags.** It refuses them in every
  mode. The workflow never passes `--rehearsal` (`release.yml` is unchanged).

## Consequences

- **Cost: one more exit-0 path.** A rehearsal draft that passes `verify-release --rehearsal`
  exits 0. An operator reading only the exit code can take it for "publishable". The
  "never publishable" line is printed for that reason, and the runbook says the same. Nothing
  in a script stops a person who ignores both.
- **Cost: one guard instead of two.** Publishing a rehearsal tag used to be refused twice
  in the publish job, by `verify-release` in default mode and by `may-publish`. Default mode
  still refuses, but the guarantee now rests on two things: the workflow never passing
  `--rehearsal`, and `may-publish`. A future edit that adds the flag to `release.yml` would
  leave `may-publish` as the last guard. `tests/release-workflow-shape.test.ts` is where that
  edit would have to be caught.
- **Cost: the negative rehearsal is a manual, multi-step operation.** Swapping one `.sig`
  changes its size and digest, so the byte check against `manifest.json` refuses the draft
  first. To reach the signature check, the operator also uploads a recomputed
  `manifest.json`. The runbook gives the steps. Every outward command in it still needs the
  user's approval.
- **Gained:** WI-8 can show, on an uploaded rehearsal draft, that the same code which guards
  publishing rejects a bad signature, without touching a `v*` tag.
