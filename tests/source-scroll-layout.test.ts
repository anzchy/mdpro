// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const cssPath = path.resolve(__dirname, "../src/styles/globals.css");
const css = fs.readFileSync(cssPath, "utf-8");

function blockFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("source mode scroll layout", () => {
  it("keeps the source editor shell height-constrained", () => {
    const block = blockFor(".editor-shell");

    expect(block).toContain("display: flex");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("min-height: 0");
  });

  it("constrains the CodeMirror theme wrapper instead of letting content set height", () => {
    const block = blockFor(".editor-shell .cm-theme-light,\n.editor-shell .cm-theme-dark");

    expect(block).toContain("display: flex");
    expect(block).toContain("flex: 1");
    expect(block).toContain("min-height: 0");
  });

  it("uses the CodeMirror scroller as the vertical overflow container", () => {
    const block = blockFor(".editor-shell .cm-scroller");

    expect(block).toContain("overflow: auto");
  });
});
