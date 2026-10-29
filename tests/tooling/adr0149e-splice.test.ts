// @vitest-environment node
/**
 * ADR0149E-4c (AC-4, ADR-0149 d2: "Rust inline tests make the restore a per-file
 * splice"): spliceTestMods keeps the base's production text and takes every top-level
 * `#[cfg(test)] mod` item from the head, refusing shapes whose test boundary is a guess.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no .d.ts by design
import { spliceTestMods } from "../../scripts/tdd/rust-splice.mjs";

const inline = (body: string) => `#[cfg(test)]\nmod tests {\n    ${body}\n}\n`;

describe("ADR0149E-4c Rust test-module splice", () => {
  it("replaces the base's inline test module with the head's and keeps base production", () => {
    const base = `pub fn v() -> i32 {\n    1\n}\n\n${inline("fn old() {}")}`;
    const head = `pub fn v() -> i32 {\n    2\n}\n\n${inline("fn new() {}")}`;
    expect(spliceTestMods(base, head)).toBe(`pub fn v() -> i32 {\n    1\n}\n\n${inline("fn new() {}")}`);
  });

  it("carries an out-of-line test declaration the head added, after base production", () => {
    const base = "pub fn v() {}\n";
    const head = 'pub fn v() { changed(); }\n\n#[cfg(test)]\n#[path = "v_tests.rs"]\nmod v_tests;\n';
    expect(spliceTestMods(base, head)).toBe('pub fn v() {}\n\n#[cfg(test)]\n#[path = "v_tests.rs"]\nmod v_tests;\n');
  });

  it("drops a test module the head removed, and keeps item-level cfg(test) seams at base", () => {
    const base = `pub fn v() {}\n#[cfg(test)]\npub fn seam() -> i32 {\n    1\n}\n\n${inline("fn t() {}")}`;
    const head = "pub fn v() {}\n#[cfg(test)]\npub fn seam() -> i32 {\n    2\n}\n";
    expect(spliceTestMods(base, head)).toBe("pub fn v() {}\n#[cfg(test)]\npub fn seam() -> i32 {\n    1\n}\n\n");
  });

  it("skips braces inside strings, raw strings, chars, lifetimes and comments", () => {
    const tricky = 'pub fn s<\'a>(x: &\'a str) -> &\'a str {\n    let _ = "}{"; let _ = r#"{"#; let _ = \'{\'; let _ = b"}";\n    // }\n    /* { /* } */ { */\n    x\n}\n';
    const base = `${tricky}\n${inline("fn old() {}")}`;
    const head = `${tricky}\n${inline('fn new() { let _ = "}"; }')}`;
    expect(spliceTestMods(base, head)).toBe(`${tricky}\n${inline('fn new() { let _ = "}"; }')}`);
  });

  it("splices a test module inside a production module within that module, and takes cfg(all(test, …)) as a test gate", () => {
    const base = "mod outer {\n    pub fn p() {}\n\n    #[cfg(test)]\n    mod tests {\n        fn old() {}\n    }\n}\n";
    const head = "mod outer {\n    pub fn p() { changed(); }\n\n    #[cfg(test)]\n    mod tests {\n        fn new() {}\n    }\n}\n\n#[cfg(all(test, unix))]\nmod unix_tests;\n";
    expect(spliceTestMods(base, head)).toBe("mod outer {\n    pub fn p() {}\n\n    #[cfg(test)]\n    mod tests {\n        fn new() {}\n    }\n}\n\n#[cfg(all(test, unix))]\nmod unix_tests;\n");
    expect(() => spliceTestMods("pub fn v() {}\n", "mod outer {\n    #[cfg(test)]\n    mod t {}\n}\n")).toThrow(/outer/);
  });

  it("refuses a test module inside a function body, a cfg that only mentions test, and unbalanced braces", () => {
    expect(() => spliceTestMods("pub fn v() {}\n", "pub fn v() {\n    #[cfg(test)]\n    mod t {}\n}\n")).toThrow(/inside a non-module/);
    expect(() => spliceTestMods("pub fn v() {}\n", "#[cfg(any(test, feature = \"x\"))]\nmod t {}\n")).toThrow(/cfg/);
    expect(() => spliceTestMods("pub fn v() {}\n", "#[cfg_attr(test, path = \"t.rs\")]\nmod t;\n")).toThrow(/cfg/);
    expect(() => spliceTestMods("pub fn v() {\n", inline("fn t() {}"))).toThrow(/unbalanced/);
  });

  it("keeps a test module nested inside the head's test module as part of it", () => {
    const head = "pub fn v() {}\n\n#[cfg(test)]\nmod tests {\n    #[cfg(test)]\n    mod inner {}\n}\n";
    expect(spliceTestMods("pub fn v() {}\n", head)).toBe(`pub fn v() {}\n\n#[cfg(test)]\nmod tests {\n    #[cfg(test)]\n    mod inner {}\n}\n`);
  });
});
