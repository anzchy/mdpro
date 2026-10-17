# Google DESIGN.md: how it organises a design system, and how it keeps it true

Sources read (via `gh api`, HEAD on 2026-10-17): `docs/spec.md` (418 lines, "version: alpha"), `PHILOSOPHY.md`, `README.md`, `examples/*/DESIGN.md` + `README.md`, `packages/cli/src/linter/spec-config.yaml`, `.../linter/rules/orphaned-tokens.ts`, `.../model/color-parser.ts`, `.../commands/diff.ts`, `.../parser/handler.ts`. Local: `~/.claude/plugins/cache/google-labs-code-stitch-skills/stitch-design/1.0.0/skills/extract-design-md/SKILL.md` (365 lines) and `examples/DESIGN.md` (209 lines). **Not fetched:** the stitch.withgoogle.com spec page (the repo's `docs/spec.md` is generated and declared canonical, so I relied on it).

## 1. The format

- **Two layers in one file** (`docs/spec.md`): YAML tokens + markdown prose. Tokens either in front matter (`---` fences) or, since commit #178 (2026-10-16), in interleaved ```` ```yaml ```` blocks inside each section; all blocks merge into one tree, and a top-level key defined twice is an error.
- **Schema**: `version` (opt, "alpha"), `name`, `description` (opt), `omitted` (opt, list of `section` or `{section, reason}` to silence missing-section warnings), `colors: <name>: Color`, `typography: <name>: {fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, fontFeature, fontVariation}`, `rounded: <level>: Dimension`, `spacing: <level>: Dimension|number`, `components: <name>: {backgroundColor, textColor, typography, rounded, padding, size, height, width}`. Dimensions are px/em/rem only. References are `{colors.primary}`; component variants are sibling keys (`button-primary-hover`). Only `primary` is "must".
- **Sections** (all `##`, all optional, but ordered): Overview (alias Brand & Style), Colors, Typography, Layout (alias Layout & Spacing), Elevation & Depth, Shapes, Components, Do's and Don'ts. Unknown sections are preserved, unknown keys accepted (`spec.md` § Consumer Behavior); duplicate sections reject the file.
- **Prose vs data**: spec says "tokens are the normative values; the prose provides context". `PHILOSOPHY.md` is softer: "The prose is where the design lives… token values serve as context and are not rendering instructions." Prose may cite tokens inline as `{colors.paper}`.
- **No theme variants.** There is no dark-mode or multi-theme construct anywhere in spec, schema or linter (grep for dark/theme/mode in the repo: none outside prose). `atmospheric-glass` is simply a dark-only palette.

## 2. Philosophy

- Audience: coding agents first ("A format specification for describing a visual identity to coding agents", `README.md`), humans second ("both humans and AI can understand and refine", `spec.md`).
- Belongs in it: intent, a *specific reference* ("a 1970s graduate lecture handout") over adjectives ("Adjectives describe a region. A specific reference describes a point"), a short intentional Don'ts list ("a long rambling list is often a sign the description was too vague"). Not in it: rendering rules or token requirements ("we do not accept or recommend token requirements"); the spec deliberately defers to CSS/DTCG/Tailwind. Motion, iconography etc. are user-defined extensions.

## 3. Truth-keeping

- **Linter**: `npx @google/design.md lint` with 11 rules (`README.md`): `broken-ref` (error), `contrast-ratio` (WCAG AA on component bg/text pairs), `orphaned-tokens` (MD3 families exempt, `orphaned-tokens.ts`), `section-order`, `unknown-key` (Levenshtein typo check), `token-like-ignored`, `missing-primary/typography/sections`, `omitted-rules`, `token-summary`. JSON output, exit 1 on errors.
- **Diff**: `design.md diff before after` reports added/removed/modified tokens per group, and `regression: true` (exit 1) if errors *or warnings* rose (`diff.ts`). It does not diff prose.
- **Schema**: zod model (`model/spec.ts`); the spec itself is generated from `spec-config.yaml` + `spec.mdx` ("Do not edit directly. Run `bun run spec:gen`"). No published JSON Schema file found.
- **Generation path is outward only**: `export --format json-tailwind|css-tailwind|dtcg`. Each example ships a derived `tailwind.config.js` and `design_tokens.json`. Nothing generates DESIGN.md *from* code; the Stitch skill does that by LLM extraction (read CSS vars, Tailwind config, theme files; "Theme files are higher-signal than component styles"), with a manual quality checklist, no lint step.
- **Derived colours**: `color-mix(in srgb, c1 p%, c2 p%)` is parsed and resolved for contrast (`color-parser.ts` l.194; other spaces return null). It needs literal colours; `var(--x)` operands are not resolvable (inferred from parser, not tested).
- **Multiple files**: none. One file per system; `diff` compares two versions.

## 4. Worked examples

`examples/{atmospheric-glass,paws-and-paths,totality-festival}/`: each = `DESIGN.md` (210/219/210 lines), `README.md` (11 lines), `design_tokens.json`, `tailwind.config.js`. Roughly two-thirds YAML front matter (ends at lines 142/157/146: ~50 MD3-style colours, ~6 type levels, rounded, spacing, ~10 components), then ~65 lines of prose in canonical section order, each section 3-6 bullets; Components split into `###` per family. The Stitch local example (Alpine Peak) follows the same shape. Note: the Stitch SKILL template still prescribes an older numbered layout (`## 1. Visual Theme & Atmosphere` … `## 6. Design System Notes for Stitch Generation`) that contradicts its own example and the spec order.

## 5. Versioning and updates

Format version is a single `version: alpha` key; npm package 0.4.0 (2026-07-27). No guidance on per-product versioning or change logs. The update mechanism is: edit the file, run `lint`, run `diff` against the old version in CI and fail on new warnings. No decisions log, no ADR concept.

## 6. Practices for mdpro

**Worth copying**

1. **Fixed, linted section order with aliases.** mdpro's `docs/design/mdpro-ui-new/DESIGN.md` has 17 `##` sections in ad-hoc order. Adopt a canonical order (Overview/Product, Aesthetic register, Tokens, Layout, Components, States, Focus, Theme, Motion, Don'ts) and a test asserting it, alongside the existing test that reads `## Tokens`/`## Layout`. Keeping both headings is compatible: unknown sections are preserved by the spec.
2. **`broken-ref` + `orphaned-tokens` as a CI check, against the CSS instead of YAML.** A script that parses § Tokens names and `globals.css`/`themes/*.css` custom properties and fails on (a) a doc name absent from CSS, (b) a CSS token absent from the doc. This is the lint without copying values, and is the natural core of the "generated, CI-checked page" being considered.
3. **Contrast checking with color-mix resolution.** Google resolves `color-mix(in srgb …)`. mdpro could resolve its own formulas per theme (substituting `var()` from `light.css`/`dark.css`) and fail on text/bg pairs under 4.5:1, which D256/D257 just fixed by hand.
4. **`omitted` with reasons → "deliberately don't do" as data.** Make each entry in "What we deliberately don't do" carry a one-line reason (and ADR link), and keep it short per PHILOSOPHY's "intentional list" advice; long lists signal a vague reference.
5. **Specific reference over adjectives, plus inline token citations in prose.** Make "The memorable thing" a concrete reference object, and cite tokens in component contracts as `` `--token-name` `` consistently so the CI check in (2) can also verify prose references (Google's `{colors.x}` idea, minus values).

**Would NOT fit**

1. **YAML front matter with values.** Directly conflicts with the no-copied-values rule: Google's model is that the doc *is* the source and code is exported from it; mdpro's source is CSS. It also has no theme dimension, so light/dark would need two token trees or invented keys, and mdpro's `color-mix(… var(--base) …)` formulas cannot be expressed as resolvable literal values. A names-only front matter (role, no value) would not conflict but gives little over § Tokens.
2. **Single self-contained file / dropping the decisions log.** Google has no place for decisions, open questions or frozen targets; mdpro's ADRs, `proposal-ab.html` and prototypes have no analogue. Better: move the Decisions log and Open questions out to ADRs/plans and link them, rather than adopt Google's "one file is everything" shape. (Also, the MD3 colour-role naming that the orphan rule assumes does not match mdpro's names.)
