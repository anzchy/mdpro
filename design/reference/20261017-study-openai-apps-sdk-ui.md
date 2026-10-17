# How OpenAI's Apps SDK UI organises its design materials

Sources: `openai/apps-sdk-ui` at `main` (v0.2.2, read 2026-10-17 through `gh api`), and the guidelines page at developers.openai.com/apps-sdk/concepts/design-guidelines (read with WebFetch, which returns a summary, so quotes from it are paraphrased). Copies of the files I read are in `scratchpad/study/src/`.

## 1. Token architecture

`src/styles/index.css` imports the tiers in order and labels each one: `base` (Tailwind and reset), "Tier 1 tokens: Primitives" `variables-primitive`, "Tier 2: Semantic" `variables-semantic`, "Tier 3: Components" `variables-components`, then `tailwind-utilities` and `globals`. Every token is declared under `@layer theme { :root, :where([data-theme]) { … } }`.

- **Primitive** (`variables-primitive.css`, 284 lines): raw scales with no meaning attached. `--gray-0…1000`, `--alpha-02…70` (computed from `--alpha-base`), hue ramps such as `--blue-*` plus alpha ramps like `--blue-a75`, `--hairline`, and shadow geometry and alpha. **Dark mode starts here.** The gray ramp itself flips: `--gray-0: light-dark(#ffffff, #0d0d0d)`, and `--gray-500: #5d5d5d` is the only fixed point. Shadow alphas get separate `[data-theme="dark"]` blocks.
- **Semantic** (`variables-semantic.css`, 566 lines): meaning plus state. The naming grammar is `--color-{background|border|text|ring}-{intent}-{variant}-{state}`, e.g. `--color-background-primary-soft-hover`. The intents are primary, secondary, info, warning, caution, danger, success, discovery and disabled. The variants are soft, surface, solid, outline and ghost. This tier also holds surfaces, borders, the type scale (`--font-heading-5xl-size`), control sizes and motion. It refers only to primitives, often as `light-dark(var(--gray-100), var(--gray-300))`. Font, weight, radius and spacing sit in a Tailwind `@theme static` block so that utility classes are generated from them.
- **Component** (`variables-components.css`, 215 lines): one commented section per component (Alert, Avatar, Badge, Button, …). Names follow `--{component}-{part}-{property}-{size}`, e.g. `--badge-gutter-sm`, and values point at semantic tokens. `Button.module.css` reads `--button-*` and `--control-*`, never primitives.
- **Theme switching:** a `[data-theme]` attribute on `<html>`, which can be nested. `globals.css` sets `color-scheme` on it, and `postcss/parseLightDark.mjs` (which has a test) compiles `light-dark()` into per-theme selectors.

**How the docs show values.** The approach is mixed, and it drifts.
- `src/Colors.mdx` and `src/Design tokens.mdx` are 11-line shells that only render `.storybook-base/components/Colors.tsx` and `DesignTokens.tsx`.
- The Colors swatches are painted live from `var(--gray-100)`, but the value text in their tooltips is typed by hand (`value="light-dark(#ffffff, #0d0d0d)"`).
- `DesignTokens.tsx` reads `.storybook-base/components/tokens.ts`, a 2,500-line copy of every semantic mapping, maintained by hand. It even paints swatches from the copied strings (`light-dark(${light}, ${dark})`) instead of from `var(--name)`. Radius and shadow swatches are the only ones that use `var(--name)` live.
- `src/Typography.mdx` types its values into an HTML table (`<Value>72px</Value>`) and pastes CSS excerpts.

**Drift I measured** (my own script comparing `tokens.ts` with the semantic CSS):
- 11 of 257 entries disagree. Examples: `color-text-success`, whose dark value is `--green-400` in the CSS but `--red-400` in `tokens.ts`; `color-text-info`, whose light value is `--blue-500` in the CSS but `--blue-700` in `tokens.ts`; and `color-text-primary-solid`, which is `--color-text-inverse` in the CSS but `--white` in `tokens.ts`.
- 2 CSS tokens (`color-text-caution-hover`, `-solid`) are missing from `tokens.ts`.
- `Typography.mdx` says "Four semantic text colors … base, emphasis, prose, secondary, and tertiary", which names five, and its example shows three.

This is direct evidence that a hand-copied value table goes stale even at OpenAI.

## 2. Information architecture

The order is fixed in `.storybook-base/preview.tsx`: `storySort: Overview → Concepts → Foundations → Components → Transitions`.

