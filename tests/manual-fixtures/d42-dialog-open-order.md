# D42 device check: App-level dialogs stack in open order

ADR-0062. Run on a release bundle. The user performs every click and key
press; the agent only runs the shell commands and reads the log. Run on a
copy, never on this file: ⌘W prompts are answered here, an external write
changes the file, and a draft can outlive the run.

## Setup

- `S` = your scratchpad directory. `cp tests/manual-fixtures/d42-dialog-open-order.md "$S/d42.md"`,
  then open the copy: `open -a mdpro "$S/d42.md"`.
- Logging must be on (⌘, → Advanced).
- Before each check, mark the log: `N=$(wc -l < ~/.mdpro/mdpro.log)`. After it,
  read the new lines: `tail -n +$((N+1)) ~/.mdpro/mdpro.log | jq -c 'select(.event | test("dialog|mcp.confirm"))'`.
- "Dirty" = type one character in the body below, without saving.
- G-D42-3 and G-D42-4 need the MCP server on and the `mcurl` preamble from
  `docs/guide/mdpro-mcp-guide.md` § 5. An MCP write prompts only while the
  owning window is **not** focused, so start it from Terminal. Answer each
  prompt within 60 s, or it times out (408) and the check must be rerun.

## G-D42-1: Unsaved, then an external change → Reload on top

1. Make the copy dirty. In Terminal: `(sleep 8; printf '\nexternal\n' >> "$S/d42.md") &`
2. Within 8 s, switch to mdpro and press ⌘W. "Unsaved changes" opens.
3. Wait for the external write. Do not click anything.

Expected: "External change detected" is visible **above** "Unsaved changes".
The log has `ui.dialog.stack` with `order: ["confirm","reload"]`. Press Esc:
the Reload prompt closes (`ui.dialog.cancel`, `controlId: "dialog.reload.ignore"`,
and **no** `ui.dialog.escape` line); "Unsaved changes" is still open. A second
Esc cancels it (`ui.dialog.escape`). If the first Esc does nothing, focus was
not inside Reload (ADR-0045 Cost e): record it, then click Ignore and check
the same log line. That is a known cost, not a D42 failure.

## G-D42-2: the reverse order → Unsaved on top

1. Make the copy dirty. In Terminal: `printf '\nexternal 2\n' >> "$S/d42.md"`.
   Switch to mdpro; the Reload prompt is open.
2. Press ⌘W.

Expected: "Unsaved changes" is above the Reload prompt; the log has
`order: ["reload","confirm"]`. Esc cancels "Unsaved changes" (`ui.dialog.escape`)
and the Reload prompt stays, answerable with Ignore.

## G-D42-3: MCP prompt, then ⌘W → Unsaved on top of MCP

1. Make the copy dirty. In Terminal (mdpro not focused):
   `DOC=$(mcurl "$API/api/documents" | jq -r '.[] | select(.path | endswith("d42.md")) | .id')`
   then `mcurl -X POST "$API/api/documents/$DOC/insert" -d '{"text":"MCP ","position":"start"}' > "$S/g3.out" &`
2. Click mdpro's title bar. The MCP confirm prompt is showing. Press ⌘W.

Expected: "Unsaved changes" is above the MCP prompt; the log has
`order: ["mcp","confirm"]`. Click Keep editing: the MCP prompt is still
visible and answerable. Click Reject: `cat "$S/g3.out"` shows 403
`USER_REJECTED`, and the document is unchanged.

## G-D42-4: Settings, then an MCP prompt → MCP on top

1. In mdpro press ⌘,. Settings opens.
2. In Terminal, run the `mcurl … insert …` command from G-D42-3 (output to
   `"$S/g4.out"`).
3. Click mdpro's title bar.

Expected: the MCP prompt is above Settings; the log has
`order: ["settings","mcp"]`. Esc rejects the prompt (`ui.dialog.escape`; 403
in `"$S/g4.out"`) and Settings stays open.

## Body

Type here to make the document dirty.
