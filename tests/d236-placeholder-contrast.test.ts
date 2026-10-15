// @vitest-environment node
/**
 * D236: input placeholders were left to WebKit's default grey (#a9a9a9),
 * 2.35:1 on white in light, under A9's 4.5:1 for text (Stage 3 batch 2 device
 * check, pixel-sampled: Settings › Export "(prompt on export)"). The app has
 * two placeholders, that one (`.settings-input`) and Insert Link's URL
 * (`.link-insert-input`); each now has a `::placeholder` colour, measured
 * here in both themes against the field it sits in.
 *
 * Strategy: as tests/contrast-stage3.test.ts, colours are read from the
 * declaration that paints them, and a translucent fill is composited over the
 * surface under it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarations } from "./support/cssTokenScan";
import { contrast, over, resolveColor, themeTokens, type Theme } from "./support/contrast";

const TEXT = 4.5;
const root = join(__dirname, "..");
const SEC = "src/styles/sections";

function fromRule(file: string, selector: string, property: string): string {
  const decl = parseDeclarations(readFileSync(join(root, file), "utf8")).find(
    (d) => d.property === property && d.selector.split(",").some((s) => s.trim() === selector),
  );
  if (!decl) throw new Error(`${file}: no ${property} in ${selector}`);
  return decl.value;
}

const FIELDS = [
  {
    name: "Settings › Export file name (.settings-input)",
    file: `${SEC}/toc-sidebar.css`,
    input: ".settings-input",
    // The Settings dialog card is --color-panel; the field's fill is translucent over it.
    under: "var(--color-panel)",
  },
  {
    name: "Insert Link URL (.link-insert-input)",
    file: `${SEC}/link-insert-modal.css`,
    input: ".link-insert-input",
    under: "var(--color-panel)",
  },
];

describe("D236 placeholders meet 4.5:1 in both themes", () => {
  for (const f of FIELDS) {
    it.each<Theme>(["light", "dark"])(`${f.name}, %s`, (theme) => {
      const t = themeTokens(theme);
      const fg = resolveColor(fromRule(f.file, `${f.input}::placeholder`, "color"), t);
      const field = over(resolveColor(fromRule(f.file, f.input, "background"), t), resolveColor(f.under, t));
      expect(contrast(over(fg, field), field)).toBeGreaterThanOrEqual(TEXT);
    });
  }

  it("the placeholder is fully opaque, so no UA opacity dims it further", () => {
    for (const f of FIELDS) expect(fromRule(f.file, `${f.input}::placeholder`, "opacity")).toBe("1");
  });

  it("these are the app's only placeholders, so a new one fails here until it is measured", () => {
    const src = join(root, "src");
    const withPlaceholder = (readdirSync(src, { recursive: true }) as string[])
      .map((p) => p.split("\\").join("/"))
      .filter((p) => p.endsWith(".tsx") && /\splaceholder=/.test(readFileSync(join(src, p), "utf8")))
      .sort();
    expect(withPlaceholder).toEqual(["components/Editor/LinkInsertModal.tsx", "components/common/settings/ExportSettings.tsx"]);
  });
});
