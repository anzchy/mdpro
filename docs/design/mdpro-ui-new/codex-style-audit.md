# Codex macOS app: visual design audit for mdpro

- **Date:** 2026-09-11
- **mdpro commit:** `0a3675e` (`git rev-parse --short HEAD`)
- **ChatGPT.app version:** 26.903.71938 (`CFBundleShortVersionString`; bundle id `com.openai.codex`)
- **apps-sdk-ui commit:** `0f00143c7a639906f1621fe58e1b6be7b5bea46d` (main, committed 2026-05-05)
- **Extraction method:** (a) `strings -n 8` over `app.asar` + (b) dependency-free asar header reader (Python, kept outside the repo). (c) `npx @electron/asar` was **not** used (not approved).
- **Scope:** analysis and documentation only. No code, token, or DESIGN.md changes were made.

**How to read this doc.**
- **Tags.** Each sourced value has one tag on the same line: `asar-observed`, `asar-strings`, `sdk-ui`, `tui-guide`, `guideline-doc`, `screenshot-measured`, `mdpro-observed` or `inferred`.
- **app-initial.** This short name means `webview/assets/app-initial-49fc08c26651.css` inside `app.asar`. The file is minified onto one line, so asar-observed citations give the CSS layer and selector instead of a line number.
- **mdpro's current values.** Following rule 31 (`.claude/rules/31-design-tokens.md:18-19`), this doc never copies mdpro's current token values. mdpro is cited by `path:line` only. Codex and sdk-ui values are quoted as evidence. Proposed mdpro values in section 6 are new choices, dated by the commit pin above.

## 1. Source inventory

| source | location | version/commit | license | what it establishes | tag |
|---|---|---|---|---|---|
| Codex webview CSS (method b) | `/Applications/ChatGPT.app/Contents/Resources/app.asar` → `webview/assets/app-initial-49fc08c26651.css` (823559 B), `webview/assets/app-primary-d815831c9bad.css` (147890 B); 208 `.css` entries in the archive | app 26.903.71938 | proprietary, studied only, nothing copied | Real surfaces, type ramp, radii, motion, diff UI, dark-mode mechanism. app-initial declares 1474 distinct custom properties (1671 across all 208 CSS files) | asar-observed |
| Codex archive strings (method a) | same `app.asar`, `strings -n 8` | app 26.903.71938 | proprietary | Token names and values found outside any `.css` entry, e.g. `--codex-base-surface/-ink/-accent/-contrast`, `--codex-content-font-family`, `--codex-sidebar-preferred-width`, `--text-primary`, `--border`. Values cannot be tied to a file | asar-strings |
| Archive file listing (method b) | asar JSON header (8967 entries; header parsed, and the extracted CSS starts with valid `@layer` text) | app 26.903.71938 | proprietary | Bundled fonts `OpenAISans-Regular-*.woff2` and `OpenAISans-Medium-*.woff2`; icon runtime `webview/assets/createLucideIcon-*.js` | asar-observed |
| Bundle metadata | `Contents/Info.plist`, `Contents/Resources/owl-electron-app.json` (`runtimeName: owl`, `packagedFrom` ends `codex/codex-apps/electron/out/ChatGPT-darwin-arm64/ChatGPT.app`); `Contents/Frameworks/` has `Codex Framework.framework` and `Sparkle.framework` | 26.903.71938 | proprietary | The Codex app is Electron; its UI is web CSS | inferred (read directly from the bundle; not inside the archive) |
| `openai/apps-sdk-ui` | `src/styles/{index,base,globals,variables-primitive,variables-semantic,variables-components}.css` via `gh api` | `0f00143` | MIT | OpenAI's published token architecture (primitive → semantic → component) and license-clean reference values | sdk-ui |
| `openai/openai-apps-sdk-examples` | `src/host-theming/App.tsx:22-29` (`CSS_VARS_TO_SHOW`) | `18cc38e` | not checked | The host theming variables ChatGPT injects into app iframes (a demonstrated subset) | sdk-ui (examples repo) |
| `openai/codex` TUI style guide | `codex-rs/tui/styles.md` (1213 B) | main `9e22e74` (2026-09-11) | Apache-2.0 | Design philosophy: few semantic colors, dim for secondary text, avoid custom colors | tui-guide |
| `openai/codex` provenance checks | repo description "Lightweight coding agent that runs in your terminal"; issue #10733 is `closed` / `not_planned`; `openai/codex-app`, `openai/codex-desktop`, `openai/chatgpt-desktop` all return 404 | 2026-09-11 | Apache-2.0 | The Mac app UI is not open source; the CLI repo holds no Mac UI | inferred |
| Apps SDK UI guidelines | https://developers.openai.com/apps-sdk/concepts/ui-guidelines | fetched 2026-09-11 (one WebFetch; returned text went through a summarizing fetcher) | OpenAI site terms, not checked | Stated principles for color, type, radii and icons. **Verified to exist**; short quotes below should be re-checked verbatim before any external use | guideline-doc |
| MDN browser-compat-data | `css/types/color.json` | `f0e862b` | not checked | Safari support: `light-dark()` since 17.5, `color-mix()` since 16.2 | inferred (third-party compat data) |
| Lucide | `lucide-icons/lucide` `LICENSE`; `packages/lucide-react/package.json:5,29` | `5d592a9` | ISC | License of the icon library Codex ships, which this doc proposes as a dependency | inferred |
| Screenshots of the running app | ChatGPT.app, window 1380×949pt at @2x; `screencapture -l` plus accessibility-tree frames; navigation via AXPress only | app 26.903.71938, captured 2026-09-11 | proprietary; captures kept outside the repo | **Done with user approval** (view only, no messages sent, dark theme reverted to System). Rendered surfaces, text, borders, controls, geometry and Appearance theme settings in light and dark (section 2.11). Not captured: row-level diff view, theme-switch animation | screenshot-measured |
| mdpro | `src/styles/`, `src/components/`, `DESIGN.md`, `.claude/rules/31,34`, `docs/design/mdpro-ui-old/canvas.json`, `src-tauri/Cargo.lock` | `0a3675e` | project | mdpro's current state, cited by path:line | mdpro-observed |

**Re-checking the pre-written prompt's claims (2026-09-11).**
- **Confirmed:**
  - ChatGPT.app version and Electron `owl` runtime.
  - `app.asar` is 306621494 B (292.4 MiB).
  - `app-initial-*.css` (~824 KB) and `app-primary-*.css` exist.
  - app-initial has 1474 distinct custom properties.
  - OpenAISans Regular/Medium woff2 files are bundled.
  - The guidelines page exists.
  - apps-sdk-ui file sizes match.
  - The `styles.md` content matches its lines 3-19.
- **Not reproduced exactly: the "94 unique token:value pairs" count.** A `strings` regex of `--name:#hex` found 268 unique pairs, so the earlier count used a different pattern.
- **Found only as strings, not declared in any CSS file:**
  - `--text-primary: #0d0d0d` / `#f2f2f2` and `--border: #d8d8d8` / `#3a3a3a` appear in the archive strings but in none of the 208 CSS entries (asar-strings).
  - `--codex-base-*` and `--codex-content-font-family` exist only as names in strings (asar-strings).
- **Declared in app-initial:** `--codex-corner-shape`, `--codex-corner-radius-scale`, `--codex-chat-font-size`, `--codex-chat-code-font-size`, `--codex-diffs-surface`, `--codex-diffs-header-padding-x/-y` (asar-observed).
- **mdpro's WebView is WebKit:** `src-tauri/Cargo.lock:6166` (`wry`) and `src-tauri/Cargo.lock:2825` (`objc2-web-kit`) (mdpro-observed).

## 2. Codex visual voice

### 2.1 Color & surfaces (light / dark)

**What Codex does.** Codex uses pure, untinted grays with one blue that appears only as focus and accent. Secondary text, icons and borders are all the foreground color at reduced opacity. There are no separate hues for them.

**Evidence.**
- **Gray primitives.** `--gray-0: #fff`, `--gray-50: #f9f9f9`, `--gray-150: #dfdfdf`, `--gray-800: #212121`, `--gray-900: #181818`, `--gray-1000: #0d0d0d` (asar-observed, app-initial `@layer theme :root,:host`).
- **Light page.** `.electron-light` sets `--color-background-surface: var(--gray-0)`, `--color-background-surface-under: var(--gray-50)` and `--color-text-foreground: #1a1c1f` (asar-observed).
- **Dark page.** `.electron-dark` sets `--color-background-surface: var(--gray-900)`, `--color-background-surface-under: black` and `--color-text-foreground: var(--gray-150)` (asar-observed).
- **Secondary and tertiary text.**
  - Light: `color-mix(in oklab, var(--color-text-foreground) 70%, transparent)` and `50%` (asar-observed).
  - Dark: `#ffffffb3` and `#ffffff80` (asar-observed).
