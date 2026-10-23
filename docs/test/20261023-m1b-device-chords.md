# M1b changed chord device input

Generated 2026-10-23 from `src-tauri/src/menu_layout.json`, which is generated from the command table. For each row, use the real composed editor with its window listener in the stated mode. Press each physical new key, then reset and press each physical old key. Sentinels such as `<unassigned>` and `<system>` are states, not chords to press. Record one command effect for an available new key, no former action on the old key, and the old owner shown below. `None in table` also requires checking for a native or editor owner on device.

The old column is the command table's stored v1 default. The pre-M1b off-Mac Source editor separately bound Strike to Option+Shift+5; check that former editor key as well. The Windows column represents the off-Mac defaults used by both Windows and Linux.

| Platform | Mode | Command | Old v1 | New v2 | New expected effect | Old chord table owner | Device evidence |
|---|---|---|---|---|---|---|---|
| macos | W | app.hide | Cmd+H | — | inert | none in table |  |
| macos | S | app.hide | Cmd+H | — | inert | edit.replace |  |
| macos | W | edit.deleteWord | Cmd+Shift+D | <unassigned> | inert | none in table |  |
| macos | S | edit.deleteWord | Cmd+Shift+D | <unassigned> | inert | none in table |  |
| windows | W | edit.deleteWord | Cmd+Shift+D | <unassigned> | inert | none in table |  |
| windows | S | edit.deleteWord | Cmd+Shift+D | <unassigned> | inert | none in table |  |
| macos | W | edit.jumpToBottom | Cmd+Down | <system> | inert | none in table |  |
| macos | S | edit.jumpToBottom | Cmd+Down | <system> | inert | none in table |  |
| windows | W | edit.jumpToBottom | Cmd+Down | <system> | inert | none in table |  |
| windows | S | edit.jumpToBottom | Cmd+Down | <system> | inert | none in table |  |
| macos | W | edit.jumpToTop | Cmd+Up | <system> | inert | none in table |  |
| macos | S | edit.jumpToTop | Cmd+Up | <system> | inert | none in table |  |
| windows | W | edit.jumpToTop | Cmd+Up | <system> | inert | none in table |  |
| windows | S | edit.jumpToTop | Cmd+Up | <system> | inert | none in table |  |
| macos | W | file.openQuickly | Cmd+Shift+O | <unassigned> | inert | none in table |  |
| macos | S | file.openQuickly | Cmd+Shift+O | <unassigned> | inert | none in table |  |
| windows | W | file.openQuickly | Cmd+Shift+O | <unassigned> | inert | none in table |  |
| windows | S | file.openQuickly | Cmd+Shift+O | <unassigned> | inert | none in table |  |
| macos | W | format.highlight | Cmd+Shift+H | Cmd+Shift+M | format.highlight once | none in table |  |
| macos | S | format.highlight | Cmd+Shift+H | Cmd+Shift+M | format.highlight once | none in table |  |
| windows | W | format.highlight | Cmd+Shift+H | Cmd+Shift+M | format.highlight once | none in table |  |
| windows | S | format.highlight | Cmd+Shift+H | Cmd+Shift+M | format.highlight once | none in table |  |
| macos | W | format.image | Cmd+Ctrl+I | Cmd+Shift+I | format.image once | none in table |  |
| macos | S | format.image | Cmd+Ctrl+I | Cmd+Shift+I | format.image once | none in table |  |
| windows | W | format.image | no physical chord | Cmd+Shift+I | format.image once | none in table |  |
| windows | S | format.image | no physical chord | Cmd+Shift+I | format.image once | none in table |  |
| macos | W | format.strike | Ctrl+Shift+` | Cmd+Shift+X | format.strike once | none in table |  |
| macos | S | format.strike | Ctrl+Shift+` | Cmd+Shift+X | format.strike once | none in table |  |
| windows | W | format.strike | Ctrl+Shift+` | Cmd+Shift+X | format.strike once | format.code |  |
| windows | S | format.strike | Ctrl+Shift+` | Cmd+Shift+X | format.strike once | format.code |  |
| windows | W | paragraph.codeFences | Cmd+Option+C | Cmd+Shift+K | paragraph.codeFences once | none in table |  |
| windows | S | paragraph.codeFences | Cmd+Option+C | Cmd+Shift+K | paragraph.codeFences once | none in table |  |
| macos | W | paragraph.decreaseHeading | Cmd+- | Cmd+Option+[ | paragraph.decreaseHeading once | none in table |  |
| macos | S | paragraph.decreaseHeading | Cmd+- | Cmd+Option+[ | paragraph.decreaseHeading once | none in table |  |
| windows | W | paragraph.decreaseHeading | Cmd+- | Cmd+Option+[ | paragraph.decreaseHeading once | none in table |  |
| windows | S | paragraph.decreaseHeading | Cmd+- | Cmd+Option+[ | paragraph.decreaseHeading once | none in table |  |
| macos | W | paragraph.increaseHeading | Cmd+= | Cmd+Option+] | paragraph.increaseHeading once | none in table |  |
| macos | S | paragraph.increaseHeading | Cmd+= | Cmd+Option+] | paragraph.increaseHeading once | none in table |  |
| windows | W | paragraph.increaseHeading | Cmd+= | Cmd+Option+] | paragraph.increaseHeading once | none in table |  |
| windows | S | paragraph.increaseHeading | Cmd+= | Cmd+Option+] | paragraph.increaseHeading once | none in table |  |
| macos | W | paragraph.mathBlock | Cmd+Option+B | Cmd+Option+Shift+M | inert | none in table |  |
| macos | S | paragraph.mathBlock | Cmd+Option+B | Cmd+Option+Shift+M | paragraph.mathBlock once | none in table |  |
| windows | W | paragraph.mathBlock | Cmd+Option+B | Cmd+Option+Shift+M | inert | none in table |  |
| windows | S | paragraph.mathBlock | Cmd+Option+B | Cmd+Option+Shift+M | paragraph.mathBlock once | none in table |  |
| windows | W | paragraph.orderedList | Cmd+Option+O | Cmd+Shift+[ | paragraph.orderedList once | none in table |  |
| windows | S | paragraph.orderedList | Cmd+Option+O | Cmd+Shift+[ | paragraph.orderedList once | none in table |  |
| macos | W | paragraph.paragraph | Cmd+0 | Cmd+Shift+0 | paragraph.paragraph once | none in table |  |
| macos | S | paragraph.paragraph | Cmd+0 | Cmd+Shift+0 | paragraph.paragraph once | none in table |  |
| windows | W | paragraph.paragraph | Cmd+0 | Cmd+Shift+0 | paragraph.paragraph once | none in table |  |
| windows | S | paragraph.paragraph | Cmd+0 | Cmd+Shift+0 | paragraph.paragraph once | none in table |  |
| macos | W | paragraph.quote | Cmd+Option+Q | Cmd+Shift+B | paragraph.quote once | none in table |  |
| macos | S | paragraph.quote | Cmd+Option+Q | Cmd+Shift+B | paragraph.quote once | none in table |  |
| windows | W | paragraph.quote | Cmd+Option+Q | Cmd+Shift+Q | paragraph.quote once | none in table |  |
| windows | S | paragraph.quote | Cmd+Option+Q | Cmd+Shift+Q | paragraph.quote once | none in table |  |
| macos | W | paragraph.table | Cmd+Option+T | Cmd+Shift+T | paragraph.table once | none in table |  |
| macos | S | paragraph.table | Cmd+Option+T | Cmd+Shift+T | inert | none in table |  |
| windows | W | paragraph.table | Cmd+Option+T | Cmd+Shift+T | paragraph.table once | none in table |  |
| windows | S | paragraph.table | Cmd+Option+T | Cmd+Shift+T | inert | none in table |  |
| windows | W | paragraph.unorderedList | Cmd+Option+U | Cmd+Shift+] | paragraph.unorderedList once | none in table |  |
| windows | S | paragraph.unorderedList | Cmd+Option+U | Cmd+Shift+] | paragraph.unorderedList once | none in table |  |
| windows | W | view.source | Ctrl+2 | <unassigned> | inert | paragraph.heading2 |  |
| windows | S | view.source | Ctrl+2 | <unassigned> | inert | paragraph.heading2 |  |
| macos | W | view.switchDocuments | Cmd+` | Ctrl+Tab | inert | none in table |  |
| macos | S | view.switchDocuments | Cmd+` | Ctrl+Tab | inert | none in table |  |
| windows | W | view.switchDocuments | Cmd+` | Cmd+Tab | inert | none in table |  |
| windows | S | view.switchDocuments | Cmd+` | Cmd+Tab | inert | none in table |  |
| macos | W | view.toggleFullscreen | Cmd+Option+F | <system> | inert | none in table |  |
| macos | S | view.toggleFullscreen | Cmd+Option+F | <system> | inert | none in table |  |
| windows | W | view.toggleFullscreen | Cmd+Option+F | F11 | inert | none in table |  |
| windows | S | view.toggleFullscreen | Cmd+Option+F | F11 | inert | none in table |  |
| windows | W | view.wysiwyg | Ctrl+4 | <unassigned> | inert | paragraph.heading4 |  |
| windows | S | view.wysiwyg | Ctrl+4 | <unassigned> | inert | paragraph.heading4 |  |
| macos | W | window.closeWindow | Cmd+W | — | inert | file.close |  |
| macos | S | window.closeWindow | Cmd+W | — | inert | file.close |  |

Rows: 74. Native menu checks and AltGr checks are in the M1b brief § AC-2/3; this table is the per-chord input for § 6.1.
