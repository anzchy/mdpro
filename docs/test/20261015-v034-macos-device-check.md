# v0.3.4 release candidate, macOS device check: D204 and D208 (2026-10-15)

Recorded by mdpro-delegator. **Verdict: PASS for the release gate** (R1, R2). The run was done by
dtrack on the Mac mini, 08:26–08:29 +0800, following the brief
`docs/pending/20261015-brief-v034-d204-d208.md`. The full report stays on the mini at
`~/.mdpro-redesign/dtrack/reports/20261015-v034-d204-d208.md`.

## Build

| Item | Value |
|---|---|
| Candidate | `3b16610` (`chore: bump version to v0.3.4`, the locked v0.3.4 SHA) |
| Artifact | `build-darwin-aarch64` of build-only release run 38653861669 (the run's `headSha` reads `e1dd914`, the dispatching branch tip; the build checked out `inputs.ref` = `3b16610`) |
| Binary | tauri-app sha256 `8862e82a167f2424508b1370b580a3e0635cc2541f67468a544c7ded66f5e459`, version 0.3.4 |
| `app.ready` | L26685 `releaseId:"0.3.4@3b16610b9031db2f4530282c80c33952258c5fe5"`; About shows v0.3.4 |
| Helpers | `key.sh`, `kc.sh` and `shot.sh` from `verify-9940be9`, approved by the delegator |

The first attempt stopped at pre-flight because the screen was locked. The user unlocked the mini
(「Unlocked, go ahead (Recommended)」) and the run restarted from the beginning.

## Results

| Row | Verdict | Proof |
|---|---|---|
| R1 D204: `-`, `+` and `1)` markers survive an edit and ⌘S in WYSIWYG | **PASS** | L26738 `file.save` success; `diff` against the original is only `end` → `endX` |
| R2 D208: a list starting at `5.` keeps its number | **PASS** | L26799 `file.save` success; the file still reads `5. five` / `6. six` / `7. seven` |
| R3 A new list typed in the editor is written with `-` | **PASS** for the marker; **NOT EXERCISED** for the second item | L26819 `file.save` success; written as `- newnext`, because the Return after `new` only committed the input method's composition |

## Caveat: the Doubao Pinyin input method was active

The input source was still Doubao Pinyin, left on by the WI-004 H1 run
([record](20261015-wi004-tauri-upgrade-device-check.md)). Two consequences:

- In R1 and R2 the typed `X` / `Y` was still an uncommitted composition when ⌘S ran, and the
  serializer wrote it. The D204 / D208 verdicts hold, because each save serialized the whole
  document and every marker and start number came back unchanged.
- Afterwards, when the window lost focus, macOS dropped the composition. The editor fell back to
  77 bytes and marked the tab dirty, while the file on disk kept `endX`. So mdpro saves composition text
  that has not been committed yet. This is an input-method behaviour, related to
  [D219](../plans/20260912-frontend-backend-sequencing-order.md#d219), not a D204 regression.

The input source was not changed by this run.
