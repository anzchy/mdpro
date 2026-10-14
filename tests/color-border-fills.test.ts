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
import { colorBorderFillUses } from "./support/colorBorderFills";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** A5 exclusions, as in the tokenization guard: token files and the dead `App.css`. */
const EXCLUDED = new Set(["App.css", "styles/themes/light.css", "styles/themes/dark.css"]);

const files = (readdirSync(SRC, { recursive: true }) as string[]).map((p) => p.split("\\").join("/"));
const inScope = files.filter((p) => p.endsWith(".css") && !EXCLUDED.has(p)).sort();
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

type Kind = "line" | "retarget" | "dead";
interface Use {
  file: string;
  selector: string;
  kind: Kind;
  /** RETARGET: the WI that moves it. DEAD: why nothing renders it. LINE: what it draws. */
  note: string;
}

const S = "styles/sections/";
const TODOS_TITLE = "Remove dead App.css and TabBar; fix rule 34's App.css claim";

const USES: Use[] = [
  { file: "components/BottomTabs/BottomTabs.css", selector: ".bottom-tabs__divider", kind: "line", note: "1px divider between tab strip and add button" },
  {
    file: "components/Editor/MilkdownEditor.css",
    selector: ".milkdown-editor .ProseMirror .column-resize-handle::after",
    kind: "line",
    note: "1px column-resize hairline",
  },
  {
    file: S + "settings-about.css",
    selector: ".about-progress-bar::-webkit-progress-bar",
    kind: "retarget",
    note: "WI-3.1",
  },
  { file: S + "app-shell.css", selector: ".split-divider", kind: "dead", note: "orphan: no src/ file references split-divider" },
  { file: S + "tab-bar.css", selector: ".tab__close:hover", kind: "dead", note: "A8 dead code: only src/components/TabBar/ renders it" },
];

/** Expected rows per kind; WI-3.1 takes `retarget` to 0. */
const KIND_COUNTS: Record<Kind, number> = { line: 2, retarget: 1, dead: 2 };

const keyOf = (file: string, selector: string) => `${file} | ${selector}`;
const found = inScope.flatMap((file) => colorBorderFillUses(read(file)).map((d) => keyOf(file, d.selector)));

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
});

describe("--color-border fill uses in app CSS", () => {
  it("every fill use is classified", () => {
    const classified = new Set(USES.map((u) => keyOf(u.file, u.selector)));
    expect(found.filter((k) => !classified.has(k))).toEqual([]);
  });

  it("every classification row still matches a declaration", () => {
    const live = new Set(found);
    expect(USES.map((u) => keyOf(u.file, u.selector)).filter((k) => !live.has(k))).toEqual([]);
  });

  it("pins the row count per kind", () => {
    const counts: Record<Kind, number> = { line: 0, retarget: 0, dead: 0 };
    for (const u of USES) counts[u.kind] += 1;
    expect(counts).toEqual(KIND_COUNTS);
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
