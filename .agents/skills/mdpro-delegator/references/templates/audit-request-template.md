# Request: <ID> PR #<n> audit, round 1

- **Range:** `<base>..<sha>` (<n> commits, branch `<branch>`). Read with `/usr/bin/git diff --no-ext-diff <base> <sha>`
  after `git fetch origin`. The base is the fork point on master.
- **Owner:** <agent>. **Tier: <T>** (<nine full dimensions | mini's five>). **Difficulty: <D>** (ADR-0138): build your
  own map of every acquirer of each lock the range touches and every writer/deleter of each persisted value it changes;
  on `hard`, read every changed file and its callers in full; name what you expanded.
- **Read:** the brief `~/.mdpro-redesign/herdr-spike/<owner>/<ID>-brief.md`, the handoff `<ID>-handoff.md`, and the
  matrix, attack, review and coverage files beside them.
- **Acceptance criteria:** AC-1… in the brief, plus: <the specific properties to attack>.
- **Known qualifications** (not findings by themselves): <receipt states, file-size notes, out-of-grant lane results>.
- **Read barrier:** round one. Do not read PR comments, `herdr-spike/delegator/`, or the other auditor's folder.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/<ID>-r1.md`, headed
  `## <Codex audit (<model> <effort>) | Opus audit> — <ID> @ <sha7> · tier <T> · round 1`. Critical and High with
  evidence; the rest counted. End with `COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>` (and, on High tier, a security
  count line), plus your session's input / cached / output tokens while the ADR-0138 pilot runs.
