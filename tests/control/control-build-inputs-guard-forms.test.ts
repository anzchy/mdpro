// @vitest-environment node
/**
 * WI-17 (ADR-0047): a positive case for every syntax form the build-input
 * guard's header claims to detect, plus Rust byte raw strings.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit
 * `buildInputsGuard.mjs#findExcludedRefs (WI-17)`, WI-5/T08..T12.
 *
 * Law: one finding per reference offset, in file order. Rows joined with
 * "\n" give the concatenation of each row's findings, line-shifted
 * (composition sub-assertions in T08 and T10).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { findExcludedRefs } from "../../scripts/control/buildInputsGuard.mjs";

type Finding = { file: string; line: number; ref: string };
type Row = { id: string; text: string; refs: string[] };

const EX = [".claude/", "docs/", "**/*.tsbuildinfo"];

const find = (relPath: string, text: string): Finding[] => findExcludedRefs(relPath, text, EX);
const at = (file: string, line: number, ref: string): Finding => ({ file, line, ref });

/** Every row of `rows` joined into one file gives each row's findings on that row's line. */
function expectComposes(file: string, rows: Row[]): void {
  const joined = rows.map((r) => r.text).join("\n");
  const expected = rows.flatMap((r, k) => r.refs.map((ref) => at(file, k + 1, ref)));
  expect(find(file, joined), `composition of ${rows.map((r) => r.id).join(",")}`).toEqual(expected);
}

describe("WI-5/T08 CSS forms", () => {
  const CSS = "src/styles/a.css";
  const rows: Row[] = [
    { id: "c1", text: '@import "../../docs/a.css";', refs: ["../../docs/a.css"] },
    { id: "c2", text: '@import url("../../docs/b.css");', refs: ["../../docs/b.css"] },
    { id: "c3", text: "a { background: url(../../docs/i.png) }", refs: ["../../docs/i.png"] },
    { id: "c4", text: "a { background: url('/docs/j.png') }", refs: ["/docs/j.png"] },
    { id: "c5", text: "/* url(../../docs/k.png) */", refs: [] },
    { id: "c6", text: "a { background: url(data:image/png;base64,AA) }", refs: [] },
    { id: "c7", text: "a { background: url(https://x/docs/a) }", refs: [] },
  ];

  it.each(rows)("WI-5/T08 $id gives exactly its findings", (row) => {
    expect(find(CSS, row.text), row.id).toEqual(row.refs.map((ref) => at(CSS, 1, ref)));
  });

  it("WI-5/T08 c8 the same ref at two offsets is two findings", () => {
    const text = '@import "../../docs/a.css";\n@import "../../docs/a.css";';
    expect(find(CSS, text)).toEqual([at(CSS, 1, "../../docs/a.css"), at(CSS, 2, "../../docs/a.css")]);
  });

  // Added (not in the matrix): c6/c7 resolve under src/styles/ even without the
  // scheme check, so they cannot catch its removal. This URL's dot segments land
  // in docs/ if the scheme is read as a path segment.
  it("WI-5/T08 c9 a scheme URL is never a path, even when its dots reach docs/", () => {
    expect(find(CSS, "a { background: url(https:/../../../docs/a) }")).toEqual([]);
  });

  it("WI-5/T08 composition: c1-c7 joined give c1-c4 on lines 1-4, nothing after", () => {
    expectComposes(CSS, rows);
  });
});

describe("WI-5/T09 JS forms and vite keys", () => {
  const JS = "src/a/b.ts";
  const rows: Row[] = [
    { id: "j1", text: 'const m = import.meta.glob("../../docs/*.md");', refs: ["../../docs/*.md"] },
    { id: "j2", text: "const g = import.meta.globEager('../../.claude/x/*.json');", refs: ["../../.claude/x/*.json"] },
    { id: "j3", text: 'const w = new URL("../../docs/w.wasm", import.meta.url);', refs: ["../../docs/w.wasm"] },
    { id: "j4", text: 'export { a } from "../../docs/e";', refs: ["../../docs/e"] },
    { id: "j5", text: 'import type { T } from "../../docs/t";', refs: ["../../docs/t"] },
    { id: "j6", text: 'import x from "../../docs?raw";', refs: ["../../docs?raw"] },
    { id: "j7", text: 'const h = new URL("../../docs#frag", import.meta.url);', refs: ["../../docs#frag"] },
    { id: "j8", text: 'const u = `http://x`; import y from "../../docs/b";', refs: ["../../docs/b"] },
    { id: "j9", text: 'const ok = new URL("./ok.wasm", import.meta.url);', refs: [] },
    { id: "j10", text: 'export * as ns from "../../docs/s";', refs: ["../../docs/s"] },
    { id: "j11", text: 'export * from "../../docs/s2";', refs: ["../../docs/s2"] },
    { id: "j12", text: 'export type { T } from "../../docs/t2";', refs: ["../../docs/t2"] },
    { id: "j13", text: 'import r from "/docs/r";', refs: ["/docs/r"] },
    { id: "j14", text: "const d = await import(`../../docs/d`);", refs: ["../../docs/d"] },
  ];

  it.each(rows)("WI-5/T09 $id gives exactly its findings", (row) => {
    expect(find(JS, row.text), row.id).toEqual(row.refs.map((ref) => at(JS, 1, ref)));
  });

  it.each(["root", "outDir", "cacheDir", "envDir"])("WI-5/T09 vite key %s set to docs is one finding", (key) => {
    expect(find("vite.config.ts", `export default { ${key}: "docs" };`)).toEqual([at("vite.config.ts", 1, "docs")]);
  });
});

