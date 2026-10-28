# Request: <ID> PR #<n> audit, round 1

- **Protocol pin:** `<M>` is the master SHA; `<B>` is the blob id of `docs/agents/audit-dimensions.md` at `<M>`.
  Verify `git rev-parse <M>:docs/agents/audit-dimensions.md` equals <B>, then read
  `git cat-file -p <B>`. One pin covers round one, its challenges, the confirm and the confirm's challenges.
  Read each auditor's procedure source at `<M>`; echo `<B>` in the report.
- **Range:** `<base>..<sha>` (<n> commits, branch `<branch>`). Read with `/usr/bin/git diff --no-ext-diff <base> <sha>`
  after `git fetch origin`. The base is the fork point on master.
- **Owner:** <agent>. **Tier: <T>** (full or mini set from the pinned file). **Difficulty: <D>** (ADR-0138): build your
  own map of every acquirer of each lock the range touches and every writer/deleter of each persisted value it changes;
  on `hard`, read every changed file and its callers in full; name what you expanded.
- **Read:** the brief `~/.mdpro-redesign/herdr-spike/<owner>/<ID>-brief.md`, the handoff `<ID>-handoff.md`, and the
  matrix, attack, review and coverage files beside them.
- **Acceptance criteria:** AC-1… in the brief, plus: <the specific properties to attack>.
- **Unproved AC:** cite any recorded ADR-0146 decision 4 acceptance in this request, including its ground (a), (b)
  or (c). Otherwise send the handoff back before audit.
- **Known qualifications** (not findings by themselves): <receipt states, file-size notes, out-of-grant lane results>.
- **Read barrier:** round one. Do not read PR comments, `herdr-spike/delegator/`, or the other auditor's folder.
- **Output:** `~/.mdpro-redesign/herdr-spike/<auditor>/<ID>-r1.md`, headed
  `## <Codex audit (<model> <effort>) | Opus audit> — <ID> @ <sha7> · tier <T> · round 1`.
  Include `COVERAGE` per dimension and one `AC line for every AC`, each with the auditor's own verdict and evidence.
  Critical and High carry evidence; Mediums are listed one line each and Lows counted. End with
  `COUNT C<n> H<n> M<n> L<n> · BLOCKING C<n> H<n>` (and, on High tier, a security
  count line), plus your session's input / cached / output tokens while the ADR-0138 pilot runs.
