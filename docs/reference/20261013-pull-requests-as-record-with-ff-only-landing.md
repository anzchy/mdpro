# Pull requests as the record, fast-forward as the landing: a proposal for mdpro-delegator

**Status:** proposal (2026-10-13), for mdpro-delegator to rule on and put to the user. Nothing is
changed. Drafted by mdpro-codex-audit at the user's request (「起草一份方案，交给 delegator 来定」),
after the user asked whether the common "merge through a PR" practice conflicts with rule 70's
`--ff-only` landing. If adopted, it needs an ADR (number from the delegator) that amends
ADR-0083 / ADR-0085 and rule 70 § Commits and branches.

## 1. The question

Most repos land work by merging a pull request. mdpro lands it with the delegator's local
`git merge --ff-only <sha>` followed by `git push origin master` (rule 70, ADR-0083). Do the two
conflict, and is there anything a PR would add?

**Short answer:** they don't conflict. A PR decides where review and CI happen and what record is
left. `--ff-only` decides how commits reach `master`. The conflict is only with GitHub's **merge
buttons**: none of the three keeps the audited SHA.

| GitHub button | What lands on `master` | Breaks |
|---|---|---|
| Create a merge commit | A new merge commit | Rule 70 (no merge commits); the landed tip is not the audited SHA |
| Squash and merge | One new commit | Atomic commits; SHA-keyed records (audits, receipts, device checks) |
| Rebase and merge | Rewritten commits with new SHAs | The same: the audited SHA never lands |

The local `--ff-only` keeps the SHA, which ADR-0085 depends on: the SHA Codex audited and
`mdpro-landing-verifier` re-ran is the one that lands.

## 2. What the repo looks like today (checked 2026-10-13)

- `anzchy/mdpro` is public. All three merge buttons are enabled. `master` protection blocks force
  pushes and deletion, and requires neither a PR nor linear history.
- The last merged PR is #414 (2026-10-07). Since ADR-0083 (2026-10-12) work lands without PRs.
- `ci.yml` runs on `pull_request` and `v*` tags, **not** on pushes to `master`. Its header says
  this is deliberate: local lanes and the landing verifier gate every landing. Every other workflow
  is `workflow_dispatch` or issue-triggered, so opening a PR starts CI and nothing else.
- Implementor branches are mostly never pushed. ADR-0084 already keeps a remote branch thirty
  days after its work lands, so pushed branches have a retention rule.

## 3. Options

**A. Keep the current flow (no PRs).**
- Gains: no extra steps; no CI minutes; the gate is the local verifier plus the Codex audit.
- Costs: no public record per change. The audit verdict, the verifier's PASS and the delegator's
  ruling live in session messages and handoffs, not in one linkable place. No Linux or Windows
  CI run before landing; the first CI run on a change is the release tag.

**B. A PR per landing, used as the record; landing stays local `--ff-only`.** (Recommended if
anything changes.)
1. Once the handoff passes the ancestry and scope check, the delegator pushes the branch and opens
   a PR (`gh pr create --base master --head <branch>`). The body carries the WI or D id, the SHA,
   and the lanes that passed.
2. CI runs on the PR. The audit verdict and the verifier result are posted as PR comments.
3. Gate: verifier PASS **and** zero Critical / High **and** (new) CI green on that SHA.
4. The delegator lands as today: `git merge --ff-only <sha>`, `git push origin master`. GitHub
   should mark the PR *merged* by itself once its head commit is on `master` (to verify in the
   trial below). Nobody clicks a merge button.
5. Protection: GitHub requires at least one merge method to stay enabled, so the buttons can't
   all be turned off. Disable merge commits and squash, keep only rebase-merge, and turn on
   "require linear history" for `master`. A stray click can then at worst rebase-land, and rule
   70 still says nobody clicks. (A settings change: the user's call.)
- Gains: one public page per change with the diff, CI, audit and ruling; CI before landing; GitHub
  history matches the familiar PR model.
- Costs: every branch is pushed (more remote branches under ADR-0084's thirty days); CI minutes
  per PR, and a `synchronize` run per fix push; one more step and one more wait for the delegator;
  a CI failure can now hold a landing that the local gate passed. Rule 70 and the delegator's
  agent prompts need edits.

**C. A PR only for selected changes** (release-affecting, cross-platform, or Rust changes).
- Gains: CI where it matters most, less overhead elsewhere.
- Costs: a judgement call per change about whether it qualifies, which is the kind of rule that
  drifts. A record that exists only sometimes is harder to rely on.

**D. Adopt GitHub merging (rebase-and-merge or squash).** Not recommended: it breaks ADR-0085's
SHA identity and the SHA-keyed receipts and device records. Listed so it isn't proposed again
without that cost in view.

## 4. A cheap trial before deciding

On one small landed-next item: push the branch, open the PR, let CI run, land with `--ff-only`,
push `master`. Check:
- the PR shows *Merged* with no button clicked;
- the commit SHAs on `master` equal the PR's;
- CI wall time, and whether it caught anything the local lanes didn't.

## 5. Questions for the user (through the delegator)

1. Is a public per-change record worth one push, one PR and one CI run per landing (option B)?
2. Should a red CI run block a landing, or only be reported?
3. May the repo's merge buttons be disabled so the web UI can't land a rewritten SHA?
4. Run the trial in § 4 first?

## 6. Delegator's ruling (2026-10-13)

The user handed the decision to the delegator (「起草一份方案，交给 delegator 来定」).

- **Run the § 4 trial first**, on the next small one-commit landing: D190 WI-3
  (`fix/d190-wi3-csp-asset-localhost`, one CSP token). The delegator pushes the
  branch, opens the PR with `gh pr create`, lets CI run, lands with
  `git merge --ff-only` and pushes `master` as today. Nobody clicks a merge button.
- **During the trial CI is reported, not blocking.** The landing gate stays
  verifier PASS + zero Critical / High. Whether a red CI should block (question 2)
  is decided on evidence after the trial, not before it.
- **No repository settings change** (question 3) until the trial shows the PR
  is marked *Merged* on its own and the SHAs match. Changing merge buttons or
  branch protection is the user's call and is put to them with the trial result.
- **Option D stays rejected** for the reason in § 3: the audited SHA must be the
  landed SHA (ADR-0085).
- The trial's outcome and the A-vs-B decision get an ADR (number reserved by the
  delegator at that time) that amends ADR-0083 / ADR-0085 and rule 70 if B is
  adopted; if A is kept, the ADR records why, so the question is not reopened
  from scratch.
