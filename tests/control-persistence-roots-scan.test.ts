// @vitest-environment node
/**
 * ADR-0047 WI-002 WI-7: the `dirs::` call-site scanner on fixture trees.
 * Matrix: `.claude/tdd-guardian/tests-20261003-061500.md` (r1), WI-7
 * T02 (violation rows a-i), T03 (comments vs strings), T04 (scope
 * derivation), T05 (whitespace evasion), T10 (post-module call).
 * The live-tree and law cases are in the sibling `control-persistence-roots*`
 * files. Fixture trees live under `os.tmpdir()`; nothing reads `~`.
 */
import { describe, expect, it } from "vitest";
import {
  check,
  kinds,
  mkTree,
  rel,
  scanText,
  scanTree,
  scopeOf,
  type Entry,
} from "./helpers/persistenceRootsTree";

const entry = (over: Entry): Entry => ({ count: 1, scope: "production", root: "data/mdpro", ...over });
const run = (files: Record<string, string>, sites: Entry[]) =>
  check({ sites }, scanTree(mkTree(files)));

describe("WI7-T02 violation rows", () => {
  it("(a) an unregistered call is reported with file and call", () => {
    const vs = run({ "a.rs": "fn f() { dirs::cache_dir(); }\n" }, []);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ kind: "unregistered", file: rel("a.rs"), call: "cache_dir" });
  });

  const forms: [string, string][] = [
    ["use path", "use dirs::home_dir;\n"],
    ["use group", "use dirs::{data_dir};\n"],
    ["use as", "use dirs as d;\n"],
    ["extern crate as", "extern crate dirs as d;\n"],
    ["leading ::", "use ::dirs as d;\n"],
    ["braced root", "use {dirs as d};\n"],
    ["self as", "use dirs::{self as d};\n"],
    ["multi-line group", "use dirs::{\n    home_dir,\n};\n"],
    ["newline before group", "use dirs::\n{home_dir};\n"],
    ["pub(crate) use", "pub(crate) use dirs::data_dir;\n"],
    ["extern crate", "extern crate dirs;\n"],
  ];
  it.each(forms)("(b) forbidden import: %s", (_name, text) => {
    const vs = run({ "b.rs": `${text}fn f() {}\n` }, []);
    expect(kinds(vs)).toEqual(["forbidden-import"]);
    expect(vs[0].file).toBe(rel("b.rs"));
  });

  it("(b) a crate-local path ending in a `dirs` module is not the dirs crate", () => {
    expect(run({ "b.rs": "use crate::util::dirs::x;\n" }, [])).toEqual([]);
  });

  it("(c) a production entry whose site is inside `mod tests` is a scope mismatch", () => {
    const text = "#[cfg(test)]\nmod tests {\n    fn t() { dirs::data_dir(); }\n}\n";
    const vs = run({ "p.rs": text }, [entry({ file: rel("p.rs"), call: "data_dir" })]);
    expect(kinds(vs)).toEqual(["scope-mismatch"]);
    expect(vs[0]).toMatchObject({ file: rel("p.rs"), call: "data_dir" });
  });

  it("(d) registered count higher than found is stale", () => {
    const vs = run({ "a.rs": "fn f() { dirs::data_dir(); }\n" }, [
      entry({ file: rel("a.rs"), call: "data_dir", count: 2 }),
    ]);
    expect(kinds(vs)).toEqual(["stale"]);
  });

  it("(d') found count higher than registered is unregistered", () => {
    const vs = run({ "a.rs": "fn f() { dirs::data_dir(); dirs::data_dir(); }\n" }, [
      entry({ file: rel("a.rs"), call: "data_dir" }),
    ]);
    expect(kinds(vs)).toEqual(["unregistered"]);
  });

  it("(e) an entry for an absent file or an absent call is stale", () => {
    const files = { "a.rs": "fn f() { dirs::data_dir(); }\n" };
    const ok = entry({ file: rel("a.rs"), call: "data_dir" });
    expect(kinds(run(files, [ok, entry({ file: rel("gone.rs"), call: "data_dir" })]))).toEqual(["stale"]);
    expect(kinds(run(files, [ok, entry({ file: rel("a.rs"), call: "home_dir" })]))).toEqual(["stale"]);
  });

  it("(f) a production entry without root is missing-root", () => {
    const vs = run({ "a.rs": "fn f() { dirs::data_dir(); }\n" }, [
      { file: rel("a.rs"), call: "data_dir", count: 1, scope: "production" },
    ]);
    expect(kinds(vs)).toEqual(["missing-root"]);
  });

  const files = { "a.rs": "fn f() { dirs::cache_dir(); }\n" };
  const ok = entry({ file: rel("a.rs"), call: "cache_dir" });
  const bad: [string, Entry][] = [
    ["unknown scope", { file: rel("a.rs"), call: "cache_dir", count: 1, scope: "prod" }],
    ["absolute file", entry({ file: "/x/src-tauri/src/a.rs", call: "cache_dir" })],
    ["file outside src-tauri/src", entry({ file: "src/a.rs", call: "cache_dir" })],
    ["dot-dot file", entry({ file: "src-tauri/src/../a.rs", call: "cache_dir" })],
    ["line key", entry({ file: rel("a.rs"), call: "cache_dir", line: 1 })],
    ["count zero", entry({ file: rel("a.rs"), call: "cache_dir", count: 0 })],
    ["root on a test entry", { file: rel("a.rs"), call: "cache_dir", count: 1, scope: "test", root: "home/.mdpro" }],
  ];
  it.each(bad)("(g) bad-entry: %s", (_name, e) => {
    expect(kinds(run(files, [ok, e]))).toEqual(["bad-entry"]);
  });

  it("(h) production-guard outside verify_run.rs is a bad entry", () => {
    const vs = run({ "services/other.rs": "fn f() { dirs::home_dir(); }\n" }, [
      { file: rel("services/other.rs"), call: "home_dir", count: 1, scope: "production-guard" },
    ]);
    expect(kinds(vs)).toEqual(["bad-entry", "unregistered"]);
  });

  it("(i) production-guard carrying a root is a bad entry", () => {
    const vs = run({ "services/verify_run.rs": "fn f() { dirs::home_dir(); }\n" }, [
      entry({ file: rel("services/verify_run.rs"), call: "home_dir", scope: "production-guard", root: "home/.mdpro" }),
    ]);
    expect(kinds(vs)).toEqual(["bad-entry", "unregistered"]);
  });
});

