# design/

Everything about how mdpro looks and behaves on screen. Start with
`DESIGN.md`; open `mockup.html` to see it.

## What is here, and which file wins

| Path | What it is | Status |
|---|---|---|
| [`DESIGN.md`](DESIGN.md) | The target design: product context, register, token names and roles, component contracts, states, focus, theme, motion, decisions log | **Governs.** Every UI decision cites it. `.claude/rules/30-34` win any conflict with it |
| [`mockup.html`](mockup.html) | The whole window as it is now: thirteen scenes, light and dark, plus one target scene (S14, the chosen find / replace bar), and the user journeys that walk through them | **Current**, as a picture. Drawn with the app's own CSS from `src/`, so its styling cannot drift; its markup is copied from the components and is re-checked when they change |
| [`prototypes/`](prototypes/README.md) | One page per design question put to the user, numbered in the order they were asked | **Evidence.** The verdict is the decision; the page is how it was reached |
| [`reviews/`](reviews/) | Outside reviews of the design, dated | **Frozen.** Read for the reasoning, not for rules |
| [`archive/`](archive/) | Superseded material, dated | **Frozen.** Never follow it for new work |
| [`reference/`](reference/) | Research that fed the design: studies, extracts, consults, dated | **Input.** It informs decisions; it never makes them |

Token **values** are not here. They live only in `src/styles/globals.css`
and `src/styles/themes/{light,dark}.css` (rule 31).

## Naming

- **Entry points keep fixed names**: `README.md`, `DESIGN.md`, `mockup.html`.
  Tests, rules and `CLAUDE.md` find them by name.
- **Prototypes** are `NNN-<id>-<slug>.html`: a three-digit number in the
  order the question was asked, then the D, WI or ADR id it decided. A number
  is never reused or renumbered. A prototype that lives only on its
  `prototype/*` branch keeps its number in the registry and has no file here.
- **Reviews, archive and reference** are `YYYYMMDD-<slug>`: the date the
  material was written or frozen. The date orders them, and it tells a reader
  how old the thinking is.

## Archive

| Path | Frozen | Why it is kept |
|---|---|---|
| [`archive/20260911-proposal-ab.html`](archive/20260911-proposal-ab.html) | 2026-09-11 | The rendered A+B proposal. `DESIGN.md`'s "proposal :N" citations point at its lines |
| [`archive/20260920-mdpro-ui-old/`](archive/20260920-mdpro-ui-old/DESIGN.md) | 2026-09-20 | The UI as shipped before the redesign, with its canvas boards. Rule 31 still logs non-redesign tokens in its `DESIGN.md` until plan P WI-5.5 retires it |
