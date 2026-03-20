/**
 * Tests for image drag-drop insertion (issue #12).
 *
 * Covers the two pure helpers extracted into imageService.ts:
 *   - resolveImageInsertPath(imagePath, docPath) → relative path string or null
 *   - buildImageMarkdown(imagePath, docPath)     → markdown string or null
 */
import { describe, expect, it } from "vitest";
import {
  resolveImageInsertPath,
  buildImageMarkdown,
} from "../src/services/imageService";

// ---------------------------------------------------------------------------
// resolveImageInsertPath
// ---------------------------------------------------------------------------

describe("resolveImageInsertPath", () => {
  it("returns a relative path when both image and doc paths are provided", () => {
    const result = resolveImageInsertPath(
      "/Users/jack/docs/images/photo.png",
      "/Users/jack/docs/notes.md",
    );
    // Image is in a sibling 'images' folder — relative to doc dir
    expect(result).toBe("./images/photo.png");
  });

  it("returns './<filename>' when image is in the same directory as the doc", () => {
    const result = resolveImageInsertPath(
      "/Users/jack/docs/photo.png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("./photo.png");
  });

  it("returns null when docPath is null (no open document)", () => {
    const result = resolveImageInsertPath(
      "/Users/jack/photo.png",
      null,
    );
    expect(result).toBeNull();
  });

  it("handles deeply nested image relative to doc directory", () => {
    const result = resolveImageInsertPath(
      "/Users/jack/docs/assets/2024/photo.png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("./assets/2024/photo.png");
  });

  it("handles image outside the doc directory (parent folder)", () => {
    const result = resolveImageInsertPath(
      "/Users/jack/photo.png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("../photo.png");
  });

  it("returns null when imagePath is empty string", () => {
    const result = resolveImageInsertPath("", "/Users/jack/docs/notes.md");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildImageMarkdown
// ---------------------------------------------------------------------------

describe("buildImageMarkdown", () => {
  it("returns markdown image syntax with filename (no extension) as alt text", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/photo.png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![photo](./photo.png)");
  });

  it("strips the extension from filename for alt text", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/images/my-screenshot.jpg",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![my-screenshot](./images/my-screenshot.jpg)");
  });

  it("returns null when no document is open (docPath is null)", () => {
    const result = buildImageMarkdown(
      "/Users/jack/photo.png",
      null,
    );
    expect(result).toBeNull();
  });

  it("handles .webp extension", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/animation.webp",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![animation](./animation.webp)");
  });

  it("handles .svg extension", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/logo.svg",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![logo](./logo.svg)");
  });

  it("handles .gif extension", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/demo.gif",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![demo](./demo.gif)");
  });

  it("returns null when imagePath is empty string", () => {
    const result = buildImageMarkdown("", "/Users/jack/docs/notes.md");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple images (array scenario — tested via repeated buildImageMarkdown)
// ---------------------------------------------------------------------------

describe("multiple image drop — markdown generation", () => {
  it("produces one markdown line per image when looped", () => {
    const docPath = "/Users/jack/docs/notes.md";
    const images = [
      "/Users/jack/docs/a.png",
      "/Users/jack/docs/b.jpg",
    ];
    const lines = images
      .map((img) => buildImageMarkdown(img, docPath))
      .filter(Boolean);
    expect(lines).toEqual([
      "![a](./a.png)",
      "![b](./b.jpg)",
    ]);
    expect(lines.join("\n")).toBe("![a](./a.png)\n![b](./b.jpg)");
  });

  it("filters out null entries when no docPath is available", () => {
    const images = ["/Users/jack/a.png", "/Users/jack/b.png"];
    const lines = images
      .map((img) => buildImageMarkdown(img, null))
      .filter(Boolean);
    expect(lines).toHaveLength(0);
  });
});
