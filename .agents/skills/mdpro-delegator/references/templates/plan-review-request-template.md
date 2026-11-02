# Request: <ADR-<NNNN> | decision <YYYYMMDD-slug>> plan review, round <k> (difficulty: <D>)

<!-- read-every-session:begin -->
- [docs/agents/auditor.md](../../../../../docs/agents/auditor.md)
<!-- read-every-session:end -->

Use this only for an ADR that meets CLAUDE.md § ADR's review trigger, or for a gate-sensitive decision-log entry
(`docs/agents/decisions/README.md` § Gate-sensitive entries), as guide §6 says (ADR-0165; [decision log](../../../../../docs/agents/decisions/20261102-adr-scope-and-decision-log.md#2026-11-02-adr-scope-and-the-decision-log)). Doubt means review.

- **Protocol pin:** `<M>` is the master SHA and `<B>` is the blob id of `docs/agents/audit-dimensions.md` at `<M>`.
  Verify `git rev-parse <M>:docs/agents/audit-dimensions.md` equals <B>, then read `git cat-file -p <B>` and echo
  `<B>` in the report. One pin covers round one, its challenges, the confirm and the confirm's challenges.
- **Policy pin, only when § Which set routes the review to the policy set (a decision-log entry, never an ADR):** `<P>` is the blob id of
  `docs/agents/audit-policy-set.md` at `<M>`. When the request names `<P>`, verify
  `git rev-parse <M>:docs/agents/audit-policy-set.md` equals <P>, read `git cat-file -p <P>` and echo `<P>` beside
  `<B>`; one pin covers the review for `<P>` as for `<B>`. Otherwise the request names no `<P>` and no policy file is read.
- **Document:** `docs/adr/<NNNN>-<slug>.md` (Proposed) or `docs/agents/decisions/<YYYYMMDD>-<slug>.md` with its rule
  edit, in `/Users/jack/Documents/mac-app/mdpro` (uncommitted). Read it from that path.
- **Mode:** plan review using the plan set from the pinned file at `<B>` for an ADR, and the plan set + policy set
  at Full depth (§ Which set; [policy set](../../../../../docs/agents/decisions/20261102-cc-suite-policy-set.md#2026-11-02-the-cc-suite-policy-set)) for a decision-log entry, which
  reads the policy set at `<P>`. An ADR review names no `<P>`.
- **Read also:** <the ADRs and rules it supersedes or touches; the evidence it cites>.
- **Check in particular:** <the questions that matter>; every clause of an Accepted ADR or rule it contradicts
  without naming it (ADR-0121 decision 6 if it changes an auditor's model, definition or request template).
- **Read barrier:** round one blind; a confirm reads both completed earlier rounds and the merged verdict, never the
  other auditor's current-round report.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/<ADR-<NNNN> | decision-<YYYYMMDD-slug>>-r<k>.md`, ending
  `COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>`.
