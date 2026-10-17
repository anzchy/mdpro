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
import { LOCAL_STACKING, type Layer, inlineZIndex, zIndexDeclarations, zIndexDrift, zIndexTable } from "./support/zIndexGuard";
import { inventoryDefects, sourceInventory } from "./support/zIndexGuard";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const RULE31 = join(ROOT, ".claude/rules/31-design-tokens.md");

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
    const offenders = sources.filter((p) => inlineZIndex(readFileSync(join(SRC, p), "utf8"), p).length > 0);
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

// D277-FIX-1 (Codex H1-H3 and Fable's Mediums on PR #501).
describe("D277-FIX-1: inline z-index in TS and TSX", () => {
  it("a URL earlier on the line does not hide a zIndex", () => {
    expect(inlineZIndex('const u = "https://x.dev"; el.style.zIndex = "5";', "a.ts")).not.toEqual([]);
  });

  it("setProperty with either quote, cssText, and a JSX style object are caught", () => {
    expect(inlineZIndex('el.style.setProperty("z-index", "5");', "a.ts")).not.toEqual([]);
    expect(inlineZIndex("el.style.setProperty('z-index', '5');", "a.ts")).not.toEqual([]);
    expect(inlineZIndex("el.style.cssText = `position: fixed; z-index: ${n}`;", "a.ts")).not.toEqual([]);
    expect(inlineZIndex("export const A = () => <div style={{ zIndex: 3 }} />;", "a.tsx")).not.toEqual([]);
  });

  it("comments are not code", () => {
    expect(inlineZIndex("// el.style.zIndex = 5\n/* z-index: 3; setProperty('z-index') */\nconst a = 1;", "a.ts")).toEqual([]);
  });
});

describe("D277-FIX-1: nested CSS, at-rules and selector lists", () => {
  const layers: Layer[] = [
    { layer: "Toast", value: "30", selectors: [".toast"] },
    { layer: "Inline context menu", value: "1000", selectors: [".image-context-menu", ".table-context-menu"] },
  ];

  it("rejects a nested rule outright", () => {
    expect(() => zIndexDeclarations({ "x.css": ".unlisted-parent { .toast { z-index: 30; } }" })).toThrow(/nested CSS not supported by this guard/);
    expect(() => zIndexDeclarations({ "x.css": ".toast { @media (max-width: 1px) { z-index: 20; } }" })).toThrow(/nested CSS not supported by this guard/);
  });

  it("an at-rule wrapper keeps the rule's own selector, range syntax included", () => {
    const decls = zIndexDeclarations({ "x.css": "@media (width > 600px) { .toast > .x, .toast { z-index: 30; } }" });
    expect(decls.map((d) => d.selector)).toEqual([".toast > .x, .toast"]);
    expect(zIndexDrift(layers, decls.concat(zIndexDeclarations({ "y.css": ".image-context-menu, .table-context-menu { z-index: 1000; }" })))).toEqual([
      ".toast > .x sets z-index 30 in x.css:1, a surface rule 31's table does not name",
    ]);
  });

  it("checks each selector of a list", () => {
    const decls = zIndexDeclarations({ "x.css": ".toast, .other { z-index: 30; } .image-context-menu, .table-context-menu { z-index: 1000; }" });
    expect(zIndexDrift(layers, decls)).toEqual([".other sets z-index 30 in x.css:1, a surface rule 31's table does not name"]);
  });
});

describe("D277-FIX-1: every unstruck table row names its selectors", () => {
  const md = (row: string) =>
    ["## Z-index hierarchy", "| Layer | z-index | Used by |", "|---|---|---|", "| Base | `auto` | Editor |", "| Toast | `30` | `.toast` |", row, "| Future portaled modal | `9999` | (reserved) |"].join("\n");

  it("throws on a row whose selector is not backticked", () => {
    expect(() => zIndexTable(md("| Tooltip | `50` | .tooltip |"))).toThrow(/Tooltip/);
  });

  it("exempts only Base and the (reserved) row", () => {
    expect(() => zIndexTable(md("| Overlay | `auto` | Editor chrome |"))).toThrow(/Overlay/);
    expect(zIndexTable(md("| Tooltip | `50` | `.tooltip` |")).map((l) => l.layer)).toEqual(["Toast", "Tooltip"]);
  });
});

