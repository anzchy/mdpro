# Glossary

Terms the project uses in its specs, tickets, ADRs and code. One term per entry; a term to avoid is listed under it.

## Keyboard shortcuts

**Default binding**: the chord an action has when the user has not chosen one, per platform and per defaults version.
_Avoid_: built-in shortcut, factory key

**Secondary binding**: an extra chord that triggers the same action as its primary. The menu shows only the primary.
_Avoid_: alias key, alternate

**Defaults version**: the numbered set of default bindings that a saved configuration is stamped with. Moving between two
versions migrates only the values that still equal the old default.
_Avoid_: keymap version, schema version

**Owned elsewhere**: a chord that something else on the machine takes before mdpro sees it, so mdpro never receives it. That can be a system-wide hotkey another program registered, a low-level keyboard hook, or an input method's hotkey while that input method is active.
_Avoid_: blocked key, stolen shortcut

## Decisions

**Repository-wide ADR**: a numbered record `docs/adr/NNNN-*.md` of a decision about the product or its architecture, on the scope list in CLAUDE.md § ADR (ADR-0165 decision 1; [decision log](docs/agents/decisions/20261102-adr-scope-and-decision-log.md)). Its test: would a user of the released app, or a contributor reading product code, see the difference?
_Avoid_: global decision, process ADR (for new records)

**Decision-log entry**: one file `docs/agents/decisions/YYYYMMDD-<slug>.md` recording one process or tooling decision, listed in that folder's index. It takes no number and is never edited; a wrong one is corrected by a new entry.
_Avoid_: process ADR, decision log line

**Feature-local decision**: a decision that belongs to one feature, recorded in its spec snapshot `docs/specs/<feature>/r<N>/` or, after approval, in `docs/specs/<feature>/decisions.md`, under a local id `<prefix>-r<N>-D<n>` such as `T567-r1-D1`. It takes no global number.
_Avoid_: spec ADR, local ADR

## Landing

**Policy file**:
A file whose text instructs agents how to work, such as the project instructions, the always-on rules, agent definitions, skills, command rules and the agent docs under `docs/agents/`. Changing one changes agent behaviour.
_Avoid_: docs, prose (for these files)

**Knowledge document**:
A file that records or explains, such as an ADR, a plan, a guide, a report or a log. Changing one changes no agent behaviour by itself.
_Avoid_: policy

**Gate exception**:
A recorded, user-approved permission to land one change although a named landing condition is unmet.

**Change scope**:
The class of a changed path (prose, policy or code) that decides how it may land and which CI runs; a change takes the most
demanding scope among its paths.
_Avoid_: docs tier, CI tier (tier means the audit tier)

**Gate input**:
A file that is not code but that a test or gate script reads; its readers run before it lands, by any route.
_Avoid_: executable doc, test fixture (for these files)

## TDD

**Test matrix**: the list of cases written before any implementation, each naming its situation and the effect it checks (a document, state or IPC effect, not a boolean).
_Avoid_: test plan, test list

**Matrix attack**: a search, by an attacker who shares none of the designer's context, for wrong implementations that pass every case in a test matrix.
_Avoid_: spec review, test review

**RED receipt**: the record that a test failed on its assertion before the production change, later judged by verify for whether that change alone turned it green.
_Avoid_: red proof, failing snapshot

**Cycle**: one matrix case taken through its RED receipt, the minimal change, verify, and then a small refactor with tests green, settled before the next begins.
_Avoid_: step, iteration
