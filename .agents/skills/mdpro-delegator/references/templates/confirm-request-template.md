# Request: <ID> PR #<n> confirm, round <k> (both auditors, at most two rounds, ADR-0143)

- **Protocol pin:** `<M>` is the master SHA and `<B>` is the blob id of `docs/agents/audit-dimensions.md`
  at `<M>`. Verify `git rev-parse <M>:docs/agents/audit-dimensions.md` equals <B>, then read
  `git cat-file -p <B>` and echo `<B>` in the report. One pin covers round one, its challenges, the confirm and the confirm's challenges;
  use the round-one `<M>` and `<B>` even if master moved. Read the procedure source at `<M>`.
- **Range:** `<base>..<new sha>`; the fix diff is `<old sha>..<new sha>`; across a rebase, check
  `git range-diff <old base>..<old sha> <new base>..<rebased>`. Tier <T>. Phase: `confirm`.
- **Open findings**, each with its text: <id> [High] (raised by <who>, <challenge outcome>): <text>. <Every
  counter-proof it must answer, quoted or by path.>
- **Read:** <gpt-auditor's completed earlier rounds>, the delegator verdict(s), the fix brief and handoff. Do not read the
  other auditor's round-<k> report.
- **Scope (ADR-0121 decision 4):** the fix diff; every open finding and each unfixed instance of its class (<name the
  class's other paths>); any Critical or High a commit in the range introduced, exposed or worsened.
- **AC evidence:** include `COVERAGE` and an `AC line for every AC` touched by the fix or not previously PROVED;
  carry other ACs by reference, and cite any recorded ADR-0146 decision 4 acceptance and its ground.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/<ID>-r<k>.md`, each finding CLOSED / PARTIAL / OPEN with
  evidence, the required COVERAGE and AC lines, and Mediums listed one line each. End with the COUNT line.
