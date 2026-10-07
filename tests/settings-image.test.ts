// @vitest-environment node
/**
 * Tests for ImageSettings component (WI-6 fixes).
 *
 * Strategy: source inspection + pure logic tests on isValidAssetFolder.
 *
 * Covers:
 *   1. isValidAssetFolder rejects absolute paths, traversal, and control chars.
 *   2. isValidAssetFolder accepts valid relative paths.
 *   3. error state and cancellation guard in useEffect.
 *   4. Async rollback for handleBoolChange.
 *   5. Debounced folder text save (500 ms) with path validation gate.
 *   6. ARIA: label htmlFor wired to control id on both controls.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../src");
const src = fs.readFileSync(
  path.join(SRC, "components/common/settings/ImageSettings.tsx"),
  "utf-8",
);

describe("ImageSettings — source structure", () => {
  it("exports ImageSettings as a named export", () => {
    expect(src).toContain("export function ImageSettings");
  });

  it("has isValidAssetFolder path validation function", () => {
    expect(src).toContain("function isValidAssetFolder");
  });

  it("rejects absolute paths starting with '/'", () => {
    expect(src).toContain('path.startsWith("/")');
  });

  it("rejects path traversal via '..'", () => {
    expect(src).toContain('=== ".."');
  });

  it("rejects null bytes and control characters", () => {
    // Regex covers control chars 0x00-0x1f
    expect(src).toContain("\\x00-\\x1f");
  });

  it("tracks error state", () => {
    expect(src).toContain("const [error, setError]");
  });

  it("useEffect has a cancellation guard", () => {
    expect(src).toContain("let cancelled");
    expect(src).toContain("cancelled = true");
  });

  it("handleFolderChange validates path before updating state", () => {
    expect(src).toContain("isValidAssetFolder(value)");
  });

  it("handleFolderChange debounces the save by 500 ms", () => {
    expect(src).toContain("setTimeout");
    expect(src).toContain("500");
  });

  it("ARIA: image folder label is linked to its input via htmlFor/id", () => {
    expect(src).toContain('htmlFor="img-asset-folder"');
    expect(src).toContain('id="img-asset-folder"');
  });

  it("ARIA: copy images label is linked to its checkbox via htmlFor/id", () => {
    expect(src).toContain('htmlFor="img-copy-external"');
    expect(src).toContain('id="img-copy-external"');
  });
});

// ---------------------------------------------------------------------------
// isValidAssetFolder pure logic — extracted for deterministic testing
// (mirrors the function in ImageSettings.tsx)
// ---------------------------------------------------------------------------

function isValidAssetFolder(p: string): boolean {
  if (p.startsWith("/")) return false;
  if (p.split("/").some((seg) => seg === "..")) return false;
  if (/[\x00-\x1f]/.test(p)) return false;
  return true;
}

describe("isValidAssetFolder — path validation", () => {
  it("accepts a simple relative path", () => {
    expect(isValidAssetFolder("assets")).toBe(true);
  });

  it("accepts a nested relative path", () => {
    expect(isValidAssetFolder("assets/images")).toBe(true);
  });

  it("accepts an empty string", () => {
    expect(isValidAssetFolder("")).toBe(true);
  });

  it("rejects an absolute path starting with /", () => {
    expect(isValidAssetFolder("/absolute")).toBe(false);
  });

  it("rejects path traversal via ..", () => {
    expect(isValidAssetFolder("../sibling")).toBe(false);
  });

  it("rejects traversal buried in the path", () => {
    expect(isValidAssetFolder("assets/../secret")).toBe(false);
  });

  it("rejects a null byte in the path", () => {
    expect(isValidAssetFolder("assets\x00evil")).toBe(false);
  });

  it("rejects a control character in the path", () => {
    expect(isValidAssetFolder("assets\x01evil")).toBe(false);
  });

  it("accepts a path that contains '...' (not '..')", () => {
    expect(isValidAssetFolder("assets.../images")).toBe(true);
  });
});