// D277-FIX-2 (Codex confirm on 14552a34): the guard fails closed on whatever it does not model.
describe("D277-FIX-2: the source inventory is closed", () => {
  it("rejects any extension outside .ts, .tsx, .css and .svg", () => {
    const inv = sourceInventory([
      "src/a.js",
      "src/b.mts",
      "src/c.ts",
      "src/d.css",
      "src/e.svg",
      "src/f.d.ts",
      "src/g.tsx",
      "src/h.jsx",
      "src/i.cts",
    ]);
    expect(inv.rejected).toEqual([
      "src/a.js",
      "src/b.mts",
      "src/h.jsx",
      "src/i.cts",
    ]);
    expect(inv.ts).toEqual(["src/c.ts", "src/f.d.ts", "src/g.tsx"]);
  });

  it("an empty inventory is a defect", () => {
    expect(inventoryDefects(sourceInventory([]))).toEqual([
      "no TS or TSX source found",
      "no CSS found",
    ]);
  });

  it("src/ itself: nothing rejected, both inventories non-empty, no inline z-index anywhere", () => {
    const files = (
      readdirSync(SRC, {
        recursive: true,
        withFileTypes: true,
      }) as import("node:fs").Dirent[]
    )
      .filter((d) => d.isFile() && d.name !== ".DS_Store")
      .map((d) => join(d.parentPath, d.name));
    const inv = sourceInventory(files);
    expect(inv.rejected).toEqual([]);
    expect(inventoryDefects(inv)).toEqual([]);
    expect(
      inv.ts.flatMap((f) => inlineZIndex(readFileSync(f, "utf8"), f)),
    ).toEqual([]);
    expect(
      inv.svg.filter((f) => /z-?index/i.test(readFileSync(f, "utf8"))),
    ).toEqual([]);
  });
});

describe("D277-FIX-2: TS and TSX fail closed", () => {
  const caught = (src: string, file = "a.ts") =>
    expect(inlineZIndex(src, file)).not.toEqual([]);

  it("a quoted zIndex key or element access", () => {
    caught('el.style["zIndex"] = "9999";');
    caught('const s = { "zIndex": 9999 };');
  });

  it("a z-index built from pieces", () => {
    caught('el.style.setProperty("z-" + "index", "5");');
    caught('el.style.setProperty(`z-${"index"}`, "5");');
    caught('el.style.cssText = "position: fixed; z-" + "index: 5";');
    caught('Object.assign(el.style, { ["z" + "Index"]: 5 });');
  });

  it("setProperty with a non-literal name, and style[...] with a non-literal key", () => {
    caught('el.style.setProperty(name, "5");');
    caught('el.style[key] = "5";');
  });

  it("a file that does not parse", () => {
    caught("export const A = () => <div>; el.style.zIndex = 9999;", "a.tsx");
    caught("const a = <div>;", "a.tsx");
  });

  it("literal property names that are not z-index pass", () => {
    expect(
      inlineZIndex(
        'el.style.setProperty("color", "red"); el.style["color"] = "x"; const o = { "a-b": 1 };',
        "a.ts",
      ),
    ).toEqual([]);
  });
});

