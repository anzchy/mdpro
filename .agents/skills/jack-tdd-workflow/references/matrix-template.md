# Test matrix template

Copy this to `~/.mdpro-redesign/herdr-spike/<your agent name>/<item>-test-matrix.md` and fill it in before any test exists.
It is a list of cases, not code: each case names its situation and the effect it checks.

Header: the item id, the brief path, the branch and base SHA, and the test files the cases go in.

## Case classes to cover for every AC

- **success**: the behaviour the AC asks for, on ordinary input.
- **boundary**: empty, one, max, just below and just above a limit, CJK and other multi-byte text.
- **invalid input**: what the code must refuse, and that a hard-coded answer would not satisfy.
- **lifecycle and timing**: close, reopen, switch or replace during an `await`; a stale token; a queued or batched
  operation; a second event mid-way.
- **caller or entry path**: every caller, command, menu item, event or script that reaches the changed behaviour.
- **platform**: macOS, Windows, CI runners, where the AC differs by platform.

A class that cannot apply to an AC says so in one line, with the reason.

## Cases

The assertion is a document, state or IPC effect, not a bare boolean and not "it was called".

| id | AC | class | situation | assertion | test file | cycle |
|---|---|---|---|---|---|---|
| C1 | AC-1 | success | … | … | `tests/…test.ts` | S1 |

The `cycle` column is filled in as cycles run (`S<n>`, `ACC`, `raw-green`, or `added in cycle n`).

## Amendments

After the attack, and during the cycles, append one row per change: the gap or the reason, its disposition (added, or
rejected with a counter-proof), and the case ids it added or changed.
