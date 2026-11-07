# 2026-11-08: Short checks may run on pull requests, advisory first

- **Decided:** 2026-11-08, by the user, answering the delegator's two questions on DEC-002 (#679, map #678):
  - on how to read ADR-0095 decision 7: 「Heavy checks only (Recommended)」;
  - on when a new short check joins `ci-gate`: 「After an advisory trial (Recommended)」.

  The inputs are the planner's resolutions of MIG-007a (#684) and MIG-003 (#685). The plan is
  `docs/plans/20261107-mdpro_tiptap_windows_plan_v1-3.md` (MIG-007, §12 M7-B, review finding MH1).
- **Decision:** ADR-0095 decision 7 is folded into
  [`landing-and-audit.md` § PR CI](../../../.agents/skills/mdpro-delegator/references/landing-and-audit.md#pr-ci)
  and changed, as follows.
  - Heavy checks stay off the pull-request run: macOS and Windows native lanes, the slow lane, installers, and the
    real-WebKit lane.
  - A short check (p90 at most 2 minutes, no special runner or device, fails closed) may be a new pull-request job.
  - It first runs as an advisory job outside `ci-gate`, through a trial of at least 10 PRs and 14 days. At each landing
    in the trial, the delegator reads its result and records it. A red caused by the PR goes to the user before landing.
  - After a clean trial, one PR adds it to `ci-gate`'s `needs` under `rust-test`'s rule: success, or skipped when
    `scope` says `code=false`.
  - No other gate result changes. ADR-0095 decision 1's PR jobs and the coverage gate stand.
- **Why:** decision 7 kept slow checks from lengthening every landing. Its last sentence, "No check moves into the PR
  run", also blocks checks that take seconds. MIG-007a's IPC inventory cannot be a Vitest test under `tests/`, because
  that test is mandatory the day it lands (#684). A separate job is also blocked by the sentence. So the check has to
  be a separate job, and this entry lets one run on PRs. Running it advisory first means a false red does not block
  every PR before it is proved.
- **Costs:**
  - **Another required check.** A promoted check can block every landing until it is fixed or reverted.
  - **The trial delays enforcement.** During it, a real IPC mismatch blocks nothing by itself. The delegator must read
    each result at landing and put a PR-caused red to the user.
  - **The values are fixed by judgement.** The 2-minute ceiling and the 10-PR / 14-day minima are set here, before any
    trial data. A spec may tighten them; loosening takes a new gate-sensitive entry.
  - **The non-PR lane stays out.** MIG-003's rule that a handoff cites a native or WebKit success at its SHA is a
    landing condition. It is not decided here, and needs its own gate-sensitive entry.
- **changes:**
  - `.agents/skills/mdpro-delegator/references/landing-and-audit.md` gets a new § PR CI.
  - ADR-0095's Status line gets "Current text of decision 7, in place of the `#landing` pointer below:
    `.agents/skills/mdpro-delegator/references/landing-and-audit.md#pr-ci`; folded and changed by
    `docs/agents/decisions/20261108-short-checks-may-run-on-prs.md`", per the [fold-in entry](20261102-changing-an-unfolded-process-adr-clause.md).
- **supersedes:** ADR-0095 decision 7's sentence "No check moves into the PR run", for short checks only.
  - ADR-0128 already superseded the same sentence for the coverage gate, and that stands.
  - Decision 7's first two sentences (macOS on `v*` tags, the slow lane run locally, installers by manual dispatch)
    stand unchanged.
  - ADR-0107's `rust-audit` shape is kept and becomes the advisory template.
- **gate-sensitive:** yes. It changes a CI condition, which jobs may join `ci-gate` and how, and adds a landing step
  during the trial. Classified by herdr-delegator, 2026-11-08. Both auditors plan-review this entry and its rule edit
  before they land.
