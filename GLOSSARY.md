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

**Owned elsewhere**: a chord that another program on the machine has registered system-wide, so mdpro never receives it.
_Avoid_: blocked key, stolen shortcut
