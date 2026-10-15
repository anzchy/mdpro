/**
 * D158: the Source editor ran CodeMirror's LIGHT theme in the app's dark theme.
 *
 * Root cause, as pinned here:
 *   1. `Editor.tsx` passes no `theme` to `@uiw/react-codemirror`, whose default
 *      is `"light"`: it appends its `defaultLightThemeOption`
 *      (`EditorView.theme({ "&": { backgroundColor: "#fff" } }, { dark: false })`)
 *      and wraps the editor in `.cm-theme-light`, whatever the app theme.
 *   2. Nothing sets `EditorView.darkTheme`, so CodeMirror's base themes (view,
 *      search, autocomplete, lint) always pick their `&light` rules: a
 *      `#e2f2ff` active-line gutter, a `#f5f5f5` / black search panel with
 *      white text fields and light gradient buttons, `#f5f5f5` tooltips, light
 *      search-match colours. mdpro's CSS overrode none of those.
 *   (`theme="none"` alone would not fix 2: it only drops @uiw's `#fff`.)
 *
 * Mounts the REAL `Editor` (real `<CodeMirror>` wrapper and extensions) in both
 * app themes; only the Tauri boundary is mocked.
 *
 * What these tests cannot prove: jsdom has no layout or painting. They pin the
 * configuration (the dark-theme facet follows the app theme, live; @uiw's light
 * theme is gone; the chrome rules use tokens defined in both theme files and
 * out-rank every rule CodeMirror and oneDark generate for the same element and
 * property) — not contrast or how it looks. The device check covers that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: vi.fn(async () => null) }),
);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { openLintPanel, setDiagnostics } from "@codemirror/lint";
import { gotoLine } from "@codemirror/search";
import { codeThemeCompartment } from "../src/components/Editor/extensions/dynamicExtensions";
import { useThemeStore, type ResolvedTheme } from "../src/stores/themeStore";
import { readAppCssFile } from "../src/test/appCss";
import { mountEditor, teardownEditor } from "./support/mountSourceEditor";
import {
  type CssRule,
  codemirrorCss,
  compareSpecificity,
  lastCompound,
  parseRules,
  specificity,
} from "./support/cssRules";
import { CSS_NAMED_COLORS, colourLiterals } from "./support/cssNamedColors";

const DOC = "# Title\n\nSome text\n";

/** Editor chrome CodeMirror's base theme colours per light/dark and mdpro must own. */
const CHROME = ["cm-activeLineGutter", "cm-panels", "cm-textfield", "cm-button", "cm-tooltip"];

function mountIn(theme: ResolvedTheme): EditorView {
  useThemeStore.setState({ resolvedTheme: theme });
  return mountEditor(DOC);
}

const isDark = (view: EditorView): boolean => view.state.facet(EditorView.darkTheme);

const sourceCss = (): CssRule[] => parseRules(readAppCssFile("sections/editor-source.css"));

/** The `cm-*` class tokens of a compound selector (CodeMirror's `ͼ` scope classes excluded). */
const cmClasses = (compound: string): string[] =>
  Array.from(compound.matchAll(/\.(cm-[\w-]+)/g), (m) => m[1]);

/** Property families: a shorthand and its longhands set the same thing. */
function family(prop: string): string {
  if (prop.startsWith("background")) return "background";
  if (prop.startsWith("border")) return "border";
  return prop;
}

/** App rules in editor-source.css whose element is one of the CHROME classes. */
function appChromeRules(): Array<{ selector: string; rule: CssRule }> {
  const out: Array<{ selector: string; rule: CssRule }> = [];
  for (const rule of sourceCss()) {
    for (const selector of rule.selectors) {
      if (cmClasses(lastCompound(selector)).some((c) => CHROME.includes(c))) {
        out.push({ selector, rule });
      }
    }
  }
  return out;
}

beforeEach(() => {
  useThemeStore.setState({ resolvedTheme: "light" });
});

afterEach(() => {
  teardownEditor();
  useThemeStore.setState({ resolvedTheme: "light" });
});

