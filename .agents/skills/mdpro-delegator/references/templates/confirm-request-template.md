# Request: <ID> PR #<n> confirm, round <k> (<"the last, ADR-0120" when k = 3>)

- **Range:** `<base>..<new sha>`; the fix diff is `<old sha>..<new sha>`; across a rebase, check
  `git range-diff <old base>..<old sha> <new base>..<rebased>`. Tier <T>. Phase: `confirm`.
- **Open findings**, each with its text: <id> [High] (raised by <who>, <challenge outcome>): <text>. <Every
  counter-proof it must answer, quoted or by path.>
- **Read:** <both auditors' completed earlier rounds>, the merged verdict(s), the fix brief and handoff. Do not read the
  other auditor's round-<k> report.
- **Scope (ADR-0121 decision 4):** the fix diff; every open finding and each unfixed instance of its class (<name the
  class's other paths>); any Critical or High a commit in the range introduced, exposed or worsened.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/<ID>-r<k>.md`, each finding CLOSED / PARTIAL / OPEN with
  evidence. End with the COUNT line.
