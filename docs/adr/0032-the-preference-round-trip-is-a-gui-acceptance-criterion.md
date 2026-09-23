# 0032. The preference round-trip is a gui-acceptance criterion, not a new automated lane

## Status

**Accepted** (2026-09-23). Settles the **"Not settled here — the verification
lane"** clause of
[ADR-0031](./0031-preference-persistence-is-restored-in-dependency-order.md),
which deferred this question rather than answer it. ADR-0031 is otherwise
unchanged.

## Context

ADR-0031 step 5 corrects `preferencesService.isTauriEnv()` so that preference
writes reach Rust. The step needs a verification that the automated lanes
cannot give it.

**No jsdom test can prove the shipping WebView exposes the marker the detector
checks.** Seven existing tests stub `__TAURI__` to simulate the desktop
environment, which means they assert the browser branch is *correct*. That is
precisely how D24 survived: the suite was green throughout, because the suite
was built on the same false premise as the code. A test written in the same
runtime as the defect cannot see the defect. Adding more of them changes
nothing.

Two candidate answers were weighed.

**A thin automated Tauri smoke lane**, recommended by Codex during the ADR-0031
deliberation. It would boot the real application and assert that a preference
survives a round trip. Its advantage is permanent: once written, a regression
that reintroduces the gate fails a lane instead of going unnoticed.

Against it:

- It would be **this repo's first integration or e2e lane**. The project has a
  vitest lane and a Rust lane and nothing between them — the `gui-acceptance`
  skill states plainly that there is nothing between the unit lane and a human
  looking at the screen. This is new infrastructure, not an increment.
- The lane cannot use a dev build. macOS grants and Tauri's runtime identity
  are keyed to a bundle identifier, and the dev target is a bare executable with
  no `Info.plist`. A lane asserting real runtime behaviour has to **build and
  drive a packaged `.app`**, which takes minutes per run.
- **The project has refused a harness before** on comparable reasoning (E39,
  no benchmarking harness).

**A gui-acceptance criterion**, using the lane that already exists. It is
documented, and it is the lane that produced the D16, D17 and D19 verdicts. The
check is cheap because D24's symptom does not require a restart: `SettingsDialog`
is gated on `if (!open) return null`, so closing and reopening the dialog is
already enough to expose the defect.

## Decision

1. **The preference round-trip obligation is discharged by a gui-acceptance
   criterion. No automated lane is added.**
2. **The criterion is stated concretely**, in two halves, both required:
   - change a preference, **close the Settings dialog and reopen it** — the
     changed value is still there;
   - then **quit and relaunch** — it is still there.
   The first half is the cheap one and it catches D24 directly. The second is
   what proves the write reached disk rather than a surviving component.
3. **It runs against a packaged `.app`**, per the `gui-acceptance` skill,
   including that skill's freshness checks — a stale bundle and, worse, a stale
   *running process* have both produced false verdicts in this repo before.
4. **The verdict is recorded in the work item's row**, and `NOT VERIFIED` stays
   `NOT VERIFIED` rather than being upgraded on the strength of a green unit
   lane.

## Consequences

- **Gives:** the obligation is discharged without standing up an integration
  lane the project has twice decided it does not want. The check is consistent
  with how every other user-visible quit/editor behaviour in this effort was
  verified, and it takes about a minute.
- **Costs:**
  - **It is manual, so it does not protect the future.** A later change that
    reintroduces the environment gate — or any equivalent always-false
    detector — will pass both automated lanes and ship. This is the whole
    advantage of the rejected option, and giving it up is the real price of
    this decision, not a footnote to it.
  - **It depends on someone remembering to run it.** The criterion lives in a
    row in a plan document; nothing executes it.
  - The seven `__TAURI__`-stubbing tests are rebuilt behaviourally under
    ADR-0031 step 5, but **no unit test replaces what this lane covers**. It
    would be a mistake to read that rebuild as closing this gap.
- **Forecloses:** nothing permanently. If the detector regresses even once,
  that is direct evidence for the automated lane, and this record should be
  **superseded** rather than argued around.
- **The rejected option had a real advocate.** Codex recommended the automated
  lane, and its reasoning — that only an automated check survives the people who
  wrote it — is sound. The user chose the gui-acceptance route with that
  recommendation in view. Recording the disagreement matters: if this decision
  turns out wrong, the failure mode was named here in advance.
