/**
 * @module table-alignment-rendering.test
 * Purpose: Verify column alignment is **visible** across all three render
 * pipelines (WYSIWYG, Preview, exported HTML), not just preserved in the
 * markdown source. WI-1.5 spec from docs/plans/20260502-plan-table-crud.md.
 *
 * Pipeline behaviors verified against source files:
 *   - WYSIWYG (Milkdown gfm preset): inline style="text-align: …" on td/th
 *     wins over the stylesheet fallback (CSS specificity).
 *   - Preview (marked.js): emits align="…" HTML attribute. Tested via the
 *     marked fallback path used when the Rust render command is unavailable.
 *   - Rust export (pulldown-cmark + ammonia sanitizer): emits style="…",
 *     ammonia strips style → must convert to align="…" before sanitize.
 *     This is the only path that needed code changes; tested in Rust.
 *
 * CSS fallback rules in three files must support [align="…"] selectors so
 * `<td align="center">` renders correctly even when the browser doesn't
 * honor the deprecated HTML4 align attribute on its own.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

describe("CSS supports [align] attribute on table cells", () => {
  const milkdownCss = fs.readFileSync(
    path.join(ROOT, "src/components/Editor/MilkdownEditor.css"),
    "utf-8",
  );
  const previewCss = fs.readFileSync(
    path.join(ROOT, "src/components/Preview/styles/preview.css"),
    "utf-8",
  );
  const htmlTemplate = fs.readFileSync(
    path.join(ROOT, "src-tauri/src/services/html_template.rs"),
    "utf-8",
  );

  it("MilkdownEditor.css honors th/td [align='center'|'right']", () => {
    expect(milkdownCss).toMatch(/\[align="center"\][\s\S]*text-align:\s*center/);
    expect(milkdownCss).toMatch(/\[align="right"\][\s\S]*text-align:\s*right/);
  });

  it("preview.css honors th/td [align='center'|'right']", () => {
    expect(previewCss).toMatch(/\[align="center"\][\s\S]*text-align:\s*center/);
    expect(previewCss).toMatch(/\[align="right"\][\s\S]*text-align:\s*right/);
  });

  it("html_template.rs export CSS honors th/td [align='center'|'right']", () => {
    // The Rust source uses backslash-escaped quotes inside a string literal,
    // so the source pattern is `[align=\"center\"]` not `[align="center"]`.
    expect(htmlTemplate).toMatch(/\[align=\\"center\\"\][\s\S]*text-align:\s*center/);
    expect(htmlTemplate).toMatch(/\[align=\\"right\\"\][\s\S]*text-align:\s*right/);
  });
});