- **Raised surfaces are slightly see-through.** `--color-background-elevated-primary` is `#ffffffb3` in light and `#212121f5` in dark (asar-observed; also found by asar-strings).
- **Accent.** `--color-accent-blue: var(--blue-300)` in both themes, where `--blue-300: #339cff` (asar-observed).
- **Focus.** `--color-border-focus` is `var(--blue-300)` in light and `#339cffb3` in dark (asar-observed).
- **A second, unattributed token set.** `--text-primary: #0d0d0d` / `#f2f2f2` and `--border: #d8d8d8` / `#3a3a3a` (asar-strings). This is probably a JS-injected theme or a legacy set (inferred).
- **Philosophy.** "Most of the time, just use the default foreground color." (styles.md:9). Cyan, green, red and magenta are the only semantic colors (styles.md:10-13). "Avoid custom colors" (styles.md:17) (tui-guide).
- **Guidelines.** "Use system colors for text, icons, and spatial elements like dividers." (guideline-doc)

### 2.2 Typography

**What Codex does.** Codex uses the system sans at small, dense chrome sizes. Only four weights are used, and letter spacing is normal. A proprietary OpenAI Sans is bundled and exposed as a separate font variable.

**Evidence.**
- **Sans family.** `--font-sans: var(--vscode-font-family,var(--font-sans-default))` and `--font-sans-default: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (asar-observed).
- **Mono family.** `--font-mono-default: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` (asar-observed).
- **OpenAI Sans.** `@font-face` rules for `OpenAI Sans` at weights 400 and 500 with `font-display: swap`, exposed as `--font-openai-sans: "OpenAI Sans", var(--font-sans-default)` (asar-observed). Settings → Appearance lists UI font and Code font as "System default" (screenshot-measured). Which surfaces, if any, still use OpenAI Sans: `unknown — needs measurement`.
- **Base size ramp.** `--text-xs: 11px`, `--text-sm: 12px`, `--text-base: 14px`, `--text-lg: 16px`, `--text-xl: 28px`, `--text-2xl: 36px` (asar-observed, `@layer theme`).
- **Desktop window override.** `[data-codex-window-type=electron]` sets `--text-xs: 12px` and `--text-sm: 13px` (asar-observed).
- **Chat body.** `--codex-chat-font-size: var(--vscode-chat-font-size,var(--vscode-font-size,13px))`. Code inside chat falls back to `12px` (asar-observed).
- **Markdown line height.** Font size × `--leading-relaxed: 1.625`. Other leading steps: `--leading-normal: 1.5`, `--leading-tight: 1.25` (asar-observed).
- **Weights.** `--font-weight-normal: 400`, `-medium: 500`, `-semibold: 600`, `-bold: 700` (asar-observed). apps-sdk-ui renders `b`/`strong` as semibold (sdk-ui globals.css:40-44).
- **Tracking.** `--tracking-normal: 0em`, `--tracking-tight: -.025em` (asar-observed).
- **Reference ramp.** `--font-text-sm-size: 0.875rem` with `--font-text-sm-line-height: 1.25rem` (sdk-ui variables-semantic.css:461-462).
- **Guidelines.** "Always inherit the system font stack, respecting system sizing rules for headings, body text, and captions." (guideline-doc)

### 2.3 Spacing & density

**What Codex does.** All spacing multiplies one base unit (Tailwind v4 style). The chrome is compact, with square icon buttons.

**Evidence.**
- **Base unit.** `--spacing: .25rem` (asar-observed). apps-sdk-ui uses the same: `--spacing: 0.25rem` (sdk-ui variables-semantic.css:46).
- **Toolbar.** `--padding-toolbar: calc(var(--spacing) * 4)` and `--height-toolbar: 46px` (asar-observed). Browser windows use `calc(var(--spacing) * 13)` (asar-observed).
- **Sidebar icon button.** A `calc(var(--spacing) * 6)` square with `padding: var(--spacing)` (asar-observed).
- **Thread width.** `--thread-content-max-width: 48rem` in browser and extension windows; `none` by default (asar-observed).
- **Real row heights and sidebar width.**
  - Sidebar splitter at 405pt; rows 397pt wide with an 8pt inset.
  - Nav rows 30pt; two-line rows 53–54pt.
  - Settings nav rows 30pt at a 31pt pitch.
  - Toolbar buttons 28×28; main thread column 508pt.

  All values are screenshot-measured; section 2.11 has the full table. `--codex-sidebar-preferred-width` remains a name only (asar-strings).

### 2.4 Radii & corner shape

**What Codex does.** Codex has a tokenized radius scale multiplied by a global corner scale. Where the engine supports it, corners become continuous squircles (a superellipse) and radii grow by 25%.

**Evidence.**
- **Radius base scale.** `--radius-2xs-base: .125rem`, `--radius-lg-base: .625rem`, `--radius-2xl-base: 1rem`, `--radius-3xl-base: 1.25rem`, `--radius-4xl-base: 1.5rem`, `--radius-full: 9999px` (asar-observed).
- **Global scale.** Each `--radius-*` is `calc(var(--radius-*-base) * var(--corner-radius-scale))`, with `--corner-radius-scale: 1` by default (asar-observed).
- **Squircle upgrade.** Inside `@supports (corner-shape:superellipse(1.5))`, `--codex-corner-shape: superellipse(1.5)` and `--codex-corner-radius-scale: 1.25` apply. The browser window type reverts to `round` at scale 1 (asar-observed).
- **Where it applies.** Rounded utilities, `.sidebar-item` (`--radius-lg`) and `.sidebar-icon-button` (`--radius-md`) use `corner-shape: var(--codex-corner-shape)` (asar-observed).
- **Toolbar buttons.** `--radius-button-toolbar: var(--radius-lg)`, or `var(--radius-full)` in the browser window type (asar-observed).
- **Reference scale.** `--radius-2xs: 0.125rem` … `--radius-4xl: 1.5rem`, `--radius-full: 9999px` (sdk-ui variables-semantic.css:32-41). `--menu-radius: var(--radius-xl)` (sdk-ui variables-components.css:133). `--popover-radius` (sdk-ui variables-components.css:155).
- **Guidelines.** "Respect system specified corner rounds when possible to keep shapes consistent." (guideline-doc)

### 2.5 Borders/dividers vs shadows/elevation

**What Codex does.** Codex has three border strengths, all derived from the foreground color. Elevation is a half-pixel outline ring plus very faint, wide shadows. In dark mode the composer uses a faint inner light edge instead of a drop shadow.

**Evidence.**
- **Light borders.** `color-mix(in oklab, var(--color-text-foreground) 5%|8%|12%, transparent)` for `--color-border-light`, `--color-border` and `--color-border-heavy` (asar-observed, `.electron-light`).
- **Dark borders.** `#ffffff0a`, `#ffffff14` and `#ffffff29` for the same three tiers (asar-observed, `.electron-dark`).
- **Outline ring.** `--elevation-stroke: 0 0 0 .5px var(--color-border-strong)` (asar-observed).
- **Sidebar elevation.** `--elevation-sidebar: var(--elevation-stroke), 0 3px 7.5px #00000008, 0 0 16px #00000005` (asar-observed).
- **Hairline shadow.** `--shadow-hairline: 0px 0px 0px .5px #0000001a` (asar-observed).
- **Shadow ramp.** `--shadow-sm: 0px 1px 2px -1px #00000014` through `--shadow-2xl: 0px 16px 32px -8px #00000030` (asar-observed).
- **Composer.** `--elevation-composer: 0 0 0 1px #0000000a, 0 2px 8px 0 #0000000a, 0 4px 80px 8px #00000006`; the dark variant is `inset 0 0 1px 0 #fff3` (asar-observed).
- **Reference.** `--shadow-hairline: 0 0 0 var(--shadow-hairline-width) var(--shadow-hairline-color)` (sdk-ui variables-semantic.css:531). `--color-border: light-dark(var(--alpha-10), var(--alpha-12))` (sdk-ui variables-semantic.css:406).

### 2.6 Iconography

**What Codex does.** Codex uses Lucide: monochrome outline icons at a fixed set of sizes, colored as the foreground at reduced opacity.

