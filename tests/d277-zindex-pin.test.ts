// @vitest-environment node
/**
 * @module d277-zindex-pin.test
 * Purpose: pin every floating surface's z-index to its layer in rule 31's
 * z-index table (D277, CSS drift report C11). `css-tokenization.test.ts`
 * only holds each z-index to the table's set of values, so a toast moved
 * to 1000 or a context menu dropped to 20 still passed it. Here the table is
 * read from the rule itself and every selector it names must carry exactly
 * its layer's value, and nothing else in `src/` may set a z-index.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CssDeclaration, parseDeclarations } from "./support/cssTokenScan";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const RULE31 = join(ROOT, ".claude/rules/31-design-tokens.md");

/** A z-index outside the table that is not a floating surface, with its reason (rule 31 Q10). */
const LOCAL_STACKING = [
  {
    file: "components/Editor/MilkdownEditor.css",
    selector: ".milkdown-editor .ProseMirror .column-resize-handle",
    value: "1",
    reason: "local stacking inside the table, not a floating surface",
  },
];

interface Layer {
  layer: string;
  value: string;
  selectors: string[];
}

/**
 * The rows of rule 31 § Z-index hierarchy that name selectors. A struck-out
 * row (`~~…~~`) is retired, and a row naming no selector (Base, the reserved
 * 9999) pins nothing.
 */
function zIndexTable(markdown: string): Layer[] {
  const start = markdown.indexOf("## Z-index hierarchy");
  if (start < 0) throw new Error("rule 31 has no § Z-index hierarchy");
  const next = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const layers: Layer[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3 || cells[0] === "Layer" || /^-+$/.test(cells[0]) || cells[0].startsWith("~~")) continue;
    const value = cells[1].replace(/`/g, "");
    const selectors = [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (selectors.length > 0) layers.push({ layer: cells[0], value, selectors });
  }
  return layers;
}

interface Placed extends CssDeclaration {
  file: string;
}

/** Every z-index declaration in the given CSS files. */
function zIndexDeclarations(files: Record<string, string>): Placed[] {
  return Object.entries(files).flatMap(([file, css]) =>
    parseDeclarations(css)
      .filter((d) => d.property === "z-index")
      .map((d) => ({ ...d, file })),
  );
}

/** What disagrees with the table: a pinned selector with another value or none, or a z-index the table does not name. */
function zIndexDrift(layers: Layer[], decls: Placed[]): string[] {
  const out: string[] = [];
  for (const { layer, value, selectors } of layers) {
    for (const selector of selectors) {
      const found = decls.filter((d) => d.selector === selector);
      if (found.length === 0) out.push(`${selector} (${layer}) sets no z-index`);
      for (const d of found) if (d.value !== value) out.push(`${selector} is ${d.value} in ${d.file}:${d.line}; ${layer} is ${value}`);
    }
  }
  const pinned = new Set(layers.flatMap((l) => l.selectors));
  for (const d of decls) {
    if (pinned.has(d.selector) || d.value === "auto") continue;
    if (LOCAL_STACKING.some((x) => x.file === d.file && x.selector === d.selector && x.value === d.value)) continue;
    out.push(`${d.selector} sets z-index ${d.value} in ${d.file}:${d.line}, a surface rule 31's table does not name`);
  }
  return out;
}

const cssFiles = Object.fromEntries(
  (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.split("\\").join("/"))
    .filter((p) => p.endsWith(".css"))
    .sort()
    .map((p) => [p, readFileSync(join(SRC, p), "utf8")]),
);
const table = zIndexTable(readFileSync(RULE31, "utf8"));

describe("D277: rule 31's z-index table", () => {
  it("names the three layers the drift report checked", () => {
    const valueOf = (selector: string) => table.find((l) => l.selectors.includes(selector))?.value;
    expect(valueOf(".image-context-menu")).toBe("1000");
    expect(valueOf(".table-context-menu")).toBe("1000");
    expect(valueOf(".toast")).toBe("30");
    expect(valueOf(".dialog-backdrop")).toBe("20");
  });

  it("drops struck-out and selector-less rows", () => {
    const md = [
      "## Z-index hierarchy",
      "| Layer | z-index | Used by |",
      "|---|---|---|",
      "| Base | `auto` | Editor |",
      "| ~~Old~~ | ~~`100`~~ | none: `.gone` was removed |",
      "| Toast | `30` | `.toast` |",
      "| Future | `9999` | (reserved) |",
      "## Next",
      "| Toast | `31` | `.elsewhere` |",
    ].join("\n");
    expect(zIndexTable(md)).toEqual([{ layer: "Toast", value: "30", selectors: [".toast"] }]);
  });
});