describe("WI-5/T10 Rust forms, raw strings and nested block comments", () => {
  const RS = "src-tauri/src/x.rs";
  const rows: Row[] = [
    { id: "r1", text: '#[path = "../../docs/m.rs"] mod m;', refs: ["../../docs/m.rs"] },
    { id: "r2", text: '# [ path = "../../.claude/n.rs" ] mod n;', refs: ["../../.claude/n.rs"] },
    { id: "r3", text: 'include!("../../docs/gen.rs");', refs: ["../../docs/gen.rs"] },
    { id: "r4", text: 'const R: &str = include_str!(r"../../docs/r.md");', refs: ["../../docs/r.md"] },
    { id: "r5", text: 'let s = r#"/* x"#; let t = include_str!("../../docs/x.md");', refs: ["../../docs/x.md"] },
    { id: "r6", text: 'let u = r"http://x"; include_str!("../../docs/y.md");', refs: ["../../docs/y.md"] },
    {
      id: "r7",
      text: 'let p = r"C:\\"; let u = "//"; let b = include_str!("../../docs/v.md");',
      refs: ["../../docs/v.md"],
    },
  ];
  const r8: Row = {
    id: "r8",
    text: '/* a /* b */ include_str!("../../docs/hidden.md") */ include_str!("../../docs/seen.md");',
    refs: ["../../docs/seen.md"],
  };
  const r9: Row = { id: "r9", text: 'const A: &str = include_str!("/docs/abs.md");', refs: [] };

  it.each([...rows, r8, r9])("WI-5/T10 $id gives exactly its findings", (row) => {
    expect(find(RS, row.text), row.id).toEqual(row.refs.map((ref) => at(RS, 1, ref)));
  });

  it("WI-5/T10 composition: r1-r7 joined give seven findings on lines 1-7", () => {
    expectComposes(RS, rows);
  });
});

describe("WI-5/T11 byte raw strings do not hide a later reference", () => {
  const RS = "src-tauri/src/x.rs";
  const rows: Row[] = [
    {
      id: "b1",
      text: 'let a = br"C:\\"; let u = "//"; let b = include_str!("../../docs/z.md");',
      refs: ["../../docs/z.md"],
    },
    {
      id: "b2",
      text: 'let a = br#"q\\"#; let u = "//"; let b = include_str!("../../docs/w.md");',
      refs: ["../../docs/w.md"],
    },
    { id: "b3", text: 'let s = b"x\\"//"; include_str!("../../docs/q.md");', refs: ["../../docs/q.md"] },
  ];

  it.each(rows)("WI-5/T11 $id gives exactly its findings", (row) => {
    expect(find(RS, row.text), row.id).toEqual(row.refs.map((ref) => at(RS, 1, ref)));
  });
});

describe("WI-5/T12 multi-line package.json fields", () => {
  const PJ = "package.json";

  it("WI-5/T12 (i) main, exports, files, bin; not name, scripts or keys", () => {
    const text = [
      "{",
      '  "name": "docs",',
      '  "main": "docs/index.js",',
      '  "exports": {',
      '    ".": "./.claude/x.js",',
      '    "./docs/": "./lib/"',
      "  },",
      '  "files": ["docs/"],',
      '  "bin": { "t": "docs/t.js" },',
      '  "scripts": { "b": "node docs/b.js" }',
      "}",
      "",
    ].join("\n");
    expect(find(PJ, text)).toEqual([
      at(PJ, 3, "docs/index.js"),
      at(PJ, 5, "./.claude/x.js"),
      at(PJ, 8, "docs/"),
      at(PJ, 9, "docs/t.js"),
    ]);
  });

  it("WI-5/T12 (ii) module, types, typings, browser as strings; not version", () => {
    const text = [
      "{",
      '  "module": "docs/m.js",',
      '  "types": "docs/t.d.ts",',
      '  "typings": "docs/u.d.ts",',
      '  "browser": "docs/b.js",',
      '  "version": "docs/v"',
      "}",
      "",
    ].join("\n");
    expect(find(PJ, text)).toEqual([
      at(PJ, 2, "docs/m.js"),
      at(PJ, 3, "docs/t.d.ts"),
      at(PJ, 4, "docs/u.d.ts"),
      at(PJ, 5, "docs/b.js"),
    ]);
  });

  it("WI-5/T12 (iii) browser object form: values, not keys", () => {
    const text = [
      "{",
      '  "browser": {',
      '    "./docs/k.js": "./lib/k.js",',
      '    "./x.js": "./docs/bx.js"',
      "  }",
      "}",
      "",
    ].join("\n");
    expect(find(PJ, text)).toEqual([at(PJ, 4, "./docs/bx.js")]);
  });
});