**Evidence.**
- **Icon library.** The archive contains `webview/assets/createLucideIcon-*.js` (asar-observed), and `Resources/THIRD_PARTY_NOTICES.txt` mentions lucide twice (inferred).
- **Size classes.**

  | class | size | tag |
  |---|---|---|
  | `.icon-2xs` | `var(--icon-secondary-size,14px)` | asar-observed |
  | `.icon-xs` | `var(--icon-size,16px)` | asar-observed |
  | `.icon-sm` | `18px` | asar-observed |
  | `.icon-md` | `24px` | asar-observed |
  | `.icon-lg` | `28px` | asar-observed |

- **Icon color.** `--color-icon-secondary` is `color-mix(in oklab, var(--color-text-foreground) 70%, transparent)` in light and `#ffffffb3` in dark (asar-observed).
- **Guidelines.** Icons should be "monochromatic and outlined" (guideline-doc).

### 2.7 Motion/easing

**What Codex does.** Codex uses named enter and exit curves with a 150ms default duration, and handles reduced motion in dozens of places (asar-observed).

**Evidence.**
- **Curves.** `--cubic-enter: cubic-bezier(.19, 1, .22, 1)`, `--cubic-exit: cubic-bezier(.8, 0, .4, 1)`, `--ease-enter-snappy: cubic-bezier(.23, 1, .32, 1)` (asar-observed).
- **Defaults.** `--default-transition-duration: .15s` with `--default-transition-timing-function: cubic-bezier(.4, 0, .2, 1)`; `--transition-duration-relaxed: .3s` (asar-observed).
- **Reduced motion.** app-initial has 21 `@media (prefers-reduced-motion:reduce)` groups and 33 `no-preference` groups (asar-observed count). The markdown fade-in sets `--duration: 0s` under reduce (asar-observed).
- **Reference.** `--cubic-enter` (sdk-ui variables-semantic.css:514), `--cubic-exit` (sdk-ui :515), `--cubic-move: cubic-bezier(0.65, 0, 0.35, 1)` (sdk-ui :517), `--transition-duration-basic: 150ms` (sdk-ui :518).

### 2.8 Window chrome (title bar, sidebar, traffic lights)

**What Codex does.** The title bar is drawn in the web content: a draggable toolbar whose buttons opt out of dragging. The header can take a tint, and the sidebar is a raised panel.

**Evidence.**
- **Dragging.** `._Toolbar_*` and `._ApplicationMenuTopBar_*` set `-webkit-app-region: drag`; `button` children set `no-drag` (asar-observed).
- **Header tint.** `--header-tint: var(--codex-titlebar-tint,transparent)` on the floating header (asar-observed).
- **Toolbar height.** `--height-toolbar: 46px` (asar-observed).
- **Sidebar.** `--elevation-sidebar` exists, which suggests the sidebar is drawn as a raised panel (asar-observed + inferred).
- **Traffic lights.** No offset variable for them appears in the CSS, so their placement is set natively. Measured: 16×16 at x=15/38/61, y=15, centered in the 46pt title bar; the first toolbar button starts at x=88 (screenshot-measured).
- **Rendered chrome.**
  - The title bar has no fill of its own; it shares the sidebar and main surfaces (screenshot-measured).
  - A 0.5pt hairline sits under it: #e4e4e5 light, #3c3c3c dark (screenshot-measured).
  - In dark mode the window gets a 0.5pt #464646 top highlight (screenshot-measured).

### 2.9 Diff/code presentation

**What Codex does.** Diffs are mono text with generous line height. The diff surface is the page surface nudged slightly toward the text color, not a separate hue. Only green and red carry meaning, which matches the TUI rule.

**Evidence.**
- **Diff text.** `--diffs-font-family: var(--font-mono)`, `--diffs-font-size: var(--vscode-editor-font-size,12px)`, `--diffs-line-height: calc(var(--diffs-font-size,12px) * 1.8)`, `--diffs-min-number-column-width: 4ch` (asar-observed, `:root`).
- **Diff surface.** `--color-codex-diff-surface: color-mix(in srgb, var(--color-surface) 94%, var(--color-text))` (asar-observed).
- **Added and deleted lines.**

  | theme | added line | deleted line | mix form | tag |
  |---|---|---|---|---|
  | light | `#00a24026` | `#ba262326` | 15% color-mix | asar-observed |
  | dark | `#40c9773b` | `#fa423e3b` | 23% color-mix | asar-observed |

- **Line markers.**
  - Light: `--color-decoration-added: var(--green-500)` (= `#00a240`) and `--color-decoration-deleted: var(--red-600)` (= `#ba2623`) (asar-observed).
  - Dark: `var(--green-300)` (= `#40c977`) and `var(--red-400)` (= `#fa423e`) (asar-observed).
- **More diff names** (values not attributable): `--codex-diffs-addition-number`, `--codex-diffs-hover-surface`, `--codex-diffs-header-surface`, `--codex-file-change-gutter-width` (asar-strings).
- **TUI rule.** Green means additions; red means deletions (tui-guide, styles.md:11-12).

### 2.10 Dark-mode mechanism

**What Codex does.** A class on the root element switches the meaning-level color tokens and sets `color-scheme`. A `prefers-color-scheme` media query is the fallback for windows without a class. Newer color functions are wrapped in `@supports` with plain fallbacks.

**Evidence.**
- **Theme classes.** `.electron-light` and `.electron-dark` in `@layer utilities` set `color-scheme: light` / `color-scheme: dark` (asar-observed).
- **Media-query fallback.** `@media (prefers-color-scheme:dark)` applies to `[data-codex-window-type=browser]:not(.electron-light):not(.electron-dark)` (181 groups, asar-observed).
- **Compiled `light-dark()`.** `.electron-dark` also sets `--lightningcss-light` / `--lightningcss-dark` (asar-observed). These variables are the output of Lightning CSS's `light-dark()` downlevel transform, so the source was probably authored with `light-dark()` (inferred).
- **Progressive enhancement.** `@supports (color:color-mix(in lab, red, red))` wraps color-mix overrides that sit on top of plain `var()` fallbacks (553 groups, asar-observed).
- **apps-sdk-ui approach.** It authors `light-dark()` directly (sdk-ui variables-primitive.css:7) and switches themes with `[data-theme="dark"] { color-scheme: dark; }` (sdk-ui globals.css:20-22).
- **Theme-switch transitions.** Whether Codex animates them: `unknown — needs measurement`. Captures were taken about 2s after each switch, so they can't show a transition.
- **Settings win over CSS defaults.** In dark mode the primary text renders #ffffff, which is the Appearance "Foreground" value. The CSS default is `--gray-150` (§2.1). So runtime theme settings override the static tokens (screenshot-measured; see 2.11).

### 2.11 Measured UI (screenshots of the running app)

**Method.**
- **App and window.** ChatGPT.app 26.903.71938 in Codex and ChatGPT modes, window 1380×949pt, captured at @2x with `screencapture -l`.
- **What was read.** Colors are sRGB pixel reads. Sizes come from accessibility-tree frames or pixel runs, where 1 image pixel is 0.5pt.
- **Caveat.** Rendered colors include anti-aliasing and whatever translucent layer sits underneath, so they can differ from the declared tokens.
- **Themes.** Light uses the app's default theme settings. Dark was selected temporarily in Settings → Appearance and then set back to System.
- **Privacy.** Screenshots stay outside the repo. No conversation, project, file or account content is reproduced here.

**What the measurements show.**
- **Surfaces.** Chrome uses essentially two surfaces:
  - light: sidebar #fdfdfd, main #ffffff (screenshot-measured)
  - dark: sidebar #222222, main #181818 (screenshot-measured)
- **Borders.** They render as opaque neutrals near #ededed (light) and #353535 (dark). That is what a low-alpha foreground mix looks like once composited (screenshot-measured; mechanism per §2.5).
- **Selection.** Selected rows are one neutral step off the surface: #f0f1f1 light, #333333 dark (screenshot-measured).
- **Saturated color.** The only saturated UI color is a fixed blue #3b84f7, used on switches, the slider and unread dots. Links are #2c67c5 (screenshot-measured).
- **Primary emphasis uses the foreground color, not blue.** The stop button, user bubble and selected theme ring are black in light and white in dark (screenshot-measured).
- **Density.** 46pt title bar, 28pt toolbar buttons, 30pt nav rows, 36pt file rows (screenshot-measured).

**Surfaces and fills**

