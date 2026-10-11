/**
 * D154: in Source mode a real selection (click + shift-click, or End then
 * ⌘⇧←, both on one line) drew no visible highlight on the device.
 *
 * Root cause, as pinned here:
 *   1. `drawSelection` (in basicSetup) paints `.cm-selectionBackground` in
 *      `.cm-selectionLayer`, which CodeMirror stacks *behind* `.cm-content`
 *      (negative z-index). The line holding the selection head is
 *      `.cm-activeLine`, and `editor-source.css` gave it an opaque
 *      `var(--color-surface)` background, so a one-line selection was painted
 *      over completely (and the head line of a multi-line one).
 *   2. The app's `.editor-shell .cm-selectionBackground` rule (0,2,0) loses to
 *      CodeMirror's focused rule
 *      `.ͼ2.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`
 *      (0,5,0), so the focused colour was never the app's, and it was a raw
 *      rgba rather than a theme token.
 *
 * What these tests cannot prove: jsdom has no layout or painting, so they pin
 * the configuration (stacking order of CodeMirror's layer, translucency of
 * every app background drawn over it, selector specificity against the rules
 * CodeMirror actually generates, token use) — not that the pixels are visible.
 * The device re-check covers that.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { readAppCssFile } from "../src/test/appCss";
import {
  background,
  codemirrorCss,
  compareSpecificity,
  lastCompound,
  parseRules,
  specificity,
} from "./support/cssRules";

/** A background is see-through when it is `transparent` or a color-mix toward transparent below 100%. */
function isTranslucent(value: string): boolean {
  if (value === "transparent") return true;
  const mix = /^color-mix\(\s*in srgb\s*,\s*var\(--[\w-]+\)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/.exec(value);
  return mix !== null && Number(mix[1]) < 100;
}

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

/** Mount a Source-like editor with a one-line selection; return the view. */
function mount(codeTheme: Extension): EditorView {
  const doc = "# Title\n\nLast line.kq1\n";
  const from = doc.indexOf("Last");
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(from, from + "Last line.kq1".length),
      extensions: [drawSelection(), highlightActiveLine(), codeTheme],
    }),
  });
  views.push(view);
  return view;
}

const sourceCss = () => parseRules(readAppCssFile("sections/editor-source.css"));

const CODE_THEMES: Array<[string, Extension]> = [
  ["default", syntaxHighlighting(defaultHighlightStyle)],
  ["oneDark", oneDark],
];

describe("D154 — Source-mode selection highlight", () => {
  it("CodeMirror stacks the selection layer behind the text, on the active line", () => {
    const view = mount(CODE_THEMES[0][1]);
    const layer = view.dom.querySelector<HTMLElement>(".cm-selectionLayer");
    expect(layer).not.toBeNull();
    // Below .cm-content: anything the app paints on a line covers it.
    expect(Number(layer!.style.zIndex)).toBeLessThan(0);
    // A one-line selection lives entirely on the active line.
    const active = view.dom.querySelectorAll(".cm-activeLine");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe("Last line.kq1");
  });

  it("no app background on a line or the content layer is opaque", () => {
    const offenders: string[] = [];
    for (const rule of sourceCss()) {
      const bg = background(rule);
      if (bg === undefined) continue;
      for (const sel of rule.selectors) {
        if (/\.cm-(activeLine|line|content)\b/.test(lastCompound(sel)) && !isTranslucent(bg)) {
          offenders.push(`${sel} { background: ${bg} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  for (const [name, theme] of CODE_THEMES) {
    it(`app selection rules out-rank every CodeMirror selection rule (code theme: ${name})`, () => {
      mount(theme);
      const cmRules = parseRules(codemirrorCss());
      const cmSelectors = cmRules
        .filter((r) => background(r) !== undefined)
        .flatMap((r) => r.selectors)
        .filter((s) => lastCompound(s) === ".cm-selectionBackground");
      // Both the focused and the unfocused rule must be present, or the probe is blind.
      expect(cmSelectors.some((s) => s.includes(".cm-focused"))).toBe(true);
      expect(cmSelectors.some((s) => !s.includes(".cm-focused"))).toBe(true);

      const appSelectors = sourceCss()
        .filter((r) => background(r) !== undefined)
        .flatMap((r) => r.selectors)
        .filter((s) => lastCompound(s) === ".cm-selectionBackground");

      for (const cm of cmSelectors) {
        const focused = cm.includes(".cm-focused");
        const winner = appSelectors.find(
          (app) =>
            app.includes(".cm-focused") === focused &&
            compareSpecificity(specificity(app), specificity(cm)) > 0,
        );
        expect(winner, `no app rule out-ranks ${cm}`).toBeDefined();
      }
    });
  }

  it("selection colours are theme tokens, focused on the accent, neither transparent", () => {
    const rules = sourceCss().filter((r) =>
      r.selectors.some((s) => lastCompound(s) === ".cm-selectionBackground"),
    );
    const focused = rules.filter((r) => r.selectors.some((s) => s.includes(".cm-focused")));
    const unfocused = rules.filter((r) => r.selectors.some((s) => !s.includes(".cm-focused")));
    expect(focused).not.toHaveLength(0);
    expect(unfocused).not.toHaveLength(0);
    for (const r of rules) {
      const bg = background(r)!;
      expect(bg).toMatch(/var\(--color-[\w-]+\)/);
      expect(bg).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
      expect(bg).not.toBe("transparent");
    }
    for (const r of focused) expect(background(r)).toMatch(/var\(--color-accent/);
  });

  it("every token the selection and active-line rules use is defined in both themes", () => {
    const light = readAppCssFile("themes/light.css");
    const dark = readAppCssFile("themes/dark.css");
    const used = new Set<string>();
    for (const rule of sourceCss()) {
      const bg = background(rule);
      if (!bg) continue;
      if (!rule.selectors.some((s) => /\.cm-(selectionBackground|activeLine)\b/.test(lastCompound(s)))) continue;
      for (const m of bg.matchAll(/var\((--[\w-]+)\)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const token of used) {
      expect(light, `${token} missing in light.css`).toContain(`${token}:`);
      expect(dark, `${token} missing in dark.css`).toContain(`${token}:`);
    }
  });
});
