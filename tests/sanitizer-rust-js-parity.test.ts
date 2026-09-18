/**
 * Fix 4 — Rust ↔ JS sanitizer parity.
 *
 * The two render surfaces (Rust `sanitize_html`, JS `sanitizeExportFragment`)
 * must agree on the security-relevant allow-list: the math tag set, the SVG
 * tag set, the SVG attribute set, and the URI scheme set. If they drift, one
 * surface admits something the other strips — exactly the class of bug Fix 4
 * closes. This test parses the Rust constants from source and compares them to
 * the exported JS arrays.
 *
 * SCOPE, and it is narrower than "the two surfaces mirror each other":
 *   - `SANITIZE_DOM: false` is a DELIBERATE JS-side divergence (ADR-0003 B′).
 *     ammonia never stripped a colliding `id`, so the flag closes a gap rather
 *     than opening one; nothing here asserts on it.
 *   - The BASE ATTRIBUTE set is NOT compared. ADR-0011 records that as a known
 *     gap and explicitly declines to close it here: `BASE_ATTRS` holds 21
 *     attributes while ammonia's generic set holds 4, the rest arriving via
 *     `add_tag_attributes` and ammonia's own defaults, so an honest subset
 *     assertion must first compute that union. Because the base set is
 *     uncompared, the `name` drift ADR-0011 fixed was structurally invisible to
 *     this file — and the next base-attribute drift will be too.
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
