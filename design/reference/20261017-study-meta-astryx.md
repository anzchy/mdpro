# Astryx (facebook/astryx): how it organises design materials

Read via `gh api` on `main`, 2026-10-17. Full tree saved beside this file as `astryx-tree.txt` (8,349 paths). The docs site (astryx.atmeta.com) was not fetched.

## 1. Information architecture

`docs/README.md` ("Astryx knowledge map") says `docs/` is **maintainer knowledge**. Consumer docs live elsewhere: in each component's `{Name}.doc.mjs` and in `packages/cli/assets/docs/`, which the `astryx docs` CLI serves.

| Folder | Holds | Diátaxis |
|---|---|---|
| `architecture/` (19 files, e.g. `theme-tokens.md`) | "the shipped system, its boundaries, and invariants" (INV1…) | Reference + explanation |
| `design/` (15, e.g. `motion.md`, `user-states.md`, `system-states.md`) | "human-owned visual and interaction specifications" (DR1…) | Reference (normative) |
| `families/` (`buttons.md`, `overlay-dismissal.md`…) | contracts shared by sibling components | Reference |
| `specs/AST-NNN[-slug]/spec.md` (~55) | consequential system changes and their decisions | Explanation (decision records) |
| `contributing/` (`spec-writing.md`, `pull-requests.md`, `api-conventions.md`) | contributor workflows that "project current owner records without replacing them" | How-to |
| `themes/README.md` | index only; theme records sit in `packages/themes/<t>/<t>.spec.md` | Index |
| `templates/knowledge/` (8 templates + `versions.json`) | authoring forms. "Templates never live among records." | — |
| `schemas/knowledge/v1–v4.json` | versioned structural schemas | — |
| `pr-assets/<PR#>/` | screenshots attached to PRs (40 files) | Evidence, not authority |
| `release.md` | npm trusted-publishing mechanics | How-to |

There are no tutorials in `docs/`. Consumer tutorials and how-tos are in the CLI docs tree. Topic records use kebab-case names with no numbers. Only specs are numbered (`AST-NNN`), and the numbers have gaps (007, 014–016, 019… are missing). Later folders add a slug (`AST-066-theme-data-boundary`), earlier ones do not (`AST-001`). Every record carries a typed id in its frontmatter (`spec:AST-001`, `design:<surface>`, `architecture:theme-tokens`, `component:Banner`, `module:<Parent>/<Name>`), and records link to each other by id, not by path.

## 2. Tokens

- **Source of truth**: `packages/core/src/theme/tokens.stylex.ts`. Each family has paired `*Defaults` and `*Vars` exports built with `stylex.defineVars`. Domain tokens are in `dataTokens.stylex.ts` and `syntax/tokens.ts`. Each theme package overrides them (`packages/themes/neutral/src/neutralTheme.ts`, plus `palette.config.json` and generated `neutralPalettes.generated.ts` with a `.generated.receipt.json`).
- **Token docs are generated.** `scripts/generate-token-docs.mjs` writes `packages/cli/assets/docs/tree/tokens-<category>.doc.mjs` from the sources, plus one hand-written usage guide. The docsite renders tables from them (`apps/docsite/src/components/tokens/*TokenTable.tsx`).
- **Staying in sync**: `--check` mode "fails on drift". `package.json` wires `check:token-docs`, `check:data-tokens`, `check:neutral-palette-refs`, `check:knowledge` and a dozen other checks into `check:repo`, which runs inside `pnpm lint`. CI (`.github/workflows/ci.yml`) also runs `node scripts/check-knowledge.mjs` as "Validate spec records".
- `docs/architecture/theme-tokens.md` states the rule as INV1: "`defineVars` declarations are canonical … projections do not introduce names". Its frontmatter lists `applies_to` (the source files) and `verified_by` (the tests and the generator). That is how a prose record points at the code and checks that keep it true.

## 3. Decisions (AST-NNN specs)

- **Template**: `docs/templates/knowledge/system-spec.md`. Frontmatter: `schema_version`, `template_version`, `kind`, `id`, `authority`, `archive_reason`, `superseded_by`, `approved_by`, `approved_at`, `phase`, `owners`, `affects_*`. Sections: Intent → Non-goals → Requirements (FR1…, MUST) → Platform support → Current-state impact → Verification table (contract / test / states / mutation expectation) → Decision log (`DEC-n`, with `Reference: spec:AST-000/DEC-1`, `Decider: person, date`, and a single `Rejected:` line) → Open questions (`OQ1`, tagged `checkable | human-design | human-api`).
- **Two status axes.** `authority: draft | current | archived` decides whether a record governs: "Only `current` records govern … Never infer approval from merged code, silence". `phase: proposed | accepted | implementing | shipped | withdrawn` tracks delivery.
- **Promotion**: an owner's approval is recorded in `approved_by` and `approved_at`. A `spec-owner-gate.yml` workflow requires an exact-head approval from `.github/ENGOWNERS` or `DESIGNOWNERS`. Self-approval is the comment `/approve-spec <sha>`, and any new commit invalidates it.
- **Superseding**: a record is set to `archived` with `archive_reason: superseded | withdrawn | historical` and `superseded_by: <id>`. Records are **living documents**, rewritten in the present tense (`spec-writing.md` rubric R1–R6: no narration, no research, no PR numbers, one-line rejected alternatives). This is the opposite of an immutable ADR. *Not verified:* every spec header I sampled (001, 002, 003, 005, 010, 020, 030, 066) is `current`, and I found no archived record.
- Changing a template's shape bumps its schema version and migrates every active record. Published schema files are immutable.

