# Request: challenge, <ID> round <k>, <finding id> (one-sided High or lifecycle Medium)

**Protocol pin:** `<M>` is the master SHA and `<B>` is its `docs/agents/audit-dimensions.md` blob id. Verify
`git rev-parse <M>:docs/agents/audit-dimensions.md` equals <B>, then read `git cat-file -p <B>` and echo `<B>` in
the report. One pin covers round one, its challenges, the confirm and the confirm's challenges.

Range `<base>..<sha>` (PR #<n>). Phase: `challenge`. Read only the finding below and its evidence, plus the code. Do
not read anything else from the other auditor's folder.

On a `hard` range, an untraced lifecycle Medium is sent to the other auditor as a "trace this" challenge in the same
round. Supply the ordered trace to raise it to High. If there is neither a trace nor a counter-proof, return
`UNTRACED`; the finding stays a listed Medium in the merge verdict. Do not silently drop the Medium.

## The finding, as raised by <auditor>
<verbatim title, location, trace and proposed fix>

## Return
For a challenged High, return `CONFIRMED|REFUTED`. A refutation needs a reproduction or a counter-proof (a file:line
trace showing the path is not reached); "unlikely" or "narrow timing" is not one. For a lifecycle-Medium `trace this`
challenge, return `CONFIRMED` with an ordered trace that raises it to High, `REFUTED` with a reproduction or a
counter-proof, or `UNTRACED` when neither exists; `UNTRACED` stays a listed Medium in the merge verdict. Write
`~/.mdpro-redesign/herdr-spike/<other auditor>/<ID>-r<k>-challenge-<finding>.md`, ending with
`CHALLENGE <finding>: CONFIRMED|REFUTED` for a High, or
`CHALLENGE <finding>: CONFIRMED|REFUTED|UNTRACED` for a lifecycle Medium.