| element | light | dark | tag |
|---|---|---|---|
| main surface | #ffffff | #181818 | screenshot-measured |
| sidebar (translucent sidebar on) | #fdfdfd | #222222 | screenshot-measured |
| selected sidebar row / settings nav row | #f0f1f1, radius ≈10pt | #333333 | screenshot-measured |
| sidebar search field | #f2f2f2, 30pt tall | #2e2e2e | screenshot-measured |
| settings card | #ffffff, 1pt border #ededed, radius ≈12pt | #232323, 1pt border #353535 | screenshot-measured |
| composer | #ffffff, 1pt border #eaeaea, soft shadow ≈8pt, ≈98pt tall | #2a2a2a (raised), 0.5–1pt border #373737 | screenshot-measured |
| user message bubble | #000000 pill, white text, ≈41pt tall | #2f2f2f pill, white text | screenshot-measured |
| inline code chip | #e9eaea, 16pt tall | #303030 | screenshot-measured |
| side panel tab, active | #f4f4f4, 26–28pt tall | #242424 | screenshot-measured |
| floating "files changed" chip | #f9f9fa–#fafafa (translucent), 1pt border #ececec, soft shadow, ≈35pt pill | #262626, 1pt border #343434 | screenshot-measured |
| "Edited N files" card in the timeline | #ffffff, 0.5pt outline #e4e4e5, 1pt header divider #ededed, icon tile #f7f7f7 | not captured | screenshot-measured |
| review panel: file preview surface | #f4f4f4 below white header rows | not captured | screenshot-measured |
| review panel: code block | body #eaeaea, header #f5f5f5 (48pt), 1pt border #e0e0e0 | not captured | screenshot-measured |
| popover menu | #ffffff, 0.5pt border #d3d3d3 (#c9c9c9 at bottom), radius ≈15pt | #2d2d2d, 0.5pt border #444444, highlighted item #2f2f2f | screenshot-measured |
| pressed toolbar popup (mode switch) | #f0f1f1 | #333333 | screenshot-measured |

**Text**

| role | light | dark | tag |
|---|---|---|---|
| primary (body, headings, labels) | #191c1f | #ffffff | screenshot-measured |
| sidebar row title | #3b3e40 | #dedede | screenshot-measured |
| secondary (timeline tool lines, "Working for") | #767778 | #a3a3a3 | screenshot-measured |
| settings description, mono path | #6a6b6d | #919191 | screenshot-measured |
| file path in file rows | #5f6062 | not captured | screenshot-measured |
| tertiary (meta, shortcuts, unselected segment, effort label) | #8d8e8f–#8f9091 | #959595–#979797 | screenshot-measured |
| section label ("Projects", "Show more") | #a9aaaa | #747474 | screenshot-measured |
| placeholder | #c7c7c8 | #5f5f5f | screenshot-measured |
| disabled | #a3a4a5 | #7b7b7b | screenshot-measured |
| shimmer ("Planning…") | #a7a8a9 | #717171 | screenshot-measured |
| link | #2c67c5 | not measured | screenshot-measured |
| menu icon | #525557 | not measured | screenshot-measured |

**Borders and dividers**

| divider | light | dark | tag |
|---|---|---|---|
| title-bar bottom hairline | 0.5pt #e4e4e5 | 0.5pt #3c3c3c | screenshot-measured |
| sidebar edge | 0.5pt (drawn inside a 16pt splitter hit area) | 0.5pt #343434 | screenshot-measured |
| main edge / side panel edge | 1pt #ededed | 1pt #2b2b2b | screenshot-measured |
| timeline section divider | 1pt #ededed | 1pt #2b2b2b | screenshot-measured |
| settings row divider inside a card | 0.5pt #ededed | 0.5pt #353535 | screenshot-measured |
| secondary button ("Review", "Open") | 0.5–1pt #ededed on white | fill #1f1f1f, border #313131 | screenshot-measured |
| popup button | 1pt #ededed on white, 28–29pt | fill #141414, border #272727 | screenshot-measured |
| window top edge | none visible | 0.5pt highlight #464646 | screenshot-measured |

**Accent, status and controls**

| control | light | dark | tag |
|---|---|---|---|
| switch, on | #3b84f7, white knob, 33×20pt; disabled-on #8db5fb | #3b84f7 | screenshot-measured |
| slider | track #3b83f6, knob #191c1f 20pt | track #3b84f7, knob #ffffff | screenshot-measured |
| unread dot | #3b84f7 | #3b84f7 | screenshot-measured |
| primary round button (stop) | black circle, white glyph | white circle, black glyph | screenshot-measured |
| segmented control | selected pill #f4f4f4 62×24pt; unselected is bare text #8e8f90 | not measured | screenshot-measured |
| selected theme card | 2pt ring #191c1f | 2pt ring #ffffff | screenshot-measured |
| diff counts (+ / −) | #01a241 / #ba2723 | #41c977 / #fa423e | screenshot-measured |

**Geometry (points)**

| element | measurement | tag |
|---|---|---|
| title bar | 46pt; toolbar buttons 28×28 at y=9; Share button 74×28 | screenshot-measured |
| traffic lights | 16×16 at x=15/38/61, y=15 (23pt pitch) | screenshot-measured |
| sidebar | splitter at x=405 (16pt hit area), visible edge ≈413pt; rows 397pt wide (8pt inset) | screenshot-measured |
| sidebar rows | nav 30pt; two-line rows 53–54pt at a 54–55pt pitch; icon buttons 24×24; mode switch 32pt tall | screenshot-measured |
| main thread | content column 508pt wide; message actions 26–27×26 | screenshot-measured |
| composer | text area 484×44, buttons 28×28, permissions popup 128×28 | screenshot-measured |
| side panel | ≈419pt wide; tabs 89–90×28; toolbar buttons 28×28 | screenshot-measured |
| "Edited N files" card | 508pt wide; header 64.5pt with a 40×40 icon tile; file rows 36pt; Undo 69×28, Review 62×28 | screenshot-measured |
| mode menu | 240pt wide; items 232×53 (4pt inset); shadow ≈8pt | screenshot-measured |
| profile menu | 397pt wide; header item 43pt, items 29pt, 1pt separator #eeeeee; shadow ≈8pt at the sides, ≈16pt below | screenshot-measured |
| settings | nav rows 397×30 at a 31pt pitch; content column 767pt; card rows 45pt (one line), 61pt (title + description), 77pt (three lines) | screenshot-measured |
| theme picker cards | 249×200pt, radius ≈8–10pt | screenshot-measured |

**Diff and code colors, rendered**

| element | light | dark | tag |
|---|---|---|---|
| removed line: gutter / content / 4pt marker | #fdece9 / #fce6e2 / #ba2723 | #28130e / #3c1f1b / #fa423e | screenshot-measured (Appearance preview) |
| added line: gutter / content / marker | #edf7ed / #e6f4e7 / #01a241 | #132016 / #1f3124 / #41c977 | screenshot-measured (Appearance preview) |
| syntax: string / property / keyword | #008809 / #be5801 / #751ed9 | #85df7b / #fb994c / #b06dff | screenshot-measured (Appearance preview) |
| line numbers | #585858 | #a1a1a1 | screenshot-measured |
| JSON key in the review panel's code block | #b8812c on #eaeaea | not captured | screenshot-measured |

- **Markers match the tokens.** The rendered markers match the §2.9 tokens to within one RGB unit (screenshot-measured vs asar-observed).
- **Line fills are the same hue family, but may not be exact.** The content fills sit in the same hue family as the 15% / 23% mixes. The exact compositing was not re-derived (inferred).
- **Row-level diff not captured.** "Review changed files" opened a rendered file preview, not a row-level diff, so the Appearance preview is the only row-level diff captured (screenshot-measured).

**Appearance settings: the theme is a handful of base values.** Settings → Appearance shows these defaults. They were read, not changed, apart from the temporary theme switch.

| setting | Light theme | Dark theme | tag |
|---|---|---|---|
| theme preset | Codex | Codex | screenshot-measured |
| Accent | Black | White | screenshot-measured |
| Background | #FFFFFF | #181818 | screenshot-measured |
| Foreground | #1A1C1F | #FFFFFF | screenshot-measured |
| Contrast | 45 | 60 | screenshot-measured |
| Translucent sidebar | on | on | screenshot-measured |
| UI font / Content font / Code font | System default / Same as UI font / System default | not recorded | screenshot-measured |

