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

## Landing

**Policy file**:
A file whose text instructs agents how to work, such as the project instructions, the always-on rules, agent definitions, skills, command rules and the agent docs under `docs/agents/`. Changing one changes agent behaviour.
_Avoid_: docs, prose (for these files)

**Knowledge document**:
A file that records or explains, such as an ADR, a plan, a guide, a report or a log. Changing one changes no agent behaviour by itself.
_Avoid_: policy

**Gate exception**:
A recorded, user-approved permission to land one change although a named landing condition is unmet.

## TDD

**Test matrix**: the list of cases written before any implementation, each naming its situation and the effect it checks (a document, state or IPC effect, not a boolean).
_Avoid_: test plan, test list

**Matrix attack**: a search, by an attacker who shares none of the designer's context, for wrong implementations that pass every case in a test matrix.
_Avoid_: spec review, test review

**RED receipt**: the record that a test failed on its assertion before the production change, later judged by verify for whether that change alone turned it green.
_Avoid_: red proof, failing snapshot

**Cycle**: one matrix case taken through its RED receipt, the minimal change, a small refactor while green, and verify, settled before the next begins.
_Avoid_: step, iteration
