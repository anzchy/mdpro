# Prototypes

Each design question that went to the user as a clickable prototype (rule 70),
numbered in the order it was asked. The verdict is quoted as the user gave it.
"Branch" means the page lives only on that `prototype/*` branch, which never
lands on `master`; check it out to open it.

| # | Question | Verdict | Decided | Where it is |
|---|---|---|---|---|
| 001 | Sidebar toggle and a resizable sidebar | Recorded in [ADR-0088](../../docs/adr/0088-the-sidebar-keeps-its-width-is-resizable-and-is-toggled-by-one-fixed-button.md) | ADR-0088 | [`001-adr0088-sidebar-toggle.html`](001-adr0088-sidebar-toggle.html) |
| 002 | Contrast of accent text and the primary button | Light 「A: derived accent text (Recommended)」, dark 「B: deeper fill, white text」 | D222 | branch `prototype/d222-contrast` |
| 003 | Sidebar resize handle: hit area, focus, hover line | 「Inside edge, 8 px (Recommended)」, 「Outline frame (Recommended)」; hover line 「Muted grey (Recommended)」 | D189 | branch `prototype/d189-sidebar-handle` |
| 004 | Remove the sidebar's Table of Contents and mode labels | 「B: remove everywhere (Recommended)」 | D223 | branch `prototype/d223-sidebar-labels` |
| 005 | Table-menu hint opacity on hovered and active items | 「0.95 (Recommended)」 | P-WI-3.3h | branch `prototype/p-wi33-table-hint` |
| 006 | About page on Windows and Linux | 「A: coming soon (Recommended)」 | D224 | branch `prototype/d224-about-offmac` |
| 007 | Form-control edges below the A9 contrast line | Input borders: text at 50 %; the toggle off-track, the danger hover and two edges accepted as exceptions ([ADR-0106](../../docs/adr/0106-five-control-colours-are-accepted-below-the-a9-contrast-line.md)) | P-WI-3.5a, D227 | branch `prototype/p-wi35-a9-controls` |
| 008 | Active-tab fill, and the focus ring of D234 | 「1. 6c OK」, 「D234:a」 | D231, D234 | branch `prototype/d231-d234-focus` |
| 009 | Stepper focus rings | a2, inset rings on − and + | D244 | branch `prototype/d244-stepper-focus` |
| 010 | Source marker chip size, and the code background | S1 (a) 12 px; S2 the review's derived formula ([ADR-0110](../../docs/adr/0110-code-surfaces-take-the-neutral-derived-background.md)) | STOP 3 | branch `prototype/stop3-s1-marker-chips` |
| 011 | Settings rail icons, without the footer Close | D: VMark-style outline rail | D260 | [`011-d260-settings-rail.html`](011-d260-settings-rail.html) |
| 012 | Menu reorganisation | A: the plan's trees as written, disabled items greyed | Menu plan M1 | [`012-menu-ui.html`](012-menu-ui.html) |
| 013 | Highlight in dark, and the Settings error text | 「B · fainter dark pink (Recommended)」, 「B1 · darker red, dark unchanged (Recommended)」 | D256, D257 | branch `prototype/d256-d257-contrast` |

Whether a decision has shipped is tracked in its row in
[`docs/plans/20260912-frontend-backend-sequencing-order.md`](../../docs/plans/20260912-frontend-backend-sequencing-order.md),
not here.

**Adding one:** take the next number, name the file
`NNN-<id>-<slug>.html` (or leave it on its `prototype/<id>-<slug>` branch),
and add its row when the user's verdict is in.
