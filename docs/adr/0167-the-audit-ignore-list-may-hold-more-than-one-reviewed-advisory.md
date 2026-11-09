# 0167. The `audit.toml` ignore list may hold more than one advisory, each for code that is not compiled

## Status

**Accepted** (2026-11-09), by the user: 「接受 ADR-0167 (Recommended)」, after plan review by both auditors (a dependency's accepted advisory, so review was required). Round 1: gpt NOT READY C0 H1 M2, opus NOT READY C0 H1 M4 L2. Round 2 (the cap): opus READY C0 H0 M1 L2, its Medium and Lows folded into this text; gpt NOT READY C0 H1, holding that ADR-0107 decision 4 is CI process and should be folded with a decision-log entry (Option D). The user ruled on that classification by accepting this ADR. Proposed 2026-11-09 by herdr-delegator for #729, under the user's 「写新 ADR 取代该条 (Recommended)」. Partially supersedes [ADR-0107](0107-cargo-audit-runs-in-its-own-job-outside-the-landing-gate.md), decision 4, only the sentence "The first and only entry is RUSTSEC-2026-0189, until the rmcp ≥ 1.4 bump." ADR-0107's other decisions and the rest of decision 4 stand. On acceptance ADR-0107 gains the dated Status line "Partially superseded: decision 4's 'first and only entry' sentence by ADR-0167", and its INDEX row under process records is annotated.

## Enforced by

`tests/tooling/ci-workflow-gate.test.ts`, once #729's revised candidate lands. It pins (1) the exact ordered id list, so every addition is a reviewed test change; (2) spot checks of named reasons for the two current entries; and (3) the feature list of rmcp in `src-tauri/Cargo.toml`, so enabling an rmcp transport feature fails a test and forces this list to be re-read. It does not check every entry's reason generically: a later entry's reason is checked only if its PR adds the assertion.

## Context

- **ADR-0107 wrote a snapshot into a rule.** Decision 4 sets the mechanism: each accepted advisory lives in `src-tauri/.cargo/audit.toml` with its id, the reason it does not reach mdpro, and what removes it, and the list is pinned by a test, "so adding an ignore is a reviewed test change". It also says the first and only entry is RUSTSEC-2026-0189. Read literally, that sentence forbids the reviewed addition the same decision describes.
- **A second rmcp advisory arrived.** RUSTSEC-2026-0462 (2026-11-05) reports unbounded response-body buffering in rmcp's Streamable HTTP client transport. mdpro pins rmcp 0.14.0; there is no 0.14.x fix, and the patched release is 3.9.0. Since then `rust-audit` is red on every PR and on the daily run (#729).
- **The vulnerable code is not compiled.** In rmcp 0.14.0 the client module `transport::streamable_http_client` is gated on the `transport-streamable-http-client` feature, and its reqwest implementation on `transport-streamable-http-client-reqwest` (through `__reqwest`, `reqwest`, `auth`). `src-tauri/Cargo.toml` asks for `server` and `transport-io` only. `cargo tree -e features -i rmcp` on master, with default and with all features, shows `base64`, `default`, `macros`, `server`, `transport-async-rw` and `transport-io`, and the lockfile's rmcp entry has no `reqwest`. rmcp is a plain `[dependencies]` entry, the same for every target. The `mdpro_mcp` sidecar uses `rmcp::transport::stdio`.
- **ADR-0122 drew the line at compilation.** It removed `zip`'s feature instead of ignoring its advisories because the vulnerable code was compiled into the Windows build, although nothing could reach it. This ADR keeps that line.

## Options considered

- **A. Allow more entries under decision 4's existing mechanism, only for code that is not compiled** (chosen).
- **A′. Also allow compiled-but-unreachable code.** Lost: it contradicts ADR-0122's choice on the same facts, and "cannot be reached" is a call-path judgment that no test holds, while "not compiled" is checked by `cargo tree` and a feature pin.
- **B. Upgrade rmcp to 3.x now.** Lost for now: a three-major-version change to the MCP server crate and the sidecar is a gated item (rule 12) of its own, not a CI fix. It stays the removal path for both entries.
- **C. Leave `rust-audit` red until the upgrade.** Lost: the job fails the next `v*` tag build (ADR-0107 decision 2), and a permanently red check hides the next advisory that does reach mdpro.
- **D. Fold the clause into a rule with a decision-log entry** ([2026-11-02 entry](../agents/decisions/20261102-changing-an-unfolded-process-adr-clause.md)), the route for an unfolded clause of a process ADR. Not taken: the delegator classifies ADR-0107 as a mixed record ([README § Mixed cases](README.md)). Its job layout and daily run are process, and are unchanged, so they need no log entry. Decision 4's accepted-advisory list is its product half, on the scope list as "a dependency added or refused" (mdpro keeps rmcp 0.14 and refuses the 3.x upgrade for now) and "platform and release scope, including what a release workflow ships" (whether a `v*` tag build ships a dependency version with a published advisory). It is not "accepting a known product defect": the vulnerable code is not compiled. The closest precedent, ADR-0122, is indexed under tooling dependencies, not process records. One auditor held in plan review that this half is CI process; the classification was put to the user, who chose this ADR route.

## Decision

1. **The ignore list may hold any number of entries.** Each one is added only in a commit that also updates the id pin in `tests/tooling/ci-workflow-gate.test.ts` and goes through the PR audit. Next to the id it states: the crate and version, the feature gates of the vulnerable code and the evidence that none is enabled, and what removes the entry.
2. **An entry is only for code that is not compiled into any shipped target.** Compiled code, reachable or not, takes an upgrade, a feature removal (ADR-0122) or its own ADR accepting the defect.
3. **The pin test also pins rmcp's requested features** (`["server", "transport-io"]` today). Changing them fails the test, and that PR re-reads every rmcp entry here.
4. **RUSTSEC-2026-0462 is the second entry.** It and RUSTSEC-2026-0189 are both removed by the rmcp 3.x upgrade (≥ 3.9.0), which replaces ADR-0107's "rmcp ≥ 1.4 bump" as the removal for 0189. #729's candidate updates both comments to match before audit.

## Consequences

- `rust-audit` goes green again on PRs, the daily run and the tag build, so a new advisory shows up as a real red.
- Costs: two known advisories stay in the lockfile until the rmcp 3.x upgrade, which is not planned or scheduled. Each ignore holds across rmcp versions until someone removes it. The feature pin covers rmcp only: a transitive crate that turns on an rmcp feature is caught only by `cargo tree`, not by the pin. A `cargo update` inside 0.14.x that adds a client transport to rmcp's `default` set changes only the lockfile and leaves the pin green. A later entry for another crate needs its own feature pin or relies on review.
- Each new ignore costs a reviewed PR, which is the point.
