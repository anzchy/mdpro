/**
 * Fix 4 — Rust ↔ JS sanitizer parity.
 *
 * The two render surfaces (Rust `sanitize_html`, JS `sanitizeRenderedHtml`)
 * must agree on the security-relevant allow-list: the math tag set, the SVG
 * tag set, the SVG attribute set, and the URI scheme set. If they drift, one
 * surface admits something the other strips — exactly the class of bug Fix 4
 * closes. This test parses the Rust constants from source and compares them to
 * the exported JS arrays.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  MATH_TAGS,
  SVG_TAGS,
  SVG_ATTRS,
  ALLOWED_URI_SCHEMES,
} from "../src/services/sanitizerPolicy";

const RUST_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src-tauri/src/services/markdown.rs"),
  "utf-8",
);

/** Extract the string items of a `pub const NAME: &[&str] = &[ ... ];` block. */
function rustStrArray(name: string): string[] {
  const re = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`);
  const m = RUST_SRC.match(re);
  if (!m) throw new Error(`Rust const ${name} not found in markdown.rs`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Extract the schemes passed to `.url_schemes([...])`. */
function rustSchemes(): string[] {
  const m = RUST_SRC.match(/url_schemes\(\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("url_schemes(...) not found in markdown.rs");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const sorted = (a: string[]) => [...a].sort();

describe("sanitizer Rust↔JS parity", () => {
  it("MATH_TAGS match", () => {
    expect(sorted(MATH_TAGS)).toEqual(sorted(rustStrArray("MATH_TAGS")));
  });

  it("SVG_TAGS match", () => {
    expect(sorted(SVG_TAGS)).toEqual(sorted(rustStrArray("SVG_TAGS")));
  });

  it("SVG_ATTRS share the same security-relevant set", () => {
    // The Rust SVG_ATTRS additionally carries a few HTML/global attrs (width,
    // height, xmlns, class, id) that DOMPurify supplies from its base attr list
    // instead. Parity that matters: the JS SVG attr set must be a SUBSET of the
    // Rust set (JS must never admit an SVG attr Rust strips), and every
    // geometry/presentation attr the JS side declares must exist on the Rust
    // side.
    const rust = new Set(rustStrArray("SVG_ATTRS"));
    const jsOnly = SVG_ATTRS.filter((a) => !rust.has(a));
    expect(jsOnly, `JS SVG attrs absent from Rust: ${jsOnly.join(", ")}`).toEqual([]);
  });

  it("URI scheme sets are identical", () => {
    expect(sorted(ALLOWED_URI_SCHEMES)).toEqual(sorted(rustSchemes()));
  });
});
