# 0106. Five control colours are accepted below the A9 contrast line

**Status**: Accepted (2026-10-15). The user decided on
`prototype/p-wi35-a9-controls`, relayed by mdpro-delegator:

- For the shortcut value edge and the Insert Table grid edge:
  「Accept as exception」, twice.
- For the toggle and the danger label: 「Q1-Q3 我也重新选择了，看看Prototype我的选择」.
  The final picks on the prototype were:
  - input borders 「A: text 50% both」;
  - toggle off 「Accept (today: #ccc)」;
  - danger hover 「Accept (today)」.

## Context

A9 (plan P decisions; WCAG 2.1 AA) asks for 4.5:1 for text and 3:1 for
control boundaries and focus indicators. Plan P WI-3.5a measured the Stage 3
contrast table from the real tokens and rules
([evidence](../test/20261015-plan-p-stage3-evidence.md)). It found three
controls below the line, all failing before Stage 3 too. They were registered
as D227:

- form-control edges on `--color-border`;
- the Settings toggle's `#ccc` off-track and the white knob on it;
- the light danger ("Remove") label when hovered.

The user first chose a fix for each (verdict `b7e5c06`), and all three landed
in `d64f291`, which added the tokens `--color-control-border`,
`--color-control-off` and `--color-danger-text`.

The mini audit of that branch (b145) then reported two more control edges
still on the hairline `--color-border`. Both were outside D227's ruled scope:

- the Settings › Keyboard Shortcuts value boxes (`.shortcut-value`);
- the Insert Table grid-picker cells (`.grid-picker-cell`).

The user asked to see all of them on the prototype. They re-chose there,
keeping the input-border fix and taking "Accept" for the other four. The
relayed message gives the picks but no reason.

## Options considered

Ratios are light / dark. An edge counts as its lower ratio, against the
surface around the control or against the control's own fill.

- **Toggle off-track (Q2)**:
  - **accept `#ccc` (chosen)**;
  - text 50% into the panel, both themes;
  - light 55% / dark 45% (the first verdict; track 3.89 / 3.86, knob
    3.89 / 4.61, landed and now reverted).
- **Danger label hovered (Q3)**:
  - **accept (chosen)**;
  - `--color-danger-text`, light danger 80% mixed with text (the first
    verdict; rest 6.05, hovered 5.04, landed and now reverted);
  - a lighter `--color-danger-soft` hover fill (8%), which still left the
    light hovered label at 4.00:1, below 4.5.
- **Shortcut value edge (Q4)**:
  - **accept (chosen)**;
  - `--color-control-border` (3.18 / 4.43).
- **Grid-picker cell edge (Q5)**:
  - **accept (chosen)**;
  - `--color-control-border` 50% (3.34 / 4.25);
  - the lightest passing edge, light 48% / dark 40% (3.15 / 3.12), which
    would have needed its own token.

Every losing option but the 8% hover fill reached the target, at the cost of
a visibly heavier or darker control. For the grid, that meant 100 squares outlined at mid-grey. The
user preferred the look of today's controls.

## Decision

The five pairs below keep their current colours as accepted A9 exceptions.
`d64f291`'s toggle and danger changes are reverted (D227-WI-3), and the two
tokens they added are removed. The input-border fix
(`--color-control-border` on 8 control rules) stays.

`tests/contrast-stage3.test.ts` pins the first three pairs at their measured
ratios (`ACCEPTED`), so changing one fails the unit lane and has to be
re-ruled. The two edges are not in that table; DESIGN.md § Tokens, rule 31
and the [D227 row](../plans/20260912-frontend-backend-sequencing-order.md#d227)
list all five.

## Consequences

mdpro does not meet WCAG 2.1 AA on these controls:

| Pair | Criterion | Light | Dark | Needs |
|---|---|---|---|---|
| Toggle off-track against the panel | 1.4.11 Non-text Contrast | 1.61 | 11.06 (passes) | 3:1 |
| White knob on the off-track | 1.4.11 | 1.61 | 1.61 | 3:1 |
| Danger label hovered, on its pink fill | 1.4.3 Contrast (Minimum), text | 3.76 | 4.81 (passes) | 4.5:1 |
| Keyboard Shortcuts value edge | 1.4.11 | 1.17 | 1.31 | 3:1 |
| Insert Table grid-picker cell edge | 1.4.11 | 1.22 | 1.25 | 3:1 |

- **Toggle and knob.** For a low-vision user, a switched-off toggle can read as
  a gap in the row. Its state is still carried by the knob's position and the
  row label.
- **Danger label.** The light label passes at rest only narrowly (4.51:1), so
  a later retune of `--color-danger` or the surface would cross the line
  first.
- **Shortcut values.** Their mono text and column place them, but nothing
  else shows that they are clickable.
- **Grid picker.** Its fill matches the dialog, so an unhighlighted cell is
  visible only by its 1.22:1 edge. The numeric "or specify" fields are an
  alternative path, but WCAG grants no exemption for that.
- **The toggle stays a hex literal.** Tokenizing `#ccc` returns to WI-4.4
  (Stage 4 deferred list back to 15). WI-4.4 may tokenize it at the same
  colour, but must not change it without a new ruling.
- **Prior art.** Any future claim that mdpro meets WCAG 2.1 AA has to cite this
  record's exceptions. A later accessibility pass that reopens one supersedes
  this ADR for that pair. The prototype branch keeps every option, with live
  ratios, as the starting point.
