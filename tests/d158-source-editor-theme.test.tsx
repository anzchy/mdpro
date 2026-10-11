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

  it("the tooltip follows the popover contract: --shadow-soft, popover radius (10px), panel fill", () => {
    const tip = appChromeRules().filter(({ selector }) => lastCompound(selector) === ".cm-tooltip");
    expect(tip.some(({ rule }) => rule.decls.get("box-shadow") === "var(--shadow-soft)")).toBe(true);
    expect(tip.some(({ rule }) => rule.decls.get("border-radius") === "10px")).toBe(true);
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
    // Pattern 2 (button): 2px accent outline, offset 2px, keyboard only.
    const button = find(/^\.cm-button:focus-visible$/);
    expect(button).not.toHaveLength(0);
    for (const r of button) {
      expect(r.decls.get("outline")).toBe("2px solid var(--color-accent)");
      expect(r.decls.get("outline-offset")).toBe("2px");
    }
    // Secondary button (new DESIGN.md § Buttons): panel fill, hairline, control radius,
    // a text-mix hover fill (stand-in for --color-hover), no invented :active state.
    const base = find(/^\.cm-button$/);
    expect(base.some((r) => r.decls.get("background") === "var(--color-panel)")).toBe(true);
    expect(base.some((r) => r.decls.get("border") === "1px solid var(--color-border)")).toBe(true);
    expect(base.some((r) => r.decls.get("border-radius") === "6px")).toBe(true);
    const hover = find(/^\.cm-button:hover$/);
    expect(
      hover.some((r) => r.decls.get("background") === "color-mix(in srgb, var(--color-text) 5%, transparent)"),
    ).toBe(true);
    expect(find(/^\.cm-button:active$/)).toHaveLength(0);
  });
});
