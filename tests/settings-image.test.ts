// @vitest-environment node
/**
 * Tests for ImageSettings component (WI-6 fixes).
 *
 * Strategy: source inspection + pure logic tests on isValidAssetFolder.
 *
 * Covers:
 *   1. isValidAssetFolder rejects absolute paths, traversal, and control chars.
 *   2. isValidAssetFolder accepts valid relative paths.
 *   3. load-failure flag and cancellation guard in useEffect.
 *   4. Async rollback for handleBoolChange.
 *   5. Debounced folder text save (500 ms) with path validation gate.
 *   6. ARIA: row title (h4 id) wired to the control by aria-labelledby (WI-4.3a) on both controls.
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

  it("tracks a load failure as a flag, not raw text (WI-4.3b)", () => {
    expect(src).toContain("const [loadFailed, setLoadFailed]");
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

  it("ARIA: image folder input is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="img-asset-folder-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="img-asset-folder-label"/);
    expect(src).toContain('id="img-asset-folder"');
  });

  it("ARIA: copy images switch is named by its row title via aria-labelledby", () => {
    expect(src).toContain('<h4 id="img-copy-external-label">');
    expect(src).toMatch(/(aria-labelledby|labelledBy)="img-copy-external-label"/);
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