describe("D158 — Source editor theme follows the app theme", () => {
  it("dark app theme: CodeMirror runs its dark base theme", () => {
    const view = mountIn("dark");
    expect(isDark(view)).toBe(true);
  });

  it("light app theme: CodeMirror runs its light base theme", () => {
    const view = mountIn("light");
    expect(isDark(view)).toBe(false);
  });

  it("follows a live app-theme switch on the same editor, without a remount", () => {
    const view = mountIn("light");
    act(() => useThemeStore.setState({ resolvedTheme: "dark" }));
    expect(view.dom.isConnected).toBe(true);
    expect(isDark(view)).toBe(true);
    act(() => useThemeStore.setState({ resolvedTheme: "light" }));
    expect(isDark(view)).toBe(false);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`${theme} app theme: no @uiw light theme on the editor`, () => {
      const view = mountIn(theme);
      expect.soft(view.dom.parentElement?.classList.contains("cm-theme-light")).toBe(false);
      // No injected rule that targets only the editor root (by classes it carries)
      // paints a hard-coded white background — @uiw's defaultLightThemeOption.
      const rootClasses = new Set(Array.from(view.dom.classList));
      const whiteRoot = parseRules(codemirrorCss()).filter(
        (r) =>
          /^#fff(fff)?$/i.test(r.decls.get("background-color") ?? r.decls.get("background") ?? "") &&
          r.selectors.some((s) => {
            const classes = s.match(/^(\.[^\s.:>+~[]+)+$/)?.[0].split(".").filter(Boolean);
            return classes !== undefined && classes.every((c) => rootClasses.has(c));
          }),
      );
      expect.soft(whiteRoot.map((r) => r.selectors.join(", "))).toEqual([]);
    });
  }

  it("every chrome element has an app rule painting it with theme tokens", () => {
    const rules = appChromeRules();
    for (const cls of CHROME) {
      const own = rules.filter(({ selector }) => cmClasses(lastCompound(selector)).includes(cls));
      const painted = own.filter(({ rule }) => rule.decls.has("background"));
      expect(painted, `no app background rule for .${cls}`).not.toHaveLength(0);
    }
    for (const { selector, rule } of rules) {
      expect(selector.startsWith(".editor-shell "), selector).toBe(true);
      for (const [prop, value] of rule.decls) {
        if (!/^(background|color|border)/.test(prop)) continue;
        expect(value, `${selector} { ${prop} }`).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b|\bwhite\b|\bblack\b/i);
        if (prop === "background" || prop === "color") {
          expect(value, `${selector} { ${prop} }`).toMatch(/var\(--color-[\w-]+\)/);
        }
      }
    }
    // Panels and tooltips carry text: they set a text colour as well.
    for (const cls of ["cm-panels", "cm-tooltip", "cm-textfield", "cm-button"]) {
      const colored = rules.filter(
        ({ selector, rule }) => cmClasses(lastCompound(selector)).includes(cls) && rule.decls.has("color"),
      );
      expect(colored, `no app text colour for .${cls}`).not.toHaveLength(0);
    }
  });

  it("the search panel's close button inherits a token text colour", () => {
    // The close "×" is a plain <button name="close">: the UA's ButtonText colour
    // would be near-black on a dark panel.
    const close = sourceCss().filter((r) =>
      r.selectors.some((s) => s.startsWith(".editor-shell ") && /\[name="?close"?\]$/.test(lastCompound(s))),
    );
    expect(close).not.toHaveLength(0);
    for (const r of close) expect(r.decls.get("color")).toMatch(/^(inherit|var\(--color-[\w-]+\))$/);
  });

  it("app chrome rules out-rank every CodeMirror and oneDark rule for the same element and property", () => {
    const view = mountIn("dark");
    // Inject oneDark's rules too, the way the Code theme preference does.
    act(() => view.dispatch({ effects: codeThemeCompartment.reconfigure(oneDark) }));
    const cmRules = parseRules(codemirrorCss());
    const app = appChromeRules();
    for (const cls of CHROME) {
      // The probe must see CodeMirror's own rule for each element, or it is blind.
      const seen = cmRules.some((r) =>
        r.selectors.some((s) => cmClasses(lastCompound(s)).includes(cls)),
      );
      expect(seen, `CodeMirror generated no rule for .${cls}`).toBe(true);
    }
    const losses: string[] = [];
    for (const { selector: appSel, rule: appRule } of app) {
      const appEl = cmClasses(lastCompound(appSel));
      const appFamilies = new Set(Array.from(appRule.decls.keys(), family));
      for (const cm of cmRules) {
        const cmFamilies = new Set(Array.from(cm.decls.keys(), family));
        if (![...cmFamilies].some((f) => appFamilies.has(f))) continue;
        for (const cmSel of cm.selectors) {
          const cmEl = cmClasses(lastCompound(cmSel));
          // Same element: CodeMirror's compound names no cm-class the app's lacks.
          if (cmEl.length === 0 || !cmEl.every((c) => appEl.includes(c))) continue;
          if (compareSpecificity(specificity(appSel), specificity(cmSel)) <= 0) {
            losses.push(`${appSel} does not out-rank ${cmSel}`);
          }
        }
      }
    }
    expect(app).not.toHaveLength(0);
    expect(losses).toEqual([]);
  });

  it("every token the chrome rules use is defined in both themes", () => {
    const light = readAppCssFile("themes/light.css");
    const dark = readAppCssFile("themes/dark.css");
    const used = new Set<string>();
    for (const { rule } of appChromeRules()) {
      for (const value of rule.decls.values()) {
        for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const root = readAppCssFile("globals.css");
    for (const token of used) {
      const inLight = light.includes(`${token}:`);
      const inDark = dark.includes(`${token}:`);
      // Either both theme files declare it, or neither does and the `:root`
      // default in globals.css serves both themes (e.g. --shadow-soft).
      // Exactly one theme file declaring it is the silent break rule 31 forbids.
      if (inLight || inDark) {
        expect(inLight, `${token} missing in light.css`).toBe(true);
        expect(inDark, `${token} missing in dark.css`).toBe(true);
      } else {
        expect(root, `${token} defined in neither theme nor globals.css :root`).toContain(`${token}:`);
      }
    }
  });

  it("the active line's gutter number is in the text colour (new DESIGN.md § Source mode)", () => {
    const gutter = appChromeRules().filter(({ selector }) => lastCompound(selector) === ".cm-activeLineGutter");
    expect(gutter.some(({ rule }) => rule.decls.get("color") === "var(--color-text)")).toBe(true);
  });

  it("the tooltip follows the popover contract: --shadow-soft, --radius-popover, panel fill", () => {
    const tip = appChromeRules().filter(({ selector }) => lastCompound(selector) === ".cm-tooltip");
    expect(tip.some(({ rule }) => rule.decls.get("box-shadow") === "var(--shadow-soft)")).toBe(true);
    expect(tip.some(({ rule }) => rule.decls.get("border-radius") === "var(--radius-popover)")).toBe(true);
    expect(tip.some(({ rule }) => rule.decls.get("background") === "var(--color-panel)")).toBe(true);
  });

  it("search field and buttons carry rule-33 focus patterns built from tokens", () => {
    const rules = sourceCss();
    const find = (re: RegExp) =>
      rules.filter((r) => r.selectors.some((s) => s.startsWith(".editor-shell ") && re.test(lastCompound(s))));
    // Pattern 1 (text input): accent border + 2px accent-soft ring, outline replaced.
    const field = find(/^\.cm-textfield:focus$/);
    expect(field).not.toHaveLength(0);
    for (const r of field) {
      expect(r.decls.get("border-color")).toBe("var(--color-accent)");
      expect(r.decls.get("box-shadow")).toBe("0 0 0 2px var(--color-accent-soft)");
      expect(r.decls.get("outline")).toBe("none");
    }
    // Pattern 2 (button): 2px focus-ring outline (DR15), offset 2px, keyboard only.
    const button = find(/^\.cm-button:focus-visible$/);
    expect(button).not.toHaveLength(0);
    for (const r of button) {
      expect(r.decls.get("outline")).toBe("2px solid var(--color-focus-ring)");
      expect(r.decls.get("outline-offset")).toBe("2px");
    }
    // Secondary button (new DESIGN.md § Buttons): panel fill, hairline, control radius,
    // a text-mix hover fill (stand-in for --color-hover), no invented :active state.
    const base = find(/^\.cm-button$/);
    expect(base.some((r) => r.decls.get("background") === "var(--color-panel)")).toBe(true);
    expect(base.some((r) => r.decls.get("border") === "1px solid var(--color-border)")).toBe(true);
    expect(base.some((r) => r.decls.get("border-radius") === "var(--radius-control)")).toBe(true);
    const hover = find(/^\.cm-button:hover$/);
    expect(
      hover.some((r) => r.decls.get("background") === "color-mix(in srgb, var(--color-text) 5%, transparent)"),
    ).toBe(true);
    expect(find(/^\.cm-button:active$/)).toHaveLength(0);
  });
});

/**
 * D158-WI-2 (audit follow-ups): chrome the first pass missed.
 *   - Go to Line's close "×" is `.cm-dialog-close`, not `[name="close"]`, so it
 *     kept the UA's near-black ButtonText on the dark panel.
 *   - With oneDark in the LIGHT app theme, an unfocused selected lint diagnostic
 *     sat on lint's `&dark` `#2e343e` row under mdpro's dark text (~1.39:1).
 * Selectors are matched against the real elements CodeMirror builds, so a rule
 * that names the wrong element fails here, not on the device.
 */
describe("D158-WI-2 — dialog close button and lint selection follow the app theme", () => {
  /** App rules in editor-source.css (under .editor-shell) whose element matches `re`. */
  const appRulesFor = (re: RegExp): Array<{ selector: string; rule: CssRule }> =>
    sourceCss().flatMap((rule) =>
      rule.selectors
        .filter((s) => s.startsWith(".editor-shell ") && re.test(s))
        .map((selector) => ({ selector, rule })),
    );

  const LINT_SELECTED = /\.cm-panel-lint ul(:focus)? \[aria-selected\]$/;
  const DIALOG_CLOSE = /\.cm-dialog-close$/;

  /** Mount with oneDark, a diagnostic and the lint panel open (the 1.39:1 setup). */
  function mountLintPanel(theme: ResolvedTheme): { view: EditorView; ul: HTMLElement; item: HTMLElement } {
    const view = mountIn(theme);
    act(() => view.dispatch({ effects: codeThemeCompartment.reconfigure(oneDark) }));
    act(() =>
      view.dispatch(setDiagnostics(view.state, [{ from: 0, to: 7, severity: "warning", message: "probe" }])),
    );
    act(() => {
      openLintPanel(view);
    });
    const ul = view.dom.querySelector<HTMLElement>(".cm-panel-lint ul");
    expect(ul, "lint panel list not rendered").not.toBeNull();
    const item = ul!.querySelector<HTMLElement>("[aria-selected]");
    expect(item, "no selected diagnostic in the lint panel").not.toBeNull();
    return { view, ul: ul!, item: item! };
  }

  it("Go to Line's close button gets a token text colour from a rule that reaches it", () => {
    const view = mountIn("dark");
    act(() => {
      gotoLine(view);
    });
    const close = view.dom.querySelector<HTMLElement>(".cm-dialog-close");
    expect(close, "Go to Line dialog has no .cm-dialog-close").not.toBeNull();
    const rules = appRulesFor(DIALOG_CLOSE);
    expect(rules).not.toHaveLength(0);
    for (const { selector, rule } of rules) {
      expect(close!.matches(selector), `${selector} does not match the real button`).toBe(true);
      expect(rule.decls.get("color")).toMatch(/^(inherit|var\(--color-[\w-]+\))$/);
    }
    // Every CodeMirror / oneDark rule for the button (none sets colour today) loses.
    const cm = parseRules(codemirrorCss()).flatMap((r) =>
      r.selectors.filter((s) => cmClasses(lastCompound(s)).includes("cm-dialog-close")),
    );
    expect(cm, "CodeMirror generated no rule for .cm-dialog-close").not.toHaveLength(0);
    for (const { selector } of rules) {
      for (const cmSel of cm) {
        expect(compareSpecificity(specificity(selector), specificity(cmSel)), `${selector} vs ${cmSel}`).toBeGreaterThan(0);
      }
    }
  });

  for (const theme of ["light", "dark"] as const) {
    it(`${theme} app theme + oneDark: the selected lint diagnostic is painted with tokens, focused or not`, () => {
      const { ul, item } = mountLintPanel(theme);
      const rules = appRulesFor(LINT_SELECTED);
      const unfocused = rules.filter(({ selector }) => !selector.includes(":focus"));
      const focused = rules.filter(({ selector }) => selector.includes(":focus"));
      expect(unfocused, "no app rule for the unfocused selected diagnostic").not.toHaveLength(0);
      expect(focused, "no app rule for the focused selected diagnostic").not.toHaveLength(0);
      for (const { rule } of rules) {
        expect(rule.decls.get("background")).toMatch(/var\(--color-[\w-]+\)/);
        expect(rule.decls.get("color")).toMatch(/^var\(--color-[\w-]+\)$/);
      }
      // Unfocused: neutral (as the editor's own unfocused selection, D154); focused: accent-soft.
      expect(unfocused.some(({ rule }) => rule.decls.get("background") === "color-mix(in srgb, var(--color-text) 12%, transparent)")).toBe(true);
      expect(focused.some(({ rule }) => rule.decls.get("background") === "var(--color-accent-soft)")).toBe(true);
      for (const { rule } of rules) expect(rule.decls.get("color")).toBe("var(--color-text)");

      // The selectors reach the real row, in the matching focus state.
      // openLintPanel focuses the list; blur it to reach the unfocused state the bug lives in.
      act(() => ul.blur());
      expect(document.activeElement).not.toBe(ul);
      expect(unfocused.every(({ selector }) => item.matches(selector))).toBe(true);
      expect(focused.some(({ selector }) => item.matches(selector))).toBe(false);
      act(() => ul.focus());
      expect(document.activeElement).toBe(ul);
      expect(focused.every(({ selector }) => item.matches(selector))).toBe(true);

      // Out-rank lint's own rules (light `#ddd`, dark `#2e343e`, focused Highlight):
      // the unfocused rule every non-:focus one, the focused rule all of them.
      const cm = parseRules(codemirrorCss()).flatMap((r) =>
        r.selectors.filter((s) => /\.cm-panel-lint ul(:focus)? \[aria-selected\]$/.test(s)),
      );
      expect(cm.some((s) => s.includes(":focus")), "lint generated no focused rule").toBe(true);
      expect(cm.some((s) => !s.includes(":focus")), "lint generated no unfocused rule").toBe(true);
      const losses: string[] = [];
      for (const { selector } of rules) {
        for (const cmSel of cm) {
          if (cmSel.includes(":focus") && !selector.includes(":focus")) continue;
          if (compareSpecificity(specificity(selector), specificity(cmSel)) <= 0) losses.push(`${selector} vs ${cmSel}`);
        }
      }
      expect(losses).toEqual([]);
    });
  }

  it("every token the WI-2 rules use is defined in both themes", () => {
    const light = readAppCssFile("themes/light.css");
    const dark = readAppCssFile("themes/dark.css");
    const rules = [...appRulesFor(DIALOG_CLOSE), ...appRulesFor(LINT_SELECTED)];
    expect(rules).not.toHaveLength(0);
    for (const { rule } of rules) {
      for (const value of rule.decls.values()) {
        for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) {
          expect(light, `${m[1]} missing in light.css`).toContain(`${m[1]}:`);
          expect(dark, `${m[1]} missing in dark.css`).toContain(`${m[1]}:`);
        }
      }
    }
  });

  it("editor-source.css as a whole has no prefers-color-scheme and no literal colours", () => {
    // Whole-file guard, comments stripped. No allowlist: as of D158-WI-2 the file
    // has no colour literal outside comments, so any new one is a regression.
    const css = readAppCssFile("sections/editor-source.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/prefers-color-scheme/i);
    const literals: string[] = [];
    for (const rule of parseRules(css)) {
      for (const [prop, value] of rule.decls) {
        if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\bwhite\b|\bblack\b/i.test(value)) {
          literals.push(`${rule.selectors.join(", ")} { ${prop}: ${value} }`);
        }
      }
    }
    expect(literals).toEqual([]);
  });
});

describe("D158 audit b70 — the whole-file literal scan knows every named colour", () => {
  it("flags named colours beyond white/black, color() and the other colour syntaxes", () => {
    expect(CSS_NAMED_COLORS.size).toBe(148);
    expect(colourLiterals("red")).toEqual(["red"]);
    expect(colourLiterals("1px solid RebeccaPurple")).toEqual(["RebeccaPurple"]);
    expect(colourLiterals("color(srgb 1 0 0)")).toEqual(["color("]);
    expect(colourLiterals("color-mix(in srgb, var(--accent), tomato)")).toEqual(["tomato"]);
    expect(colourLiterals("#fff")).toEqual(["#fff"]);
    expect(colourLiterals("oklch(0.7 0.1 200)")).toEqual(["oklch("]);
  });

  it("passes keywords and tokens that name no literal colour", () => {
    for (const value of ["transparent", "currentColor", "inherit", "initial", "unset", "none", "revert"]) {
      expect(colourLiterals(value), value).toEqual([]);
    }
    expect(colourLiterals("var(--accent-red)")).toEqual([]);
    expect(colourLiterals("color-mix(in srgb, var(--text-primary) 20%, transparent)")).toEqual([]);
    expect(colourLiterals("1px solid var(--border-color)")).toEqual([]);
  });

  it("editor-source.css has no colour literal by the full scan", () => {
    const css = readAppCssFile("sections/editor-source.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals: string[] = [];
    for (const rule of parseRules(css)) {
      for (const [prop, value] of rule.decls) {
        const found = colourLiterals(value);
        if (found.length > 0) literals.push(`${rule.selectors.join(", ")} { ${prop}: ${value} } → ${found.join(" ")}`);
      }
    }
    expect(literals).toEqual([]);
  });
});