- **The setting names mirror the base token names.** Accent, Background, Foreground and Contrast line up with the `--codex-base-accent/-surface/-ink/-contrast` names found only in archive strings (asar-strings).
- **Likely mechanism: everything else is derived at runtime.** Borders, fills and secondary text are computed from these four values, which is why rendered colors don't always equal the static CSS defaults (inferred).
- **What "accent" means here.** The default Accent is the foreground color (Black / White). The blue #3b84f7 appears to be a separate fixed control color, not the `--blue-300` accent token of §2.1 (inferred from screenshot-measured values).
- **Not measured:**
  - theme-switch animation
  - the surfaces that use OpenAI Sans
  - the dark review panel
  - light-mode menu hover

## 3. OpenAI token architecture

**apps-sdk-ui: three explicit tiers.** `src/styles/index.css:3-8` labels the import order in comments: "Tier 1 tokens: Primitives", "Tier 2 tokens: Semantic", "Tier 3 tokens: Components". Tailwind utilities come next and opinionated globals come last (sdk-ui).

| Tier | File | Shape | Example (tagged) |
|---|---|---|---|
| 1. Primitive | `variables-primitive.css` | Raw scales. Every value is a `light-dark()` pair, so the scale itself flips with the theme | `--gray-0: light-dark(#ffffff, #0d0d0d)` (sdk-ui variables-primitive.css:7); `--alpha-base: light-dark(#0d0d0d, #ffffff)` (sdk-ui :36) with `--alpha-10: alpha(var(--alpha-base), 10%)` (sdk-ui :43) |
| 2. Semantic | `variables-semantic.css` | Tokens named by role that point at primitives, sometimes with a different primitive per theme | `--color-surface: light-dark(var(--gray-0), var(--gray-200))` (sdk-ui :560); `--color-border: light-dark(var(--alpha-10), var(--alpha-12))` (sdk-ui :406); `--color-text: var(--gray-1000)` (sdk-ui :55) |
| 3. Component | `variables-components.css` | Per-component aliases of semantic tokens | `--menu-radius: var(--radius-xl)` (sdk-ui variables-components.css:133); `--badge-radius-sm: var(--radius-xs)` (sdk-ui :41) |
| Activation | `globals.css` | `color-scheme` on `[data-theme]` drives every `light-dark()` | `[data-theme="dark"] { color-scheme: dark; }` (sdk-ui globals.css:20-22) |

Two details matter:
- **The alpha ramp flips with the theme.** Its base color is itself a `light-dark()` pair (sdk-ui variables-primitive.css:36), so every border and soft fill tracks the theme without per-theme overrides.
- **Tailwind gets the same tokens.** `@theme static` (sdk-ui variables-semantic.css:4) exposes them as utilities.

**Codex app CSS: the same idea, compiled, with two extra tiers.** Five tiers were found in app-initial:

0. **Host tier.** `--vscode-*` variables feed `--color-token-*` aliases. Example: `--color-token-border: var(--color-border, color-mix(in oklab, var(--vscode-foreground) 8%, transparent))` (asar-observed). This exists because the same webview also runs as an editor extension (`data-codex-window-type` ∈ electron / browser / extension / chrome-extension, asar-observed).
1. **Primitives.** Plain hex values in `@layer theme :root,:host`, e.g. `--gray-900: #181818` and `--blue-300: #339cff` (asar-observed). No `light-dark()` survives compilation.
2. **Semantic.** Values switch per theme class: `.electron-light` / `.electron-dark` set `--color-background-surface`, `--color-text-foreground` and `--color-border*` (asar-observed).
3. **Component.** Scoped token families: `--markdown-*`, `--diffs-*`, `--composer-*`, `--codex-diffs-*` (asar-observed).
4. **Platform axis.** `[data-codex-window-type=…]` swaps whole ramps, e.g. `--text-sm: 13px` for electron and `--radius-lg-base: .5rem` for browser (asar-observed).

Throughout, features are enhanced step by step: `@supports (color-mix)` and `@supports (corner-shape)` override plain fallbacks (asar-observed). Layer order is `theme` → `base` → `components` → `utilities`: 48 / 53 / 307 / 6593 rule groups (asar-observed count).

**mdpro today: a flat two-theme-file model.**
- **Structure.** A `:root` default block (`src/styles/globals.css:1`) plus `.theme-light` (`src/styles/themes/light.css:1`) and `.theme-dark` (`src/styles/themes/dark.css:1`) override blocks. The theme class is set in `src/App.tsx:452`.
- **No primitive tier.** Each theme file holds final values.
- **Semantic aliases exist,** e.g. `src/styles/themes/light.css:25-26` point at other tokens.
- **Soft variants already use `color-mix()`** (`src/styles/themes/light.css:9`), which is the same move as Codex's alpha tier.
- **Duplication.** `:root` repeats the light values (`src/styles/globals.css:2-14`), so two files must stay in sync.

| Concern | apps-sdk-ui | Codex app | mdpro |
|---|---|---|---|
| Theme switch | `color-scheme` + `light-dark()` (sdk-ui globals.css:20-22) | root class + `color-scheme` + media fallback (asar-observed) | root class only (`src/App.tsx:452`) |
| Primitive scale | yes | yes (compiled) | no |
| Alpha-from-foreground | `--alpha-*` ramp | `color-mix(... foreground N%)` | only for accent and danger soft variants (`src/styles/themes/light.css:9-11`) |
| Component tier | yes | yes | ad hoc (settings tokens, `src/styles/themes/light.css:17-22`) |
| Fallbacks for new CSS functions | n/a | `@supports` wrappers | none |

**Takeaway for mdpro.** Adopting the *semantics* does not require leaving mdpro's convention. The useful parts are: derive borders, hovers and focus from `--color-text` / `--color-accent` with `color-mix()`; set `color-scheme` on the theme class; and keep a tiny primitive tier optional. `[data-theme]` and `light-dark()` are not proposed (inferred; see section 8).

The running app supports this model. Its Appearance settings define each theme with just Background, Foreground, Accent, Contrast, fonts and a translucent-sidebar switch, and the rest renders as derived neutrals (screenshot-measured, section 2.11). mdpro's existing `--color-bg` / `--color-text` / `--color-accent` can play the same "base" role without a new tier (inferred).

## 4. Gap table

| # | Dimension | Codex (tagged) | mdpro today (path:line only, no value) | Gap | Severity |
|---|---|---|---|---|---|
| G1 | Source-mode font | Code and diffs are set in `var(--font-mono)` (asar-observed) | `src/styles/globals.css:31`, `src/styles/globals.css:336` | Source mode inherits a proportional default, so pipe tables cannot align (canvas.json `note-sourcefont`) | high |
| G2 | Syntax / code palette | Add/delete colors swap per theme (`.electron-dark --color-editor-added: #40c9773b`, asar-observed) | `src/components/Editor/extensions/syntax.ts:3`, `src/components/Editor/extensions/dynamicExtensions.ts:46`, `src/components/common/settings/editorPrefApply.ts:186` | Unmodified CodeMirror default highlight with no dark variant; weakest contrast in the app (canvas.json `note-dark`) | high |
| G3 | Iconography | Lucide outline icons, size classes `14px` to `28px` (asar-observed) | `src/components/BottomTabs/BottomTabs.tsx:73`, `src/components/TabBar/Tab.tsx:76`, `src/components/common/SettingsDialog.tsx:30` | Text glyphs and emoji; multiple close characters | high |
| G4 | Accent translucency | Every soft fill is a token + color-mix (`--color-border-focus: color-mix(in oklab, var(--blue-300) 70%, transparent)`, asar-observed) | `src/styles/globals.css:1747`, `src/styles/globals.css:1032` | Hardcoded light-accent fill with no dark override (TOC active, shortcut editing) | high |
| G5 | Border derivation | Three foreground-alpha tiers, light `5%/8%/12%` (asar-observed) | `src/styles/themes/light.css:7`, `src/styles/themes/dark.css:7` | One fixed per-theme border literal; no subtle/strong tiers | med |
| G6 | Elevation | `.5px` outline ring + faint shadows; inner edge in dark (asar-observed) | `src/styles/globals.css:15` | Single shadow declared only in `:root`, no dark override, no hairline | med |
| G7 | Focus color | `--color-border-focus` per theme (asar-observed) | `src/styles/globals.css:572`, `src/styles/globals.css:648` | Only two `:focus-visible` rules in `src/**/*.css`; no focus-color token | med |
| G8 | Motion | Named curves, `.15s` default, 21 `reduce` + 33 `no-preference` media groups (asar-observed) | `src/styles/globals.css:1629`, `src/styles/globals.css:1739` | Ad hoc durations; no `prefers-reduced-motion` query anywhere in `src/`, though DESIGN.md:70 requires it | med |
| G9 | Chrome type ramp | Tokenized `--text-xs: 12px` / `--text-sm: 13px` in electron (asar-observed) | `src/styles/globals.css:122` | Chrome font sizes are literals repeated far past the rule of three; no ramp tokens | med |
| G10 | `color-scheme` | Set on `.electron-light` / `.electron-dark` (asar-observed) | `src/styles/themes/dark.css:1`, `src/App.css:98` | Never declared, so native scrollbars and form controls may stay light in dark theme (inferred; verify in WKWebView) | med |
| G11 | Radii | Base scale × `--corner-radius-scale`; superellipse (asar-observed) | `src/styles/globals.css:478`, `src/styles/globals.css:825`, `src/components/BottomTabs/BottomTabs.css:102` | Literal radii from DESIGN.md's scale, no semantic radius tokens | low |
| G12 | Hover fills | Ghost-hover alpha tier `light-dark(var(--alpha-08), var(--alpha-12))` (sdk-ui variables-semantic.css:98) | `src/styles/globals.css:1632`, `src/styles/globals.css:1742` | No shared hover token (rule 34 recommends the inline pattern) | low |
| G13 | Code / diff surface | `color-mix(in srgb, var(--color-surface) 94%, var(--color-text))` (asar-observed) | `src/styles/themes/light.css:14`, `src/styles/themes/dark.css:14`, `src/components/Editor/MilkdownEditor.css:102` | Code background is a separate fixed literal, not derived from the surface | low |
| G14 | Neutral hue | Untinted grays, e.g. `--gray-900: #181818` (asar-observed) | `src/styles/themes/dark.css:2`, `src/styles/themes/light.css:3` | Neutral hue differs from Codex; a taste choice, not a defect | low |
| G15 | Window chrome | Toolbar drawn in web content, `46px`, `no-drag` buttons (asar-observed) | `src/App.tsx:1127`, `src/styles/globals.css:231`, `src-tauri/tauri.conf.json:22` | Same architecture (overlay title bar + drag region); height and density are a product choice | low |
| G16 | Token tiers | Primitive → semantic → component (sdk-ui index.css:3-8) | `src/styles/globals.css:1`, `src/styles/themes/light.css:1` | Flat model; `:root` duplicates the light values | low |
| G17 | Prose line height | Markdown `--leading-relaxed: 1.625` (asar-observed) | `src/styles/globals.css:33` | Comparable and user-controlled; no action | low |

