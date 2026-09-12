/**
 * @module table-alignment-rendering.test
 * Purpose: Characterize the product contract that **a table cell carrying the
 * HTML `align` attribute renders center- or right-aligned**, on the two render
 * surfaces that still exist.
 *
 * Provenance: WI-1.5 of docs/plans/20260502-plan-table-crud.md, which specified
 * three render pipelines. One of those three is now **retired, not satisfied** —
 * see "Retired contract" below.
 *
 * Surfaces still covered:
 *   - **WYSIWYG (Milkdown)** — `src/components/Editor/MilkdownEditor.css`,
 *     asserted here by letting jsdom's cascade compute `text-align` from the
 *     real stylesheet.
 *   - **Exported HTML** — `src-tauri/src/services/html_template.rs`, asserted in
 *     that file's own `#[cfg(test)] mod tests` (the `rust` lane), against the
 *     document `build_html` returns.
 *
 * Retired contract: *"the Preview pane's stylesheet honors `align` on table
 * cells, so a table rendered in the Preview pane shows its column alignment."*
 * The Preview pane was unmounted in 4570de3 and its files were deleted in step
 * 2.4. This contract has **no surface left to hold**, so the assertion that
 * read `src/components/Preview/styles/preview.css` was deleted rather than
 * migrated. Nothing here replaces it: the two surviving surfaces are the WYSIWYG
 * editor stylesheet and the exported HTML document, and neither renders a
 * Preview pane, because nothing does.
 *
 * What this file does NOT prove:
 *   - That WKWebView renders it. jsdom's cascade is a standards proxy, not the
 *     shipping engine.
 *   - Anything about `!important`. jsdom 26 does not implement it at all — an
 *     `!important` rule placed earlier loses to a normal rule of equal
 *     specificity placed later. Adding `!important` to the `[align]` rules below
 *     would break WYSIWYG alignment in a real browser (Milkdown's gfm preset
 *     sets alignment as an *inline* style, which `!important` would override)
 *     and **no test in this lane can detect it**. Recorded as a known gap.
 *   - Anything about competing stylesheets. Only MilkdownEditor.css is injected;
 *     the law below is scoped to "as authored in this file". Today no rule in
 *     `globals.css` or the theme sheets can match a cell inside
 *     `.milkdown-editor .ProseMirror`, so the narrower fixture loses nothing.
 *
 * `fs.readFileSync` survives this migration but changes role: it no longer
 * supplies a string to run regexes over, it loads the artifact under test.
 * File-path coupling is therefore unchanged — a rename of the CSS file still
 * breaks this test.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MILKDOWN_CSS = fs.readFileSync(
  path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
  "utf-8",
);

/**
 * Inject the real stylesheet and build markup reproducing the shipping scope
 * chain `.milkdown-editor` → `.ProseMirror` → `table` → `tr` → cell. The rules
 * under test are scoped under BOTH ancestors, so markup omitting them would
 * prove nothing about the editor.
 */
function mount(css: string): void {
  const style = document.createElement("style");
  style.id = "fixture-style";
  style.textContent = css;
  document.head.appendChild(style);

  const host = document.createElement("div");
  host.id = "fixture-host";
  host.innerHTML = `
    <div class="milkdown-editor"><div class="ProseMirror">
      <table>
        <thead><tr>
          <th id="th-center" align="center">c</th>
          <th id="th-right" align="right">r</th>
          <th id="th-left" align="left">l</th>
          <th id="th-absent">a</th>
        </tr></thead>
        <tbody><tr>
          <td id="td-center" align="center">c</td>
          <td id="td-right" align="right">r</td>
          <td id="td-left" align="left">l</td>
          <td id="td-absent">a</td>
        </tr></tbody>
      </table>
    </div></div>
    <table><tbody><tr>
      <td id="escaped" align="center">outside the editor scope</td>
    </tr></tbody></table>`;
  document.body.appendChild(host);
}

function alignOf(id: string): string {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture node #${id} missing`);
  return window.getComputedStyle(el).textAlign;
}

afterEach(() => {
  // tests/setup.ts only runs RTL cleanup(), which does not remove nodes we
  // appended to document.head / document.body by hand.
  document.getElementById("fixture-style")?.remove();
  document.getElementById("fixture-host")?.remove();
});

describe("MilkdownEditor.css — cells carrying [align] resolve to that alignment", () => {
  // Law: within the editor scope, a cell's computed text-align is decided by
  // its `align` attribute when one of the [align] rules matches, and by the
  // `th, td` default otherwise — as authored in MilkdownEditor.css.
  const cases: Array<[string, string]> = [
    ["center", "center"],
    ["right", "right"],
    // No [align="left"] rule exists; left-aligned cells fall through to the
    // `th, td { text-align: left }` default. Same observable result, different
    // mechanism — pinned so the rule set stays known.
    ["left", "left"],
    ["absent", "left"],
  ];

  for (const [attr, expected] of cases) {
    for (const tag of ["th", "td"]) {
      it(`${tag} with align="${attr}" computes ${expected}`, () => {
        mount(MILKDOWN_CSS);
        expect(alignOf(`${tag}-${attr}`)).toBe(expected);
      });
    }
  }

  it("only [align] moves a cell — the bare default is left, not the browser's", () => {
    // Control for the `absent` rows above: without this, those rows would pass
    // even if MilkdownEditor.css declared nothing, on jsdom's UA default alone.
    mount(MILKDOWN_CSS.replace("text-align: left;", "text-align: right;"));
    expect(alignOf("td-absent")).toBe("right");
    expect(alignOf("th-absent")).toBe("right");
  });

  it("the [align] rules do not escape the .milkdown-editor .ProseMirror scope", () => {
    mount(MILKDOWN_CSS);
    // Asserting "not center" rather than jsdom's actual "" — the empty string
    // is an artifact of jsdom shipping no UA rule for td, and pinning it would
    // be characterizing the test runner instead of the stylesheet.
    expect(alignOf("escaped")).not.toBe("center");
  });
});
