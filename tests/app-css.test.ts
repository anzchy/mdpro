// @vitest-environment node
/**
 * @module app-css.test
 * Purpose: Specify `src/test/appCss.ts` (plan P WI-1.1), the reader that tests
 * use instead of opening `src/styles/globals.css` by path. It follows the
 * `@import` lines of `src/styles/index.css`, so a CSS-reading test survives the
 * Stage 1 partial split without knowing which file a rule moved to.
 *
 * Cases: (a) before the split, the non-theme concatenation is `globals.css`
 * byte for byte; (b) an import of a missing file throws; (c) the entry is
 * rejected for any line that is not a comment or an `@import`, a duplicate
 * import, or a path that resolves outside the styles root. (b) and (c) run
 * against fixture text or temp files, never the real `index.css`.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readAppCss,
  readAppCssFile,
  readAppCssFiles,
  readAppCssNonTheme,
} from "../src/test/appCss";

const ROOT = path.resolve(__dirname, "..");
const STYLES = path.join(ROOT, "src/styles");
const REAL_ENTRY = path.join(STYLES, "index.css");

const tempDirs: string[] = [];

/** Build a throwaway styles root: `files` maps a root-relative path to its CSS. */
function makeRoot(entry: string, files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdpro-app-css-"));
  tempDirs.push(dir);
  const root = path.join(dir, "styles");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.css"), entry);
  for (const [rel, css] of Object.entries(files)) {
    const abs = path.join(dir, rel.startsWith("../") ? rel.slice(3) : path.join("styles", rel));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, css);
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("appCss — the real src/styles/index.css", () => {
  it("(a) non-theme concatenation equals globals.css byte for byte (pre-split)", () => {
    const globals = fs.readFileSync(path.join(STYLES, "globals.css"), "utf-8");
    expect(readAppCssNonTheme()).toBe(globals);
  });

  it("starts with globals.css and ends with the light then dark theme", () => {
    const rels = readAppCssFiles().map((f) => f.relPath);
    expect(rels[0]).toBe("globals.css");
    expect(rels.slice(-2)).toEqual(["themes/light.css", "themes/dark.css"]);
    expect(readAppCssFiles().filter((f) => f.isTheme).map((f) => f.relPath)).toEqual([
      "themes/light.css",
      "themes/dark.css",
    ]);
  });

  it("full concatenation is every file in import order", () => {
    const expected = ["globals.css", "themes/light.css", "themes/dark.css"]
      .map((rel) => fs.readFileSync(path.join(STYLES, rel), "utf-8"))
      .join("");
    expect(readAppCss()).toBe(expected);
  });

  it("per-file access returns one imported file's bytes", () => {
    const light = fs.readFileSync(path.join(STYLES, "themes/light.css"), "utf-8");
    expect(readAppCssFile("themes/light.css")).toBe(light);
    expect(readAppCssFile("./themes/dark.css")).toBe(
      fs.readFileSync(path.join(STYLES, "themes/dark.css"), "utf-8"),
    );
  });

  it("per-file access refuses a file the entry does not import", () => {
    expect(() => readAppCssFile("themes/sepia.css")).toThrow(/not imported/i);
  });

  it("main.tsx loads app CSS only through ./styles/index.css, after App", () => {
    const main = fs.readFileSync(path.join(ROOT, "src/main.tsx"), "utf-8");
    const cssImports = main.match(/^import\s+["'][^"']+\.css["'];?$/gm) ?? [];
    expect(cssImports).toEqual(['import "./styles/index.css";']);
    expect(main.indexOf('import App from "./App";')).toBeGreaterThanOrEqual(0);
    expect(main.indexOf('import "./styles/index.css";')).toBeGreaterThan(
      main.indexOf('import App from "./App";'),
    );
  });
});

describe("appCss — fixture entries", () => {
  it("keeps import order, splits themes out, and accepts comments and blank lines", () => {
    const root = makeRoot(
      [
        "/* entry banner */",
        "",
        '@import "./b.css";',
        "/* a multi-line",
        "   comment */",
        '@import "./themes/t.css"; /* trailing note */',
        '@import "./a.css";',
        "",
      ].join("\n"),
      { "a.css": "A{}\n", "b.css": "B{}\n", "themes/t.css": "T{}\n" },
    );
    const source = { entryPath: path.join(root, "index.css") };
    expect(readAppCssFiles(source).map((f) => [f.relPath, f.isTheme])).toEqual([
      ["b.css", false],
      ["themes/t.css", true],
      ["a.css", false],
    ]);
    expect(readAppCss(source)).toBe("B{}\nT{}\nA{}\n");
    expect(readAppCssNonTheme(source)).toBe("B{}\nA{}\n");
    expect(readAppCssFile("a.css", source)).toBe("A{}\n");
  });

  it("entryContents overrides the entry text while resolving against the real styles root", () => {
    const text = '@import "./themes/dark.css";\n';
    expect(readAppCssFiles({ entryContents: text }).map((f) => f.relPath)).toEqual([
      "themes/dark.css",
    ]);
    expect(readAppCssNonTheme({ entryContents: text })).toBe("");
    expect(fs.readFileSync(REAL_ENTRY, "utf-8")).not.toBe(text);
  });

  it("(b) an @import of a missing file throws instead of being skipped", () => {
    const root = makeRoot('@import "./present.css";\n@import "./absent.css";\n', {
      "present.css": "P{}\n",
    });
    expect(() => readAppCss({ entryPath: path.join(root, "index.css") })).toThrow(/missing/i);
    expect(() => readAppCss({ entryContents: '@import "./no-such-file.css";\n' })).toThrow(
      /missing/i,
    );
  });

  it("(b) a directory named like a CSS import is treated as missing", () => {
    const root = makeRoot('@import "./dir.css";\n', { "dir.css/x.css": "X{}\n" });
    expect(() => readAppCss({ entryPath: path.join(root, "index.css") })).toThrow(/missing/i);
  });

  it.each([
    ["a bare rule", '@import "./globals.css";\n.x { color: red; }\n'],
    ["an unquoted import", "@import ./globals.css;\n"],
    ["a url() import", '@import url("./globals.css");\n'],
    ["an import with a media query", '@import "./globals.css" screen;\n'],
    ["an import without a semicolon", '@import "./globals.css"\n'],
    ["an unterminated comment", '@import "./globals.css";\n/* never closed\n'],
    ["two imports on one line", '@import "./globals.css"; @import "./themes/light.css";\n'],
  ])("(c) rejects %s", (_label, text) => {
    expect(() => readAppCss({ entryContents: text })).toThrow(/not a comment or @import/i);
  });

  it("(c) rejects a duplicate import, including one spelled differently", () => {
    expect(() =>
      readAppCss({ entryContents: '@import "./globals.css";\n@import "./globals.css";\n' }),
    ).toThrow(/duplicate/i);
    expect(() =>
      readAppCss({ entryContents: '@import "./globals.css";\n@import "./themes/../globals.css";\n' }),
    ).toThrow(/duplicate/i);
  });

  it("(c) rejects a path resolving outside the styles root, even when the file exists", () => {
    expect(() =>
      readAppCss({ entryContents: '@import "../components/Editor/MilkdownEditor.css";\n' }),
    ).toThrow(/outside/i);
    expect(() => readAppCss({ entryContents: `@import "${path.join(STYLES, "globals.css")}";\n` })).toThrow(
      /outside|absolute/i,
    );
    const root = makeRoot('@import "../styles-evil/x.css";\n', { "../styles-evil/x.css": "X{}\n" });
    expect(() => readAppCss({ entryPath: path.join(root, "index.css") })).toThrow(/outside/i);
  });

  it("(c) rejects an entry with no @import at all", () => {
    expect(() => readAppCss({ entryContents: "/* only a comment */\n\n" })).toThrow(/no @import/i);
  });
});