describe("WI7-T03 comments do not count; strings do", () => {
  const commented = [
    "// dirs::cache_dir()",
    "/// dirs::cache_dir()",
    "//! dirs::cache_dir()",
    "/* dirs::cache_dir() */",
    "/* outer /* dirs::cache_dir() */ still dirs::cache_dir() */",
  ];
  it.each(commented)("no site for %s", (line) => {
    expect(scanText(rel("c.rs"), `${line}\nfn f() {}\n`).sites).toEqual([]);
  });

  it("raw and normal string mentions are counted", () => {
    const text = 'fn f() {\n    let a = r#"dirs::cache_dir()"#;\n    let b = "dirs::x()";\n}\n';
    expect(scanText(rel("s.rs"), text).sites).toEqual([
      { file: rel("s.rs"), call: "cache_dir", count: 1, scope: "production" },
      { file: rel("s.rs"), call: "x", count: 1, scope: "production" },
    ]);
  });
});

describe("WI7-T04 scope derivation boundaries", () => {
  const call = "fn f() { dirs::data_dir(); }\n";
  it.each(["x_tests.rs", "foo_test_support.rs", "driver_fixtures.rs", "y_fixture.rs", "draft_test_home.rs"])(
    "%s is test throughout",
    (name) => {
      expect(scopeOf(rel(`m/${name}`), call, "data_dir")).toEqual(["test"]);
    },
  );

  it("before / inside an inline `#[cfg(test)] mod tests {`", () => {
    const text = `fn a() { dirs::home_dir(); }\n#[cfg(test)]\nmod tests {\n    fn b() { dirs::home_dir(); }\n}\n`;
    const sites = scanText(rel("p.rs"), text).sites;
    expect(sites).toEqual([
      { file: rel("p.rs"), call: "home_dir", count: 1, scope: "production" },
      { file: rel("p.rs"), call: "home_dir", count: 1, scope: "test" },
    ]);
  });

  it("an out-of-line `#[cfg(test)] mod tests;` does not flip later lines", () => {
    const text = `#[cfg(test)]\nmod tests;\nfn later() { dirs::home_dir(); }\n`;
    expect(scopeOf(rel("p.rs"), text, "home_dir")).toEqual(["production"]);
  });

  const cfgRows: [string, string][] = [
    ['target_os = "windows"', "production-other-os"],
    ['not(target_os = "windows")', "production"],
    ['any(target_os = "windows", target_os = "macos")', "production"],
    ['not(any(target_os = "macos", target_os = "windows"))', "production-other-os"],
    ['target_os = "macos"', "production"],
    ["unix", "production"],
    ["not(unix)", "production-other-os"],
    ['all(unix, not(target_os = "macos"))', "production-other-os"],
    ['feature = "verify-run"', "production"],
  ];
  it.each(cfgRows)("block under #[cfg(%s)] is %s", (pred, scope) => {
    const text = `fn f() {\n    #[cfg(${pred})]\n    {\n        dirs::config_dir();\n    }\n    dirs::home_dir();\n}\n`;
    expect(scopeOf(rel("m.rs"), text, "config_dir")).toEqual([scope]);
    expect(scopeOf(rel("m.rs"), text, "home_dir")).toEqual(["production"]);
  });

  it("a cfg on an item covers that item's body only", () => {
    const text = `#[cfg(target_os = "windows")]\nfn w(a: u8, b: u8) -> u8 { dirs::config_dir(); a }\nfn m() { dirs::config_dir(); }\n`;
    expect(scopeOf(rel("m.rs"), text, "config_dir").sort()).toEqual(["production", "production-other-os"]);
  });

  it("a brace inside a string or char literal does not end a test module", () => {
    const text = `#[cfg(test)]\nmod tests {\n    const S: &str = "}";\n    const C: char = '}';\n    fn t() { dirs::home_dir(); }\n}\n`;
    expect(scopeOf(rel("p.rs"), text, "home_dir")).toEqual(["test"]);
  });

  it("the guard's own calls in verify_run.rs: derived production, production-guard accepted", () => {
    const text = "pub fn check() {\n    let _ = dirs::home_dir();\n    let _ = dirs::data_dir();\n}\n";
    const src = mkTree({ "services/verify_run.rs": text });
    const scan = scanTree(src);
    expect(scan.sites.map((s) => s.scope)).toEqual(["production", "production"]);
    const guard = (c: string): Entry => ({
      file: rel("services/verify_run.rs"),
      call: c,
      count: 1,
      scope: "production-guard",
    });
    expect(check({ sites: [guard("data_dir"), guard("home_dir")] }, scan)).toEqual([]);
  });
});

describe("WI7-T05 whitespace evasion", () => {
  it.each(["fn f() { dirs :: home_dir(); }\n", "fn f() { dirs::\n    home_dir(); }\n"])(
    "%j is reported as a site",
    (text) => {
      expect(scopeOf(rel("w.rs"), text, "home_dir")).toEqual(["production"]);
    },
  );
});

describe("WI7-T10 a call after a closed `mod tests { }` is production", () => {
  it("tracks the module's brace extent", () => {
    const text = "#[cfg(test)]\nmod tests {\n}\nfn later() { dirs::cache_dir(); }\n";
    expect(scanTree(mkTree({ "p.rs": text })).sites).toEqual([
      { file: rel("p.rs"), call: "cache_dir", count: 1, scope: "production" },
    ]);
  });
});
