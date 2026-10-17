---
description: Review a UI diff against mdpro's design (design/DESIGN.md, rules 30–34). Anything about how the UI renders needs a screenshot or a running app before it passes.
argument-hint: "[optional: base ref, default master] [optional: screenshot paths]"
---

# mdpro design review

Audit the current UI diff against mdpro's design. **Report only; don't fix.**
The owner of the diff fixes it. A finding that is a visual choice (a colour,
a size, a layout) goes to the user as a `/mattpocock-skills:prototype`, never
as prose (rule 70).

Modelled on claudepot-app's `/design-review`
([`design/reference/20261017-xiaolai-vmark-claudepot-design-org.md`](../../design/reference/20261017-xiaolai-vmark-claudepot-design-org.md)).
Not the global gstack `design-review` skill, which is a general visual QA
that also edits code.

## Step 1 · Find the UI files that changed

Base is `$1` if given, else `master`.

```bash
git diff --no-ext-diff --name-only <base>...HEAD -- 'src/**/*.css' 'src/**/*.tsx' 'src/**/*.ts' 'design/**'
git diff --no-ext-diff --name-only -- 'src/**/*.css' 'src/**/*.tsx' 'src/**/*.ts' 'design/**'
```

If nothing UI changed, report **"No UI files changed"** and stop.

## Step 2 · Load the rules, and only these

- [`design/DESIGN.md`](../../design/DESIGN.md): register, token names and
  roles, component contracts, § States, § Focus, § Theme, § Motion, and
  § What we deliberately don't do.
- `.claude/rules/30-ui-consistency.md` to `34-dark-theme.md`. They win any
  conflict with DESIGN.md.
- The token files `src/styles/globals.css` and
  `src/styles/themes/{light,dark}.css`, for which names exist. Values are
  read there and never copied into the review (rule 31).
- [`design/mockup.html`](../../design/mockup.html), to see the surface the
  diff touches as it was before.

## Step 3 · Run the gates

```bash
pnpm exec vitest run tests/css-tokenization.test.ts tests/contrast-*.test.ts tests/design-tokens-*.test.ts
```

A red gate is a BLOCK. Quote the failing line.

## Step 4 · Read each diff and check it

Read the whole diff of every file from step 1
(`git diff --no-ext-diff <base>...HEAD -- <file>`). Give every finding a
rule 60 severity: **BLOCK**, **MUST**, **SHOULD** or **NOTE**.

### Checked from the diff

**BLOCK**
- **A literal where a token belongs.** Any hex, `rgb()` or `hsl()` colour
  outside the three token files is an error; no new colour literal may be
  listed as an exception or deferral. Sizes, radii, z-index and durations
  follow rule 31's allowlist and the lists in `tests/css-tokenization.test.ts`.
- **A token declared outside the three token files**, or added to one
  theme file and not the other (rule 31 authoring rule 1).
- **Focus removed without a replacement** (rule 33 hard rule 1), or
  `outline: none` applied globally.
- **`window.confirm` / `alert` / `prompt`** (rule 30, rule 6).
- **A modal without its contract**: `role="dialog"`, `aria-modal`, a label,
  Escape, initial focus (rule 32 § Modal contract). A destructive dialog
  opens with focus on Cancel (D48).

**MUST**
- A token used for a role DESIGN.md § Tokens doesn't give it, or a new
  token with no row in § Tokens (rule 31 authoring rule 4).
- More than one primary action on a surface (rule 30, rule 1).
- A disabled control with no reason stated (rule 30, rule 4).
- Two signals for one event, e.g. a toast and a banner (rule 30, rule 5).
- An internal identifier on a primary surface (rule 30, rule 3).
- A colour transition on hover or press (DR12), or motion not zeroed by
  `prefers-reduced-motion` (DR13).
- Chrome text below the 12px floor (DESIGN.md § Type).
- Anything DESIGN.md § What we deliberately don't do rules out.

**SHOULD**
- A new focusable control that uses `:focus` where `:focus-visible` fits
  (rule 33 hard rule 6).
- Colour as the only state signal (rule 33 hard rule 5).
- A pattern repeated where rule 32 already has a shared one.

### Needs a screenshot or a running app

A diff cannot show these. Ask for screenshots of the changed surface **in
both themes** (`pnpm tauri dev`, or `/gui-manual-verify` on a device), or
for the user to run the app. **Without them, these stay BLOCKED and the
review does not pass.**

- Contrast as rendered: text 4.5:1, controls and focus rings 3:1 (A9),
  where no `tests/contrast-*` case measures the pair.
- Light and dark at a glance: no surface that only reads in one theme
  (rule 34).
- The focus ring visible on every new stop, in both themes, inside its
  container rather than clipped by it.
- Alignment with the macOS traffic lights and the 38px title bar.
- The selected or active item is clear within a second.
- Spacing and density match the neighbouring surfaces and
  `design/mockup.html`.
- Nothing clips at the minimum window (400×640) or at the sidebar's
  180–480px range.

If a screenshot check is load-bearing for this diff and none is provided,
**stop and ask for the screenshots** instead of guessing.

## Step 5 · Report

One table, BLOCK first:

| File:line | Rule | Severity | Finding | What to do |
|---|---|---|---|---|

Then one line for the screenshot checks: each one **passed (screenshot
named)**, **blocked (no screenshot)** or **not affected**.

End with exactly one verdict:
- **Clean.**
- **BLOCK — do not land.** At least one BLOCK, or a load-bearing
  screenshot check without a screenshot.
- **Fix before landing.** MUST findings only.
