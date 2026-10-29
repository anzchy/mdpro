# Receipt evidence: record, verify, check, replay

**The repo's receipt entry, `scripts/tdd/red-receipt.mjs`, records a tdd-guardian RED receipt
together with enough evidence to explain it later and to replay it against the PR base.** The rules
come from [ADR-0145](../adr/0145-a-broken-red-receipt-carries-its-own-evidence-and-the-auditors-rule-on-it.md)
as amended by [ADR-0149](../adr/0149-a-broken-receipt-is-judged-by-a-base-tree-fail-to-pass-replay.md).
The plugin's `receipts.json` is untouched: it never gains a field, and nothing here changes a verdict.

## Commands

| Command | What it does |
|---|---|
| `node scripts/tdd/red-receipt.mjs record --id <ID> --test tests/<file>.test.ts` | Frontend RED on the `unit-red` lane, up to four files. |
| `node scripts/tdd/red-receipt.mjs record --id <ID> --lane rust --test src-tauri/<file>.rs` | Rust RED on the `rust` lane. It refuses any file that is not `rustfmt`-clean at the crate's edition, before the lane runs. |
| `node scripts/tdd/red-receipt.mjs verify --id <ID>` | Settles the receipt on its own lane. It also exits non-zero with **evidence required** when the plugin holds but a spec file's bytes changed since RED: an inserted `return`, a blank line, anything. |
| `node scripts/tdd/red-receipt.mjs discard --id <ID>` | Drops an unsettled branch receipt and its sidecar entry. Its pin ref stays for the sweep. |
| `node scripts/tdd/red-receipt.mjs check-pending` | Judges every branch receipt on every lane and names each one that needs review, with its reason. It needs the installed tdd-guardian plugin only when the branch has a receipt of its own; on a runner without it, such a branch fails closed with the plugin named. |
| `node scripts/tdd/red-receipt.mjs replay --id <ID> [--base <rev>] [--expect-digest <hex>]` | Prints the diffs, replays the RED against the PR base, and digests the result. |

**Recording rules** (ADR-0149 d5):
- Commit shared fixtures, support files and imports **before** recording a RED.
- Record one receipt per case.
- Say so in the handoff whenever you edit a test file that another open receipt names.

## What `record` stores

It writes nothing until the plugin's own record has succeeded. It then writes, in this order:

1. **The pinned test tree.** The working-tree bytes of every test path, dirty and untracked files
   included, become one tree under `refs/receipts/<id>/<recorded-at without - : .>/tests`.
   - A test path is any path under `tests/` or `src-tauri/tests/`, any Rust file that holds a
     `#[cfg(test)]` or `#[cfg(all(test, …))]` module, and every file such a declaration reaches.
   - The tree is written through a private index, so the real index and the working tree are
     never touched.
   - The ref is local: every worktree shares the object store, and nothing pushes `refs/receipts`.
   - If the test tree changes while the lane runs, the record refuses.
2. **The sidecar entry** in `.claude/tdd-guardian/evidence.json`, a tracked file. It is written
   under the repo-wide lock `.claude/tdd-guardian/.evidence.lock` and holds:
   - `failures`: each failing id, with its kind, location and message. The id is
     `["file", …describe titles, "title"]` for Vitest and `<target>::<name>` for libtest. The kind
     is one of `assertion | panic | compile | collect`.
   - `tests_tree`: `{ref, tree}`.
   - `spec_blobs`: the git blob id of each spec file at RED.
   - `plugin_version`, `lane_command`, and `env`, which holds only whitelisted keys plus the
     node version and platform.
   - Later, `settled_blobs`, `evidence_required` and `replay`.

**Stale entries.** An entry whose `recorded_at`, lane or plugin version differs from the receipt's
reads as **no evidence**. A malformed sidecar refuses the record and is left as it is.

## The replay

`replay` uses `--base` when given, else `origin/master` if it exists, else `master`, and takes the
merge-base of that and `HEAD`. It works on the committed head; the caller's dirty files never
enter it.

It creates a fresh directory `verify-<sha7>-replay-<id>-XXXXXX` (`mkdtemp`), under `MDPRO_REPLAY_ROOT`,
else the `mdpro-wt/` beside the main checkout, else the temp dir, and adds a detached worktree there.
Two checkouts replaying the same id and head therefore never share a path. The worktree is the
operation's own only once `git worktree add` succeeds: only then is its path written into the flock
file, and only then is it removed afterwards. When the add fails, the operation removes its own
directory only while that is still empty. Inside it:

1. **Restore to base.** Pure test paths stay at head. A Rust file that holds test modules gets base
   production with the head's test modules spliced in, module by module. Every other changed path
   is checked out at base, or removed if the branch added it. Item-level `#[cfg(test)]` seams are
   production, so they go back to base too.
2. **Dependencies.** An unchanged lockfile reuses the caller's `node_modules`; otherwise the
   replay runs `pnpm install --frozen-lockfile --offline`.
3. **Run base, then head.** Vitest runs directly on the receipt's files. Rust runs the recorded lane
   command. Each run goes through `scripts/heavy-lock.sh`. Each run is bounded by `MDPRO_REPLAY_TIMEOUT_MS`
   (default 900 s), plus heavy-lock's admission wait `MDPRO_HEAVY_LOCK_WAIT_SECS` (default 1800 s)
   when the run, the install or the recorded Rust lane command goes through `heavy-lock.sh`. A
   contended run therefore reaches heavy-lock's own refusal (exit 75) rather than being killed. A run fails the replay with its cause when it times out, is killed, is refused by
   heavy-lock (exit 75 or 76), or, for Rust, prints no libtest block and no compile error.