| Section | Pages | Diátaxis type |
|---|---|---|
| Overview | Introduction, Installation | tutorial / getting started |
| Concepts | Dark mode, Responsive design, Typography | mostly how-to (setup, JS helpers, a full Zustand theme example) with a little explanation |
| Foundations | Colors, Design tokens, Icons | reference (searchable galleries, copy buttons) |
| Components | `<Name>.mdx` | reference with how-to examples |
| Guidelines (separate site) | design-guidelines page | explanation and rules (when to use, rules of thumb, do/don't) |

Pages are chained with `<NextPrev>`, which gives a linear reading order.

## 3. How a component's files sit together

Each component lives in its own folder, e.g. `src/components/Button/`: `Button.tsx`, `Button.module.css`, `Button.stories.tsx`, `Button.mdx`, `index.tsx`, with tests beside them where they exist. Every component `.mdx` follows the same template:
1. `<Meta of={Stories}>`, Title and Subtitle
2. Hero
3. Usage (the import line, then `<Canvas of={Base}>`)
4. Reference (`<ArgTypes>`, generated from the TypeScript props by react-docgen-typescript)
5. Examples, each a `<Canvas>` with optional `<Controls>`

`.storybook-base/main.ts` collects `src/**/*.mdx` and `*.stories.tsx`. The styles read only that component's own `--{component}-*` tokens.

## 4. Guidance kept apart from reference

The guidelines page holds no token values: no hex, no px, only rules such as "3–8 items", "two actions max" and "WCAG AA".
- It is organised by display mode (Inline card, carousel, fullscreen, PiP). Each mode uses the same headings: When to use, Layout, Interaction, Rules of thumb. A visual section then covers Color, Typography, Spacing, Icons and Accessibility, with images of patterns to avoid.
- It links one way to the reference: to `@openai/apps-sdk-ui` (the Storybook URL) and to a Figma community kit.
- Storybook does not link back to the guidelines page. It links only to developers.openai.com/apps-sdk (`README.md`, `Introduction.mdx`, `brandUrl` in `addon-theme/themes.ts`). I confirmed this with `gh search code`.
- Rationale lives on the guidelines site; values and APIs live in the repo.

## 5. AGENTS.md

- It describes the repo layout, says to work only in `src/`, and sets the file naming (`Name.tsx/.module.css/.test.tsx/.stories.tsx/.mdx`).
- It has a component table with a one-line purpose for each.
- It says to update the `.mdx` and stories with every change, to copy the Avatar, Badge and Button docs as models, and to run format, lint, types and test before committing.
- **It says nothing about tokens.** There is no rule against raw hex values, no explanation of the tiers, and no dark-mode guidance.
- It mentions a `.node-version` file. I did not find one in the tree.

## 6. Sync and truth-keeping

- **Lint:** `stylelint.config.mjs` restricts spacing properties to `<length>` or `spacing()` and colours to `<color>` or `alpha()`, enforces long hex, orders custom properties first, uses PascalCase classes in modules, and adds two custom rules (`config/stylelint/*`) against mixins.
- **What is missing:** no rule forces a token instead of a literal, and nothing checks the docs against the CSS. That gap is how the drift above got in.
- **CI:** only `deploy-storybook.yml`, which builds Storybook and publishes it to GitHub Pages on every push to `main`, and `publish.yml`, which publishes to npm on a release and checks that the tag equals `package.json`'s version. The gates (format, lint, types, test, build) run only in `prepublishOnly`. No workflow runs them on PRs.
- **Changelog and deprecations:** there is no CHANGELOG file. GitHub release notes take its place (v0.2.0 to v0.2.2). I saw no deprecation policy or alias tokens.

## 7. What to copy, and what not to

### Copy

1. **Labelled token tiers with a strict reference direction** (primitive → semantic → component, and a component's CSS reads only its own tier).
   - In mdpro: split `globals.css :root` into commented "Tier 1/2/3" sections or files.
   - Express the theme where the bases live, and let the `color-mix()` derivations stay theme-agnostic, the way `light-dark()` in the primitives makes the semantic tier mostly theme-free.
   - Add a lint rule that a component file may not read a base token.
2. **A naming grammar instead of a list.** The pattern `--color-{role}-{intent}-{variant}-{state}` lets DESIGN.md's § Tokens state the grammar plus its exceptions rather than a row for every token. The tests keep reading `## Tokens`.
3. **A live token page.** Answer to your question: yes, but only in the *live* form, which OpenAI itself only half achieves.
   - Build an un-shipped dev page, e.g. `design/tokens.html`, served by Vite. It imports `globals.css` and the theme files and lists every `--*` from `document.styleSheets`.
   - For each token, show the name, the declared expression and `getComputedStyle()` under `.theme-light` and `.theme-dark` side by side, with a swatch painted from `var(--name)`.
   - That shows values without copying them.
   - OpenAI's `tokens.ts` is the anti-pattern: 11 of 257 entries have drifted. Never generate a static table from it.
4. **A fixed doc template with generated reference.** OpenAI's component pages always run Usage → generated reference (`ArgTypes`) → Examples.
   - In mdpro: give each component contract in DESIGN.md fixed subheadings (role, tokens it reads, states, focus pattern from rule 33, don'ts).
   - Have the live page list, for each component, which tokens its CSS reads, by grepping the CSS.
5. **Keep guidance separate from reference, linked one way.**
   - In mdpro: DESIGN.md keeps the explanation (register, rulings, "deliberately don't do", decisions). It links to the live token page and the ADRs for values and history.
   - Move the open questions and decisions log out to the ADRs or a sibling file, so the ~900 lines shrink.
   - Use the guidelines page's per-surface template (When to use / Layout / Interaction / Rules of thumb) for the editor, sidebar, tabs and dialogs.

### Don't copy

1. **Storybook, react-docgen and a deploy pipeline.** mdpro ships no library to outside consumers, and Storybook would add a toolchain the user has not asked for. A single static dev page meets the need.
2. **Tailwind `@theme` blocks and value-only guidance hosted on a separate site.** mdpro has no Tailwind and no external developer audience. Also, OpenAI's lack of a back-link and of CI on PRs is a weakness. mdpro already has stronger gates (`ledger:check`, the tests that read § Tokens), so it should extend those, not adopt OpenAI's looser model.

## Not verified

- Everything I know of the guidelines page came through WebFetch's summary.
- I did not check whether `tokens.ts` has a generator or test elsewhere. I found none in the tree.
- I did not open the published Storybook site in a browser, so I have not confirmed that the drift shows on the rendered page.
