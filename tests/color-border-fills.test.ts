// @vitest-environment node
/**
 * @module color-border-fills.test
 * Purpose: the `--color-border` fill audit of plan P WI-3.0. WI-3.1 redefines
 * `--color-border` as a translucent text mix (review item 7), which is right
 * for hairlines and control edges (DESIGN.md § Tokens) but would silently
 * change any surface that uses the token as a fill. Every fill use in app CSS
 * must therefore be classified:
 * - LINE: a 1px rule drawn as a box. It follows the border change on purpose.
 * - RETARGET: a real fill, moved to another token by the WI named in `item`.
 * - DEAD: nothing renders the selector; it goes with the TODOS.md entry
 *   "Remove dead App.css and TabBar; fix rule 34's App.css claim".
 * An unclassified use fails, and so does a row that no longer matches a
 * declaration.
 *
 * Strategy: source inspection over the same file set as
 * `tests/css-tokenization.test.ts`; the scanner fixtures below pin its edges.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colorBorderAliases, colorBorderFillUses } from "./support/colorBorderFills";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/**
 * Only the dead `App.css` is excluded. The theme files are scanned too: the
 * scanner skips custom-property definitions, so a token file contributes
 * only rules it actually renders (audit b129).
 */
const EXCLUDED = new Set(["App.css"]);

const files = (readdirSync(SRC, { recursive: true }) as string[]).map((p) => p.split("\\").join("/"));
const inScope = files.filter((p) => p.endsWith(".css") && !EXCLUDED.has(p)).sort();
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Every scanned file's text, so an alias declared in one file is resolved in another. */
const context = inScope.map(read);

type Kind = "line" | "retarget" | "dead";
interface Use {
  file: string;
  selector: string;
  property: string;
  value: string;
  kind: Kind;
  /** RETARGET: the WI that moves it. DEAD: why nothing renders it. LINE: what it draws. */
  note: string;
}

const S = "styles/sections/";
const TODOS_TITLE = "Remove dead App.css and TabBar; fix rule 34's App.css claim";
const BG = { property: "background", value: "var(--color-border)" };

const USES: Use[] = [
  {
    file: "components/BottomTabs/BottomTabs.css",
    selector: ".bottom-tabs__divider",
    ...BG,
    kind: "line",
    note: "1px divider between tab strip and add button",
  },
  {
    file: "components/Editor/MilkdownEditor.css",
    selector: ".milkdown-editor .ProseMirror .column-resize-handle::after",
    ...BG,
    kind: "line",
    note: "1px column-resize hairline",
  },
  { file: S + "app-shell.css", selector: ".split-divider", ...BG, kind: "dead", note: "orphan: no src/ file references split-divider" },
  { file: S + "tab-bar.css", selector: ".tab__close:hover", ...BG, kind: "dead", note: "A8 dead code: only src/components/TabBar/ renders it" },
];

/** Expected rows per kind. WI-3.1 moved the one `retarget` row, the About progress track, to `--color-border-subtle`. */
const KIND_COUNTS: Record<Kind, number> = { line: 2, retarget: 0, dead: 2 };

/** Rows are pinned by the whole declaration and compared as multisets (audit b129). */
const keyOf = (u: { file: string; selector: string; property: string; value: string }) =>
  `${u.file} | ${u.selector} | ${u.property} | ${u.value}`;
const found = inScope
  .flatMap((file) => colorBorderFillUses(read(file), context).map((d) => keyOf({ file, ...d })))
  .sort();