**Top 3:**
- **G1 + G2:** source mode is proportional and syntax colors are not themed.
- **G3:** no icon system.
- **G4:** hardcoded accent fills that break dark mode.

**What the screenshots change (section 2.11).**
- **Ranking: unchanged.** The top 3 above still hold.
- **G4 and G7 detail.**
  - Codex keeps saturated blue for controls: switches, sliders, unread dots (#3b84f7) and links (#2c67c5) (screenshot-measured).
  - Primary emphasis is the foreground color (screenshot-measured).
  - So a mdpro accent-soft fill should stay rare, which supports P2 as scoped.
- **G5.**
  - Rendered borders are one quiet neutral, #ededed / #353535 (screenshot-measured).
  - That is consistent with a single border tier for most dividers. `--color-border-subtle` stays optional.
- **G15.** Measured chrome density is 46pt title bar, 28pt buttons, 30pt rows (screenshot-measured). Treat it as a reference point for the density decision in section 8, not as a target.

## 5. DESIGN.md compatibility

Anchors in DESIGN.md:
- "The memorable thing": the editor **respects the file** (DESIGN.md:35-43).
- Aesthetic register: quiet, system-native, minimal decoration, single accent (DESIGN.md:57-71).

Canvas directions, as described in `docs/design/mdpro-ui-old/DirectionA/B/C.dc.html`:
- **A — Quiet paper:** chrome drops to tone and space.
- **B — Command surface:** keyboard-first, denser, mono readouts.
- **C — Focus canvas:** chrome appears on demand.

| # | Proposed direction | "Memorable thing" | Aesthetic register | Canvas | Verdict |
|---|---|---|---|---|---|
| P1 | Foreground-alpha borders, hover and focus tokens (G5, G7, G12) | Neutral | **Agrees.** Hairline borders and minimal decoration (DESIGN.md:62) | A, C | Compatible |
| P2 | Fix hardcoded accent fills with `--color-accent-soft` (G4) | Neutral | **Agrees.** Single accent + soft variant (DESIGN.md:111, :113) | A, B, C | Compatible |
| P3 | Hairline ring folded into the single `--shadow-soft`, plus a dark override (G6) | Neutral | **Agrees.** It stays one shadow token (DESIGN.md:69) | A | Compatible |
| P4 | Outline icon set replacing text glyphs and emoji (G3) | Neutral | **Agrees.** "No emoji as design" (DESIGN.md:80); functional labels | B, C | Compatible (new dependency, see section 7) |
| P5 | Motion tokens + `prefers-reduced-motion` (G8) | Neutral | **Agrees.** "Respect `prefers-reduced-motion`" (DESIGN.md:70) | C | Compatible |
| P6 | Mono default for Source mode (G1) | **Agrees** (DESIGN.md:37-43) | Revises DESIGN.md:47-49 | B | **Decided 2026-09-11: hybrid**, see below |
| P7 | Restrained syntax palette with one non-accent hue for code (G2) | Neutral | Conflicts with single accent | B | **Decided 2026-09-11: no code hue**, see below |
| P8 | Chrome type-ramp tokens (G9) | Neutral | **Agrees.** Tokens introduced by rule of three (DESIGN.md:67, :112) | A, B | Compatible, optional |
| P9 | `color-scheme` on theme classes (G10) | Neutral | **Agrees.** System-native (DESIGN.md:61) | all | Compatible |
| P10 | Untinted neutrals like Codex (G14) | Neutral | Not required by the register | A | **Decided 2026-09-11: keep current neutrals**, see below |

The three decisions below were made by the owner on 2026-09-11 after consulting Codex. The positions are kept for the record.

**P6 — decided: hybrid mono Source mode.**
- **Decision.** New installs default Source mode to mono. A new "Source font" preference (Monospace | Follow editor font) keeps existing profiles on the editor font.
  - The preference is needed because `fontFamily: "system"` (`src/types/preferences.ts:284`) cannot tell an untouched default from an explicit choice, so an upgrade must not change fonts silently.
  - The user's editor size and line height are kept.
  - CJK falls back to the system CJK face, so tables that contain CJK still won't align exactly.
- **Position 1 (keep today's parity).** DESIGN.md:47-49 says Source mode is a peer to WYSIWYG "with the same fonts". A proportional source view honors that sentence literally, and the editor font is the user's call (DESIGN.md:66).
- **Position 2 (mono source).** "Respects the file" (DESIGN.md:37-43) is better served when the raw file's structure is visible: aligned pipe tables and exact whitespace. Codex sets all code and diff text in mono (asar-observed `--diffs-font-family: var(--font-mono)`). This would change DESIGN.md:47-49 and the runtime-token list in `.claude/rules/31-design-tokens.md:95-98`.

**P7 — decided: position 1, no code hue.**
- **Decision.** Markers use accent, meta uses muted, code uses text. Green already signals success (`src/styles/globals.css:1842`) and diff additions, so a green code hue would carry two meanings. Code stays distinguishable through fences, the code background and the mono face.
- **Position 1.** The register allows "One accent color" (DESIGN.md:62), and the decisions log says "Multiple accents create implicit hierarchy" (DESIGN.md:111). Syntax colors should then use only accent, muted and text.
- **Position 2.** Syntax color is content annotation, not UI hierarchy. The TUI guide itself allows green, red and cyan as semantic colors (tui-guide styles.md:10-12), and one restrained code hue improves scanning.

Section 6 shows both options: two tokens alias existing ones, and one adds the new hue.

**P10 — decided: position 1, keep the current cool neutral family.**
- **Decision.** No neutral base value changes. The derived mechanics in P1 (text-mixed borders and hover) are still adopted. Untinted grays would move from borrowing Codex's mechanics to copying its look, at a large QA cost.
- **Position 1.** Keep mdpro's current neutral family. It is part of mdpro's own identity, and copying Codex's pure grays risks borrowing its distinctive look (constraint: no product-identity copying).
- **Position 2.** Untinted neutrals read as more "system-native" (DESIGN.md:61) and let the blue accent carry all the color.

As decided above, this doc proposes **no** neutral base value change.

## 6. Proposed token changes

Conventions for this table:
- **Placement.** Theme-dependent tokens go in both `.theme-light` (`src/styles/themes/light.css`) and `.theme-dark` (`src/styles/themes/dark.css`), with `:root` defaults in `src/styles/globals.css` (rule 31). Tokens that don't depend on the theme go only in `:root`; both columns show the same value.
- **Excluded by design.** No `[data-theme]`. No `light-dark()` (support on the macOS 13 WebView is unverified, inferred; see section 8). No `corner-shape`. No OpenAI font.
- **Documentation.** Each new token needs a DESIGN.md decisions-log entry when implemented (rule 31 authoring rule 4).

| mdpro token | light value | dark value | inspired by (tagged source) | affected files |
|---|---|---|---|---|
| `--color-accent-soft` (existing) | `color-mix(in srgb, var(--color-accent) 14%, transparent)` | `color-mix(in srgb, var(--color-accent) 22%, transparent)` | Derive from the base token instead of repeating a hex (rule 31 authoring rule 3, inferred). Soft-alpha tier `light-dark(var(--alpha-08), var(--alpha-12))` (sdk-ui variables-semantic.css:74) | `src/styles/themes/light.css`, `src/styles/themes/dark.css`, `src/styles/globals.css` (`:root`; migrate consumers at `:1747`, `:1032`) |
| `--color-border` (existing) | `color-mix(in srgb, var(--color-text) 10%, transparent)` | `color-mix(in srgb, var(--color-text) 12%, transparent)` | Foreground-alpha borders `color-mix(in oklab, var(--color-text-foreground) 8%, transparent)` (asar-observed); `light-dark(var(--alpha-10), var(--alpha-12))` (sdk-ui variables-semantic.css:406). Percentages are mdpro's choice (inferred) | `src/styles/themes/light.css`, `src/styles/themes/dark.css`, `src/styles/globals.css`; audit consumers that use it as a *fill* |
| `--color-border-subtle` (new, optional) | `color-mix(in srgb, var(--color-text) 6%, transparent)` | `color-mix(in srgb, var(--color-text) 7%, transparent)` | Light border tier 5% light / `#ffffff0a` dark (asar-observed); `--color-border-subtle` (sdk-ui variables-semantic.css:405). **Justification:** dividers inside a pane (TOC rows, settings rows) should be quieter than pane edges; add only once 3+ sites need it (rule of three) | theme files, `src/styles/globals.css` |
| `--color-hover` (new) | `color-mix(in srgb, var(--color-text) 5%, transparent)` | `color-mix(in srgb, var(--color-text) 8%, transparent)` | Ghost hover `light-dark(var(--alpha-08), var(--alpha-12))` (sdk-ui variables-semantic.css:98); inline pattern in `.claude/rules/34-dark-theme.md:56` (mdpro-observed). **Justification:** rule 34 says a pattern repeated 3+ times becomes a token | theme files, `src/styles/globals.css` (`:1632`, `:1742` and other `:hover` fills) |
| `--color-focus-ring` (new) | `color-mix(in srgb, var(--color-accent) 70%, transparent)` | `color-mix(in srgb, var(--color-accent) 70%, transparent)` | `.electron-dark --color-border-focus: color-mix(in oklab, var(--blue-300) 70%, transparent)` (asar-observed); uses mdpro's own accent, not OpenAI blue. **Justification:** one color source for all four focus patterns in rule 33 | theme files, `src/styles/globals.css` (`:572`, `:648`), `.claude/rules/33-focus-indicators.md` |
| `--shadow-soft` (existing; add theme overrides) | `0 0 0 0.5px color-mix(in srgb, var(--color-text) 12%, transparent), 0 8px 24px color-mix(in srgb, var(--color-text) 8%, transparent)` | `0 0 0 0.5px color-mix(in srgb, var(--color-text) 16%, transparent), 0 8px 24px color-mix(in srgb, black 45%, transparent)` | `--elevation-stroke: 0 0 0 .5px var(--color-border-strong)` + faint diffuse layers (asar-observed). Still one token, per DESIGN.md:69 (mdpro-observed) | `src/styles/globals.css:15` plus both theme files; consumers `src/styles/globals.css:421`, `:480`, `:510`, `:830`, `:867` |
| `--source-font-family` (new, P6 decided: hybrid) | `var(--font-mono)` | `var(--font-mono)` | `--diffs-font-family: var(--font-mono)` (asar-observed). **Justification:** separates the Source-mode default from the prose editor font. A new `sourceFont` preference (Monospace \| Follow editor font) selects it: fresh profiles get Monospace, existing profiles get Follow editor font | `src/styles/globals.css` (`:336`), `src/components/common/settings/editorPrefApply.ts`, `src/types/preferences.ts`, `src-tauri/src/models/preferences.rs`, `.claude/rules/31-design-tokens.md:95-98` |
| `--color-syntax-markup` (new) | `var(--color-accent)` | `var(--color-accent)` | Few semantic colors; cyan for markers and status (tui-guide styles.md:10). Computed contrast against the editor background is 5.17:1 light / 7.43:1 dark (inferred; computed from `src/styles/themes/light.css:12`, `src/styles/themes/dark.css:12`). **Justification:** heading, list and quote markers need a themed color; this aliases the existing accent, so no new hue | theme files, `src/components/Editor/extensions/syntax.ts`, `src/components/Editor/extensions/dynamicExtensions.ts`, `src/components/common/settings/editorPrefApply.ts` |
| `--color-syntax-meta` (new) | `var(--color-muted)` | `var(--color-muted)` | "Secondary text: Use `dim`" (tui-guide styles.md:5). Contrast 4.83:1 light / 7.49:1 dark (inferred, computed as above). **Justification:** URLs, link targets, HTML and comments recede; aliases an existing token | same as above |
| `--color-syntax-code` (**not adopted**: P7 decided, no code hue; kept for the record) | `#2f6f4f` | `#6fcf97` | Same hue family as the additions green `--green-500: #00a240` / `--green-300: #40c977` (asar-observed); values are mdpro's own. Contrast 5.99:1 on the editor background and 5.44:1 on the code background (light); 9.94:1 and 8.38:1 (dark) (inferred, computed). **Justification:** inline and fenced code need one hue distinct from markers (accent) and links (muted) so code spans stay scannable in Source mode | same as above |
| `--motion-duration-fast` (new, `:root`) | `150ms` | `150ms` | `--default-transition-duration: .15s` (asar-observed); `--transition-duration-basic: 150ms` (sdk-ui variables-semantic.css:518). **Justification:** 7 `transition` declarations in `src/styles/globals.css` pass the rule of three. Set to `0ms` under `prefers-reduced-motion: reduce` | `src/styles/globals.css` (`:639`, `:1335`, `:1347`, `:1423`, `:1629`, `:1667`, `:1739`) |
| `--motion-ease-out` (new, `:root`) | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Named enter curve `--cubic-enter: cubic-bezier(.19, 1, .22, 1)` (asar-observed; sdk-ui variables-semantic.css:514). mdpro's own softer curve (inferred). **Justification:** pairs with `--motion-duration-fast` at the same 7 transition sites, so hover and entrance motion share one curve | `src/styles/globals.css` |
| `--font-size-ui-sm` / `--font-size-ui` / `--font-size-ui-lg` (new, optional, `:root`) | `12px` / `13px` / `14px` | `12px` / `13px` / `14px` | Electron ramp `--text-xs: 12px`, `--text-sm: 13px`; `--text-base: 14px` (asar-observed). **Justification:** chrome font-size literals repeat far past the rule of three (grep `font-size:` in `src/styles/globals.css`) | `src/styles/globals.css`, `src/components/BottomTabs/BottomTabs.css` |
| `--radius-control` / `--radius-popover` (new, optional, `:root`) | `6px` / `10px` | `6px` / `10px` | `--control-radius-md: var(--radius-md)` (sdk-ui variables-semantic.css:498); `--menu-radius: var(--radius-xl)` (sdk-ui variables-components.css:133). Values picked from mdpro's documented scale at DESIGN.md:68 (mdpro-observed). **Justification:** gives each radius a purpose, not just a value | `src/styles/globals.css` (`:478`, `:825`), `src/components/BottomTabs/BottomTabs.css:102` |
| `--icon-size-sm` / `--icon-size-md` (new, only with P4, `:root`) | `14px` / `16px` | `14px` / `16px` | `.icon-2xs` `14px`, `.icon-xs` `16px` (asar-observed). **Justification:** one size source for the new icon component | new `src/components/common/Icon.tsx` (or similar), `src/styles/globals.css` |

**Not a token, but part of the change set:** add `color-scheme: light;` inside `.theme-light` and `color-scheme: dark;` inside `.theme-dark` (G10). This is the pattern `.electron-light`/`.electron-dark` use (asar-observed).

**Optional, not a prerequisite:** a `--space-*` scale based on `--spacing: .25rem` multiples (asar-observed). Rule 31 defers this until the rule of three is met (`.claude/rules/31-design-tokens.md:71-76`). Nothing above depends on it.

## 7. Prioritized polish backlog

This list is descriptive only; nothing has been implemented. Every item must be QA'd in both themes (rule 34). Every new token needs entries in both theme files and in the DESIGN.md decisions log (rule 31).

1. **Theme the accent fills and add `color-scheme`.** Replace the two hardcoded accent fills with `--color-accent-soft`, and declare `color-scheme` on both theme classes.
   - Files: `src/styles/globals.css`, `src/styles/themes/light.css`, `src/styles/themes/dark.css`.
   - Effort: **S**. Closes **G4, G10**.
2. **Mono Source default for new installs (P6 decided: hybrid).** Add `--source-font-family` and a `sourceFont` preference (Monospace | Follow editor font).
   - Default: a missing field deserializes to Follow editor font, so existing profiles don't change; the first-run profile writes Monospace.
   - Check before landing: scroll and selection mapping across mode switches, plus CJK, emoji, tabs and full-width punctuation.
   - Files: `src/styles/globals.css`, `src/components/common/settings/editorPrefApply.ts`, `src/types/preferences.ts`, `src-tauri/src/models/preferences.rs`, the Settings dialog, `.claude/rules/31-design-tokens.md`.
   - Effort: **M**. Closes **G1**.
3. **Themed syntax highlighting.** Replace `defaultHighlightStyle` with an mdpro `HighlightStyle` that reads `--color-syntax-*` variables, so the dark swap happens automatically. P7 is decided: no code hue, and code uses `--color-text`. Keep the One Dark path consistent (`src/components/common/settings/editorPrefApply.ts:183-186`).
   - Files: `src/components/Editor/extensions/syntax.ts`, `src/components/Editor/extensions/dynamicExtensions.ts`, `src/components/common/settings/editorPrefApply.ts`, both theme files.
   - Effort: **M**. Closes **G2**.
4. **Icon system.** Add `lucide-react` (ISC; `sideEffects: false` at `packages/lucide-react/package.json:29`, so icons tree-shake one by one; the source SVG for `x` is 260 B; final bundle cost is `unknown — needs measurement`). Add one `Icon` wrapper using `--icon-size-*`, and replace the text close glyphs and settings-nav emoji.
   - Files: `package.json`, new `src/components/common/Icon.tsx`, `src/components/BottomTabs/BottomTabs.tsx`, `src/components/common/SettingsDialog.tsx`, `src/components/TabBar/Tab.tsx` (canvas.json `note-shell` says TabBar may be dead code; confirm before editing).
   - Effort: **M**. Closes **G3**.
5. **Foreground-alpha borders, hover and focus tokens.** Retune `--color-border`, add `--color-hover` and `--color-focus-ring`, and migrate `:hover` / `:focus-visible` sites.
   - Files: both theme files, `src/styles/globals.css`, `.claude/rules/33-focus-indicators.md`.
   - Effort: **M**. Closes **G5, G7, G12**.
6. **Elevation.** Add the hairline ring and a dark override inside `--shadow-soft`.
   - Files: `src/styles/globals.css`, both theme files.
   - Effort: **S**. Closes **G6**.
7. **Motion tokens and reduced motion.** Add `--motion-duration-fast` and `--motion-ease-out`, plus one `@media (prefers-reduced-motion: reduce)` block.
   - Files: `src/styles/globals.css`.
   - Effort: **S**. Closes **G8**.
8. **Chrome type-ramp tokens (optional).** Migrate literal chrome font sizes.
   - Files: `src/styles/globals.css`, `src/components/BottomTabs/BottomTabs.css`, other component CSS.
   - Effort: **L**. Closes **G9**.
9. **Semantic radius tokens (optional).**
   - Files: `src/styles/globals.css`, `src/components/BottomTabs/BottomTabs.css`, `src/components/Editor/MilkdownEditor.css`.
   - Effort: **M**. Closes **G11**.
10. **Derive the code-block surface from the surface token (optional).** Use `color-mix()` instead of a separate literal.
    - Files: both theme files, `src/components/Editor/MilkdownEditor.css`.
    - Effort: **S**. Closes **G13**.
11. **Token-tier cleanup (optional, lowest).** Stop duplicating light values in `:root`, or document why they stay.
    - Files: `src/styles/globals.css`.
    - Effort: **S**. Closes **G16**.

Deliberately not in the backlog: G14 (P10 decided: keep current neutrals), G15 (a product-density choice) and G17 (no gap).

## 8. Open questions & risks

**Unsourced or unverifiable values**
- **Screenshot coverage.**
  - **Measured in section 2.11:** row heights, sidebar width, traffic-light offsets and density.
  - **Still `unknown — needs measurement`:**
    - whether Codex animates theme switches
    - the row-level diff view
    - the dark review panel
  - **Caveats:**
    - Rendered colors depend on the user's Appearance settings, including Contrast.
    - Other accounts or settings may render differently.
    - Pixel reads include anti-aliasing, so ±1–2 RGB units is noise.
- **Unattributable strings.** `--text-primary` / `--border` hex pairs and `--codex-base-*` appear only in archive strings (asar-strings). They may be dead code or injected at runtime; do not treat them as the live palette.
- **OpenAI Sans usage.** The surfaces that actually use `--font-openai-sans` are `unknown — needs measurement`.
- **Guideline quotes.** They came through a summarizing fetcher. Re-verify wording before quoting outside this doc.
- **Contrast ratios in section 6.** They were computed from mdpro's current theme files at `0a3675e` and will drift if those values change. Re-run before implementing.

**Platform support (mdpro's WebView is WebKit via wry: `src-tauri/Cargo.lock:6166`)**
- **`light-dark()`.** Per MDN BCD (`f0e862b`), Safari has supported it since 17.5 (inferred, third-party compat data). On macOS 13 the system WebKit version depends on which Safari/WebKit update the user installed, and the minimum build mdpro supports is not pinned. **Not proposed**; verify on a clean macOS 13 machine first.
- **`color-mix()`.** Safari has supported it since 16.2 (same source). mdpro already depends on it (`src/styles/themes/light.css:9`) without fallbacks, whereas Codex wraps it in `@supports` (asar-observed). Whether every supported macOS 13.x ships WebKit ≥ 16.2 is `unknown — needs measurement`. This risk already exists; the proposals widen it.
- **`corner-shape: superellipse()`.** WKWebView support is `unknown — needs measurement`. Not proposed.
- **`color-scheme` side effects.** Whether it changes scrollbar or form-control rendering inside the Tauri window: `unknown — needs measurement`.
- **Retuning `--color-border` to a translucent value.** Any site using `--color-border` as a background fill will become see-through. Audit consumers first.

**Product decisions**
- **P6, P7, P10:** decided by the owner on 2026-09-11 (section 5, and the DESIGN.md decisions log).
- **Density (still open):** whether to move chrome toward Codex's compact type ramp and toolbar density (G9, G15). This leans toward canvas direction B, which the canvas itself calls "denser and busier".

**Licensing**
- **OpenAI Sans.** Bundled inside a proprietary app. No license file was found in the areas read, and it is not listed as reusable. **Do not bundle or reference it.** Its license is unverified.
- **Codex CSS.** Proprietary. This doc quotes individual token names and values as evidence only. No files, fonts, icons or logos were copied, and the proposed values are mdpro's own. Whether quoting even individual values is acceptable is an assumption the owner may tighten.
- **apps-sdk-ui.** MIT: license-clean as a reference, but values should still be mdpro's own choices, not a wholesale transplant.
- **Lucide.** ISC (`LICENSE` at `5d592a9`). Final bundle-size impact: `unknown — needs measurement`.
- **openai-apps-sdk-examples and MDN BCD.** Their licenses were not checked. They are cited only as evidence.

**Process risks**
- **DESIGN.md only logs the decisions so far.** Its log records P6, P7 and P10, but no tokens are implemented. Any adopted token needs both theme files, a DESIGN.md decisions-log entry, and possibly an update to the runtime-token list in rule 31.
- **TabBar may be dead code** (canvas.json `note-shell`). Confirm which tab component actually mounts before migrating glyphs.
