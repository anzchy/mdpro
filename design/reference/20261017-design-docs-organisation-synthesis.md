# How to organise mdpro's design materials: what three big-tech systems teach

Sources: [`20261017-study-meta-astryx.md`](20261017-study-meta-astryx.md), [`20261017-study-google-design-md.md`](20261017-study-google-design-md.md) and [`20261017-study-openai-apps-sdk-ui.md`](20261017-study-openai-apps-sdk-ui.md), plus the Codex consult in [`20261017-codex-token-values-consult.md`](20261017-codex-token-values-consult.md) (thread `01a1483e-4882-7970-b3c1-f4156227fa8e`). I checked one key claim from each source against its repo, on 2026-10-17:

- **Astryx:** `scripts/generate-token-docs.mjs --check` runs inside `check:repo`.
- **OpenAI:** the hand-copied Storybook table has dark `color-text-success: var(--red-400)`, while the CSS says `var(--green-400)`.
- **Google:** a lint CLI with rules for section order, broken references and contrast. This one is from the report; I didn't run it.

## What the three agree on

1. **Values come from code, never from a hand-typed copy.** OpenAI is the warning: its hand-copied token table has drifted from its own CSS, and a success colour shows as red in dark mode. Astryx is the model: it generates token docs from source, and CI fails on drift. Your rule 31 was right about copies. What it doesn't yet have is the generated alternative.
2. **Separate the document types.** All three keep the rules (guidelines), the facts (reference) and the reasons (decisions) apart. OpenAI's guidelines page holds no values and links to the reference. Astryx keeps maintainer records apart from consumer docs.
3. **Each document has a fixed shape that is checked.** Google lints section order. Astryx validates every record against a template and schema.
4. **Every "don't" carries its reason**, and the doc uses concrete references, not adjectives (Google).
5. **Every record says whether it is current.** In Astryx, only `current` records govern.

## What doesn't fit mdpro

- **Living, rewritable decision records (Astryx).** Your accepted ADRs are immutable, and that is the stronger choice for a decision log.
- **YAML values at the top of DESIGN.md (Google).** It's a copy, so it breaks rule 31.
- **`light-dark()` (OpenAI).** Your DESIGN.md rules it out explicitly ("No … `light-dark()`").
- **Multi-owner approval gates and a Storybook monorepo (Astryx, OpenAI).** They are oversized for a single-app repo.

## Proposed layout for docs/design/mdpro-ui-new/

| File | Diátaxis type | Holds | Source |
|---|---|---|---|
| `DESIGN.md` | Explanation and reference (the entry) | A summary up front, then product context, the "memorable thing", the aesthetic register, and component contracts, states, focus, theme and motion. **§ Tokens and § Layout keep their headings** (tests read them). | trimmed from today's file |
| `tokens.md` | Reference, **generated** | Name, `:root` value, light value, dark value as written in the CSS (no computed hex), the line that declares it, and the role taken from DESIGN.md § Tokens. A check fails CI when it's stale. | Astryx and Codex |
| `decisions.md` | Explanation | What we deliberately don't do (each item with its reason), what other editors get wrong, the rule changes this design needs, and the decisions log. Each decision links to its ADR. | Google, Astryx |
| `prototypes/README.md` | Reference | One row per prototype: the question it answered, its options, your verdict (quoted), the D or WI it fed, whether it has shipped, and its branch. | Astryx |
| `archive/` (or a status line) | — | `proposal-ab.html` and the two Codex reviews, each marked frozen with its date. | Astryx `authority: archived` |

## Order of work

1. **Docs only, now (waiting on the delegator):**
   - Add the summary up front.
   - Move the decisions material to `decisions.md`.
   - Add `prototypes/README.md`.
   - Add the missing D231 rows to § Tokens.
   - Fix the root index's "not committed" claim.
   - Then run `tests/design-tokens-redesign.test.ts` and `tests/contrast-stage3.test.ts` locally. CI skips them on a change that touches only docs.
2. **A work item, later.** It needs an ADR amending rule 31, an implementation grant and tests:
   - a `tokens.md` generator with a `--check` mode, wired into CI so that changes to either `src/styles/` or `docs/design/` trigger it;
   - a lint on the shape of `DESIGN.md`: section order, and § Tokens names matched to the CSS in both directions.
3. **Code fixes, separately:** the C1–C9 drift items from [`20261017-css-drift-report.md`](20261017-css-drift-report.md).