**The entry's own bound.** The entry runs every operation except `check-pending` under a python
launcher that holds the per-id OS flock. Its bound is derived from what it wraps:
- a replay gets three replay runs (install, base, head), each with heavy-lock's admission wait, plus 120 s;
- record, verify and discard get the longest receipt-lane timeout plus 120 s, and never less than
  720 s.

When it hits that bound, or the entry gets SIGINT, SIGTERM or SIGHUP, or the calling entry dies,
the launcher:
1. stops the operation's whole process group: SIGTERM, then SIGKILL after
   `MDPRO_UNIT_RED_KILL_GRACE_MS` (default 20 s);
2. removes the replay worktree the operation named in the flock file, and only a path whose basename
   holds `-replay-`.

The launcher empties the flock file as soon as it holds the lock. A marker left by an earlier
launcher that was itself SIGKILLed names a worktree this operation never added, so it is dropped,
never acted on; that worktree stays until a person removes it. It exits 64 at the bound and
re-raises a signal.

**When a replay passes.** Every recorded id must have been an assertion at RED, must fail at base
as an assertion at the RED location, and must pass at head. The RED location is the RED line
mapped onto the file as it ran, through `git diff -U0`. When that line was itself edited, the same
assertion message, raised in the same file, is required instead. Anything else fails and names the id:
- a pass, skip or disappearance at base;
- a panic or collect error at base;
- another location or message;
- a failure at head;
- a panic-kind id in the RED set;
- an unspliceable Rust file;
- a missing or moved pin ref, which is refused outright.

**The evidence file**, `.claude/tdd-guardian/evidence/<id>.json`, holds:
- `test_diff`: the pinned tree → the head's test paths;
- `prod_diff`: base → head over the production paths, including the production half of Rust holders;
- `replay`: `{result, reasons, ids}`;
- `digest_input`;
- `digest`.

**The digest** is sha256 over canonical JSON, keys sorted at every level, of `id`, `recorded_at`,
`tests_tree`, `base`, `head`, `head_tests_tree`, `spec_blobs` and `replay`. Here `replay` is the
result, the reasons, and each id's status, kind, location and whole message at base and head. The
text an auditor reads is therefore bound: a different message or reason gives a different digest.
Any change of base or head changes it, and `--expect-digest` reports `digest mismatch`.

**Normalisation.** Before reasons, messages and a pre-entry `base_run.error` enter the digest,
`normaliseText` (`scripts/tdd/receipt-replay.mjs`) rewrites what varies by nature between two runs
of the same base and head. It applies these rules, in this order, and nothing else:
1. **Worktree.** The replay worktree's path, as created and as its realpath, becomes `<worktree>`.
2. **Temp paths.** An absolute path under a temp root, up to the next whitespace, quote, bracket,
   comma or colon, becomes `<tmp>`; a `:line:col` after it stays. The roots are `os.tmpdir()` and its realpath, `/tmp`, `/private/tmp`,
   `/var/folders` and `/private/var/folders`.
3. **Timestamps.** An ISO-8601 date with a time (`2026-10-30T01:02:03.456Z`) becomes `<timestamp>`.
   A date alone stays.
4. **Durations.** A number followed by `ns`, `µs`, `us`, `ms` or `s` at a word end becomes
   `<duration>`. `3 strings` and `2 msgs` stay.
5. **Pids.** `pid` followed by a number, with an optional `=` or `:`, becomes `pid <pid>`.

Assertion text, other numbers, other paths and `file:line` locations stay as they are. The
evidence file keeps the raw text, and the judge compares raw text; only `digest_input` holds the
normalised form. A message that varies some other way, such as a counter, changes the digest.

**Pre-entry receipts** have no current sidecar entry (ADR-0149 d4). The replay runs the head's
spec files over base production and lists the cases that pass there as `passing_at_base`. It
writes `mode: "pre-entry"` with `user_ruling_required: true` and always exits non-zero.

A pre-entry base run can fail to complete: it times out, is killed, writes no report, is refused
by heavy-lock, or does not compile. Then `base_run` records `completed: false` with the `error` or
`compileError`, and `passing_at_base` is `null`. The replay prints `base run did not complete
(<cause>)`, never `0 case(s) pass at base`.

A pre-entry packet is digested too, over `id`, `mode`, `base`, `head`, `spec_blobs`, `base_run`
(`completed`, the normalised `error` and `compileError`) and `passing_at_base`. An incomplete run
therefore never shares a digest with a completed one, and two incomplete runs with different
causes never share one either.

## Who rules

`mdpro-landing-verifier` step 4 runs `check-pending`, and runs `replay --base <parent>` for every
receipt that `check-pending` names. It reports each digest.
- **Until the entry's clearing applies**, the delegator asks the user one batched question per
  landing (ADR-0149 d6).
- **After that**, both auditors' non-weakening rulings on a passed replay, citing the same digest,
  clear the receipt (ADR-0145 d4).

## Deleting pins

A pin ref is kept for 30 days after its work lands on `master`, then deleted
(`git update-ref -d refs/receipts/<id>/<stamp>/tests`). The landing date is the first `master`
commit whose `receipts.json` holds the id. A pin is never deleted before landing. `discard` leaves
its ref in place for this sweep. The sweep itself is not automated yet; the delegator runs it.
