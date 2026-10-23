# M1b keyboard device brief — 2026-10-23

The [per-chord device input](20261023-m1b-device-chords.md) is generated from the v1 and v2 defaults in `src-tauri/src/menu_layout.json`. It lists all 74 changed platform × editor-mode combinations. Record the actual effect in its final column on macOS and Windows (German QWERTZ), then check the old chord and any owner shown in the table.

For each available editor command, focus the composed WYSIWYG or Source editor with the app window listener active. Check that the new key runs once and the old mdpro assignment does not. For a keyless, unavailable, or system row, verify the stated inert/native behavior. Math Block and Table are intentionally inert in the mode shown as inert in the input; Switch Documents remains unavailable in M1b.

Also check the M1b brief's native menu-bar cases, recorder and modal guards, Source table arrow behavior, and German AltGr text input. Capture the relevant `ui.menu.select`, `preferences.shortcuts.applied.resolve`, or editor action log line for each effect.
