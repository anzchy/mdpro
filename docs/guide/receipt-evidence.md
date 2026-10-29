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
| `node scripts/tdd/red-receipt.mjs check-pending` | Judges every branch receipt on every lane and names each one that needs review, with its reason. |
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

It creates the detached worktree `verify-<sha7>-replay-<id>`, under `MDPRO_REPLAY_ROOT`, else the
`mdpro-wt/` beside the main checkout, else the temp dir. Inside it:

1. **Restore to base.** Pure test paths stay at head. A Rust file that holds test modules gets base
   production with the head's test modules spliced in, module by module. Every other changed path
   is checked out at base, or removed if the branch added it. Item-level `#[cfg(test)]` seams are
   production, so they go back to base too.
2. **Dependencies.** An unchanged lockfile reuses the caller's `node_modules`; otherwise the
   replay runs `pnpm install --frozen-lockfile --offline`.
3. **Run base, then head.** Vitest runs directly on the receipt's files. Rust runs the recorded lane
   command. Each run goes through `scripts/heavy-lock.sh`. Each run is bounded by `MDPRO_REPLAY_TIMEOUT_MS`
   (default 900 s); a run that times out or is killed fails the replay with that cause.

**When a replay passes.** Every recorded id must have been an assertion at RED, must fail at base
as an assertion at the RED location, and must pass at head. The RED location is the RED line
mapped onto the file as it ran, through `git diff -U0`. When that line was itself edited, the same
assertion message is required instead. Anything else fails and names the id:
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
`tests_tree`, `base`, `head`, `head_tests_tree`, `spec_blobs` and `replay`. Here `replay` is its stable
projection: the result, and each id's status, kind and location at base and head. Message text is
left out, so a message that embeds a temp path or a counter does not change the digest between two
runs. Any change of base or head changes it, and `--expect-digest` reports `digest mismatch`.

**Pre-entry receipts** have no current sidecar entry (ADR-0149 d4). The replay runs the head's
spec files over base production and lists the cases that pass there as `passing_at_base`. It
writes `mode: "pre-entry"` with `user_ruling_required: true` and always exits non-zero.

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