describe("scanner fixtures", () => {
  const selectors = (css: string) => colorBorderFillUses(css).map((d) => d.selector);

  it("counts background, background-color and fill", () => {
    const css = `.a { background: var(--color-border); }
.b { background-color: var(--color-border); }
.c { fill: var(--color-border); }`;
    expect(selectors(css)).toEqual([".a", ".b", ".c"]);
  });

  it("counts a background shorthand and a var() fallback", () => {
    const css = `.a { background: var(--color-border) no-repeat; }
.b { background: var(--color-border, #e5e7eb); }`;
    expect(selectors(css)).toEqual([".a", ".b"]);
  });

  it("ignores borders, outlines, shadows and other tokens", () => {
    const css = `.a { border: 1px solid var(--color-border); }
.b { border-bottom-color: var(--color-border); outline: 1px solid var(--color-border); }
.c { box-shadow: 0 0 0 1px var(--color-border); }
.d { background: var(--color-border-subtle); }
.e { background: var(--color-surface); }`;
    expect(selectors(css)).toEqual([]);
  });

  it("ignores comments and finds uses inside @media", () => {
    const css = `/* .x { background: var(--color-border); } */
@media (max-width: 600px) {
  .a {
    background:
      var(--color-border);
  }
}`;
    expect(selectors(css)).toEqual(["@media (max-width: 600px) > .a"]);
  });

  it("counts any area-painting property, e.g. a background-image gradient, stroke or mask", () => {
    const css = `.a { background-image: linear-gradient(var(--color-border), transparent); }
.b { stroke: var(--color-border); }
.c { -webkit-mask: linear-gradient(var(--color-border), transparent); }
.d { column-rule: 1px solid var(--color-border); }`;
    expect(selectors(css)).toEqual([".a", ".b", ".c"]);
  });

  it("follows a custom-property alias in the same file", () => {
    const css = `.seeded { --foo: var(--color-border); background: var(--foo); }`;
    expect(selectors(css)).toEqual([".seeded"]);
  });

  it("follows an alias chain declared in another file", () => {
    const other = `:root { --foo: var(--color-border); --bar: var(--foo, #fff); --baz: var(--color-border-subtle); }`;
    const css = `.a { background: var(--bar); }
.b { background: var(--baz); }`;
    expect(colorBorderFillUses(css, [other]).map((d) => d.selector)).toEqual([".a"]);
  });

  it("counts border-image, which paints an image (and with `fill` the whole box)", () => {
    const css = `.a { border-image: linear-gradient(var(--color-border), transparent) 1 fill; }
.b { border-image-source: linear-gradient(var(--color-border), transparent); }`;
    expect(selectors(css)).toEqual([".a", ".b"]);
  });

  it("reads an alias whose value has a ; inside a quoted string", () => {
    const css = `.a { --track: url("data:image/svg+xml;utf8,<svg/>") var(--color-border); background: var(--track); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("matches var() case-insensitively and ignores the token inside a string", () => {
    const css = `.a { background: VAR(--color-border); }
.b { content: "var(--color-border)"; }
.c { background: url('x.svg#var(--color-border)'); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("reads an alias whose quoted string holds an escaped quote and a ; (audit b136)", () => {
    const css = `.a { --x: "a\\";b" var(--color-border); background: var(--x); }
.b { --y: 'c\\';d' var(--color-border); background: var(--y); }`;
    expect(selectors(css)).toEqual([".a", ".b"]);
  });

  it("reads an alias whose unquoted url() holds a ; (audit b136)", () => {
    const css = `.a { --track: url(data:image/svg+xml;utf8,x) var(--color-border); background: var(--track); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("matches the property name case-sensitively: --COLOR-BORDER is another property (audit b136)", () => {
    const css = `.a { background: var(--COLOR-BORDER); }
.b { --Color-Border: red; background: var(--Color-Border); }`;
    expect(selectors(css)).toEqual([]);
  });
});

describe("scanner fixtures: audit b138", () => {
  const selectors = (css: string, context: string[] = []) => colorBorderFillUses(css, context).map((d) => d.selector);

  it("M1: a string continued with backslash-newline does not end an alias's value", () => {
    const css = `.a { --x: "a\\\n;b" var(--color-border); background: var(--x); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("M2: an even run of backslashes before a quote closes the string", () => {
    const css = `.a { --x: "a\\\\" var(--color-border); background: var(--x); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("M3: an escaped ) inside an unquoted url() does not end it", () => {
    const css = `.a { --x: url(data:a\\);b) var(--color-border); background: var(--x); }`;
    expect(selectors(css)).toEqual([".a"]);
  });

  it("M4: the token inside an unquoted url() is URL text, not a use or an alias", () => {
    const css = `.a { background: url(x.svg#var(--color-border)); }
.b { --y: url(var(--color-border)); background: var(--y); }`;
    expect(selectors(css)).toEqual([]);
  });
});

describe("--color-border fill uses in app CSS", () => {
  it("the found uses equal the classified rows exactly (multiset)", () => {
    expect(found).toEqual(USES.map(keyOf).sort());
  });

  it("pins the row count per kind", () => {
    const counts: Record<Kind, number> = { line: 0, retarget: 0, dead: 0 };
    for (const u of USES) counts[u.kind] += 1;
    expect(counts).toEqual(KIND_COUNTS);
  });

  it("no TS, TSX or index.html source names the token or a CSS alias of it (inline styles are out of reach of the CSS scan)", () => {
    const names = [...colorBorderAliases(context)].map((n) => n.replace(/-/g, "\\-"));
    const token = new RegExp(`(${names.join("|")})(?![\\w-])`);
    const sources = files.filter((p) => /\.(tsx?)$/.test(p)).map((p) => [p, read(p)] as const);
    sources.push(["../index.html", readFileSync(join(ROOT, "index.html"), "utf8")]);
    expect(sources.filter(([, text]) => token.test(text)).map(([p]) => p)).toEqual([]);
  });
});

describe("dead rows", () => {
  const sources = files.filter((p) => /\.(tsx?|html)$/.test(p) && !p.startsWith("components/TabBar/"));
  const todos = readFileSync(join(ROOT, "TODOS.md"), "utf8");
  const entry = todos.slice(todos.indexOf(`## ${TODOS_TITLE}`), todos.indexOf("\n---", todos.indexOf(`## ${TODOS_TITLE}`)));

  it("no live source references a dead row's class", () => {
    // Whole class names only: `bottom-tab__close` is live and must not match `tab__close`.
    for (const cls of ["split-divider", "tab__close"]) {
      const name = new RegExp(`(?<![\\w-])${cls}(?![\\w-])`);
      expect(sources.filter((p) => name.test(read(p))), cls).toEqual([]);
    }
  });

  it(`TODOS.md "${TODOS_TITLE}" names each dead selector`, () => {
    expect(entry.length).toBeGreaterThan(0);
    for (const u of USES.filter((x) => x.kind === "dead")) {
      expect(entry, u.selector).toContain(`\`${u.selector}\``);
    }
  });
});
