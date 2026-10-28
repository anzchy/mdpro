# Request: ADR-<NNNN> plan review, round <k> (difficulty: <D>)

- **Protocol pin:** `<M>` is the master SHA and `<B>` is the blob id of `docs/agents/audit-dimensions.md` at `<M>`.
  Verify `git rev-parse <M>:docs/agents/audit-dimensions.md` equals <B>, then read `git cat-file -p <B>` and echo
  `<B>` in the report. One pin covers round one, its challenges, the confirm and the confirm's challenges.
- **Document:** `docs/adr/<NNNN>-<slug>.md` in `/Users/jack/Documents/mac-app/mdpro` (uncommitted, Proposed). Read it
  from that path.
- **Mode:** plan review using the plan set from the pinned file at `<B>`.
- **Read also:** <the ADRs and rules it supersedes or touches; the evidence it cites>.
- **Check in particular:** <the questions that matter>; every clause of an Accepted ADR or rule it contradicts
  without naming it (ADR-0121 decision 6 if it changes an auditor's model, definition or request template).
- **Read barrier:** round one blind; a confirm reads both completed earlier rounds and the merged verdict, never the
  other auditor's current-round report.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/ADR-<NNNN>-r<k>.md`, ending
  `COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>`.
