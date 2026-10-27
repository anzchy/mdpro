# Request: challenge, <ID> round <k>, <finding id> (one-sided High)

Range `<base>..<sha>` (PR #<n>). Phase: `challenge`. Read only the finding below and its evidence, plus the code. Do
not read anything else from the other auditor's folder.

## The finding, as raised by <auditor>
<verbatim title, location, trace and proposed fix>

## Return
CONFIRMED or REFUTED. A refutation needs a reproduction or a counter-proof (a file:line trace showing the path is not
reached); "unlikely" or "narrow timing" is not one. Write
`~/.mdpro-redesign/herdr-spike/<other auditor>/<ID>-r<k>-challenge-<finding>.md`, ending with
`CHALLENGE <finding>: CONFIRMED|REFUTED`.