describe("D277-FIX-2: CSS at-rules are on an allowlist", () => {
  it("@scope, @supports, @layer and @container throw", () => {
    for (const css of [
      "@scope (.unlisted-parent) { .toast { z-index: 30; } }",
      "@supports (display: grid) { .toast { z-index: 30; } }",
      "@layer base;",
      "@container (min-width: 1px) { .toast { z-index: 30; } }",
      "@SCOPE (.p) { .toast { z-index: 30; } }",
    ]) {
      expect(() => zIndexDeclarations({ "x.css": css }), css).toThrow(
        /at-rule/,
      );
    }
  });

  it("@import, @media and @keyframes are read", () => {
    const css =
      '@import "./a.css";\n@media (max-width: 1px) { .toast { z-index: 30; } }\n@keyframes k { from { opacity: 0; } }';
    expect(zIndexDeclarations({ "x.css": css }).map((d) => d.selector)).toEqual(
      [".toast"],
    );
  });
});

describe("D277-FIX-2: every table row is well formed", () => {
  const md = (row: string) =>
    [
      "## Z-index hierarchy",
      "| Layer | z-index | Used by |",
      "|---|---|---|",
      "| Base | `auto` | Editor |",
      "| Toast | `30` | `.toast` |",
      row,
    ].join("\n");

  it("a row with other than three cells throws", () => {
    expect(() =>
      zIndexTable(md("| Tooltip | `9999` | `.tooltip` | extra |")),
    ).toThrow(/3 cells/);
    expect(() => zIndexTable(md("| Tooltip | `9999` |"))).toThrow(/3 cells/);
  });

  it("strike-through must wrap the layer and value cells whole", () => {
    expect(() => zIndexTable(md("| ~~Tooltip | `50` | `.tooltip` |"))).toThrow(
      /~~/,
    );
    expect(() =>
      zIndexTable(md("| ~~Tooltip~~ | `50` | `.tooltip` |")),
    ).toThrow(/~~/);
    expect(() =>
      zIndexTable(md("| Tooltip | `50` | ~~`.tooltip`~~ |")),
    ).toThrow(/~~/);
    expect(
      zIndexTable(
        md("| ~~Old~~ | ~~`100`~~ | none: `.gone` was removed |"),
      ).map((l) => l.layer),
    ).toEqual(["Toast"]);
  });

  it("a value that is not auto or a whole number throws", () => {
    expect(() => zIndexTable(md("| Tooltip | `high` | `.tooltip` |"))).toThrow(
      /value/,
    );
  });
});

// D277-FIX-3 (user ruling 「Accidental drift only (Recommended)」): the last two shape gaps.
describe("D277-FIX-3: @keyframes holds only keyframe selectors", () => {
  it("a rule selector inside @keyframes throws", () => {
    expect(() => zIndexDeclarations({ "x.css": "@keyframes k { .toast { z-index: 30; } }" })).toThrow(/keyframe/);
    expect(() => zIndexDeclarations({ "x.css": "@keyframes k { from { opacity: 0; } .x, to { opacity: 1; } }" })).toThrow(/keyframe/);
  });

  it("from, to and percentages are read", () => {
    const css = "@keyframes k { from { opacity: 0; } 50% { opacity: 0.5; } 0%, 100% { opacity: 1; } to { opacity: 1; } 12.5% { opacity: 0.2; } }";
    expect(() => zIndexDeclarations({ "x.css": css })).not.toThrow();
  });
});

describe("D277-FIX-3: the table's rows and header are all there", () => {
  const rows = ["| Base | `auto` | Editor |", "| Toast | `30` | `.toast` |"];

  it("a row without its leading pipe throws", () => {
    const md = ["## Z-index hierarchy", "| Layer | z-index | Used by |", "|---|---|---|", ...rows, "Tooltip | `50` | `.tooltip` |"].join("\n");
    expect(() => zIndexTable(md)).toThrow(/leading \|/);
  });

  it("a missing header row throws", () => {
    expect(() => zIndexTable(["## Z-index hierarchy", "|---|---|---|", ...rows].join("\n"))).toThrow(/header/);
    expect(() => zIndexTable(["## Z-index hierarchy", ...rows].join("\n"))).toThrow(/header/);
  });
});