## 4. Components

Everything for a component sits in one directory, e.g. `packages/core/src/Banner/` and `packages/core/src/Selector/`:

- `Banner.tsx` (code)
- `Banner.doc.mjs` (typed `ComponentDoc` consumer doc: props, examples)
- `Banner.spec.md` (contract record; frontmatter links `families`, `design_specs`, `architecture`, `system_specs`, `verified_by`)
- `Banner.test.tsx`
- `__tests__/*.a11y.*` (states, known failures, Chromium spec)
- local tokens in `*.stylex.ts` (e.g. `DateInput/tokens.stylex.ts`)

Stories are the exception: they are centralised in `apps/storybook/stories/<Name>.stories.tsx`. Visual baselines are in `.github/visual-baseline/shots/` (425 PNGs, each named per theme and mode). Design specs never copy rationale. Component contracts link to it instead: "`component:X/FR1` implements `design:<surface>/DR1`".

## 5. Agent-facing docs

`CLAUDE.md` is three lines: read `AGENTS.md`, which is "the canonical, tool-agnostic instruction surface", plus the nearest nested `AGENTS.md`. `AGENTS.md` covers the following:

- Routing by audience.
- Authority: only `current` records govern.
- Search before creating: "extend the existing canonical owner by default".
- The rubric results go in every record PR.
- `pnpm check:knowledge` after edits.
- An ask-a-human boundary: ask only about API, theme contract, ownership or subjective visuals, one question at a time.
- A generated block (`<!-- ASTRYX-CLI:START -->`) that tells agents to bootstrap with `astryx docs tokens --dense`, and similar commands, rather than reading files.
- `/vibe-test`, which measures how well `AGENTS.md` steers an LLM.

## 6. Prototypes, templates, deprecations, changelog, versioning

- **Prototypes**: no prototype folder in `docs/`. Exploratory UI lives in `apps/sandbox` (e.g. `motion-lab/proposed/`) and `apps/template-viewer`. `docs/pr-assets/<PR#>/` holds PR screenshots, which are explicitly not authority.
- **Normative design images** belong in `docs/design/assets/<design-id>/`, each with alt text, state, theme, viewport and the decision it shows. *Not verified:* the folder does not exist yet in the tree.
- **Deprecations** are inline `DEP-NNNN` tables in the component spec, paired with `CLN-NNNN` cleanups (`Banner.spec.md`: surface, old contract, replacement, codemod, state, target plan). Codemods are in `packages/cli/assets/codemods/`, run by `astryx upgrade`.
- **Changelog**: one Changesets file per change in `.changeset/*.md` with a `[feat]`-style tag. `check-changesets.mjs` enforces the format, and per-package `CHANGELOG.md` files are generated at release. Versioning is a fixed group from a frozen `release/vX.Y.Z` branch (`docs/release.md`).

## 7. Worth copying, and what to leave

1. **Token docs as a generated projection with a `--check` drift gate.** For mdpro: generate the § Tokens table of `docs/design/mdpro-ui-new/DESIGN.md` (names, roles, and optionally the light/dark values) from `src/styles/globals.css` and `themes/{light,dark}.css`, between markers, and add a `design:check` to the gate. The "never copy values" rule then becomes "values are copied only by the generator". The `## Tokens` and `## Layout` headings stay, so existing tests still pass.
2. **Split by kind and owner, with typed ids and cross-links.** Break the ~900-line DESIGN.md into `design/` records (states, focus, theme, motion), `components/<name>.md` contracts, and a product-context page, with DESIGN.md as a short entry point. Use ids like `design:focus/DR2` that rules 30–34 and tests can cite.
3. **`applies_to` / `verified_by` frontmatter.** Each design record names the CSS and TSX files it governs and the tests that prove it. `ledger:check` already resolves path claims, so it could resolve these too. This also makes test coverage of a design rule visible.
4. **A frozen template per record kind, plus a schema check.** A `docs/templates/` component-contract template (Intent, Anatomy, State table, Focus, Verification, Open questions) and a design-record template. A small check enforces the required headings, generalising the current hard-coded "## Tokens must exist" test.
5. **Visual references with metadata and an index.** Give `docs/design/mdpro-ui-new/prototypes/` a README index (question, options, verdict, ADR link, status `open/decided/discarded`). Move the normative images to `assets/<record>/` with state, theme and viewport. Mark `proposal-ab.html` explicitly as frozen evidence, not authority.

Would **not** fit:

- **Living, rewritable decision records** (`authority` and `archived` on a mutable spec, rubric R1 banning history). These conflict with mdpro's immutable Nygard ADRs, which the project chose deliberately so it can see why a decision looked right. Keep the ADRs. Borrow only the `Decider` and `Rejected:` discipline, and drop DESIGN.md's decisions log in favour of ADR links.
- **Exact-head owner-approval gates, ENGOWNERS/DESIGNOWNERS and `/approve-spec`.** These are built for a multi-team public repo. mdpro has one human approver and already has the delegator, two audits and ci-gate. Adding them is ceremony with no second owner to coordinate.