describe("D277: every z-index in src/ matches its rule 31 layer", () => {
  it("finds the pinned surfaces at all (the scan is not vacuous)", () => {
    const selectors = zIndexDeclarations(cssFiles).map((d) => d.selector);
    for (const s of [".image-context-menu", ".table-context-menu", ".toast", ".dialog-backdrop"]) expect(selectors).toContain(s);
  });

  it("the CSS agrees with the table", () => {
    expect(zIndexDrift(table, zIndexDeclarations(cssFiles))).toEqual([]);
  });

  it("each pinned value sits where the drift report found it", () => {
    const at = (file: string, selector: string) =>
      zIndexDeclarations({ [file]: cssFiles[file] }).find((d) => d.selector === selector)?.value;
    expect(at("components/Editor/ImageContextMenu.css", ".image-context-menu")).toBe("1000");
    expect(at("styles/sections/table-context-menu.css", ".table-context-menu")).toBe("1000");
    expect(at("styles/sections/recovery-toast.css", ".toast")).toBe("30");
    expect(at("styles/sections/buttons-dialog.css", ".dialog-backdrop")).toBe("20");
  });

  it("no TS or TSX sets a z-index inline", () => {
    const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter((p) => /\.tsx?$/.test(p));
    const offenders = sources.filter((p) => {
      const code = readFileSync(join(SRC, p), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return /\bzIndex\b|z-index\s*:/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

describe("D277: the drift check rejects what it should", () => {
  const layers: Layer[] = [
    { layer: "Toast", value: "30", selectors: [".toast"] },
    { layer: "Inline context menu", value: "1000", selectors: [".image-context-menu"] },
  ];
  const decls = (css: string, file = "x.css") => zIndexDeclarations({ [file]: css });

  it("passes the table's own values", () => {
    expect(zIndexDrift(layers, decls(".toast { z-index: 30; } .image-context-menu { z-index: 1000; }"))).toEqual([]);
  });

  it("rejects a pinned surface at another layer's value", () => {
    expect(zIndexDrift(layers, decls(".toast { z-index: 1000; } .image-context-menu { z-index: 1000; }"))).toEqual([
      ".toast is 1000 in x.css:1; Toast is 30",
    ]);
  });

  it("rejects a pinned surface that lost its z-index", () => {
    expect(zIndexDrift(layers, decls(".toast { z-index: 30; } .image-context-menu { position: fixed; }"))).toEqual([
      ".image-context-menu (Inline context menu) sets no z-index",
    ]);
  });

  it("rejects a second declaration of a pinned surface at another value", () => {
    const css = ".toast { z-index: 30; } .image-context-menu { z-index: 1000; } @media (max-width: 1px) { .toast { z-index: 20; } }";
    expect(zIndexDrift(layers, decls(css))).toHaveLength(1);
  });

  it("rejects a surface the table does not name, even at a table value", () => {
    const css = ".toast { z-index: 30; } .image-context-menu { z-index: 1000; } .popover { z-index: 1000; }";
    expect(zIndexDrift(layers, decls(css))).toEqual([".popover sets z-index 1000 in x.css:1, a surface rule 31's table does not name"]);
  });

  it("allows auto anywhere, and the local-stacking exception only where it is listed", () => {
    const base = ".toast { z-index: 30; } .image-context-menu { z-index: 1000; } .x { z-index: auto; }";
    expect(zIndexDrift(layers, decls(base))).toEqual([]);
    const handle = ".milkdown-editor .ProseMirror .column-resize-handle { z-index: 1; }";
    expect(zIndexDrift(layers, [...decls(base), ...decls(handle, "components/Editor/MilkdownEditor.css")])).toEqual([]);
    expect(zIndexDrift(layers, [...decls(base), ...decls(handle, "styles/other.css")])).toHaveLength(1);
    expect(LOCAL_STACKING.every((x) => x.reason.length > 0)).toBe(true);
  });
});
