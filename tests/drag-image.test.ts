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
// Windows path support (issue #41)
// ---------------------------------------------------------------------------

describe("resolveImageInsertPath — Windows paths", () => {
  it("resolves sibling-folder image with Windows backslash paths", () => {
    const result = resolveImageInsertPath(
      "C:\\Users\\jack\\docs\\images\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("./images/photo.png");
  });

  it("resolves same-dir image with Windows backslash paths", () => {
    const result = resolveImageInsertPath(
      "C:\\Users\\jack\\docs\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("./photo.png");
  });

  it("resolves parent-dir image with Windows backslash paths", () => {
    const result = resolveImageInsertPath(
      "C:\\Users\\jack\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("../photo.png");
  });

  it("resolves image with Windows forward-slash paths", () => {
    const result = resolveImageInsertPath(
      "C:/Users/jack/docs/images/photo.png",
      "C:/Users/jack/docs/notes.md",
    );
    expect(result).toBe("./images/photo.png");
  });
});

describe("buildImageMarkdown — Windows paths", () => {
  it("produces correct markdown with Windows backslash image path", () => {
    const result = buildImageMarkdown(
      "C:\\Users\\jack\\docs\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("![photo](./photo.png)");
  });

  it("extracts filename correctly from Windows backslash path", () => {
    const result = buildImageMarkdown(
      "C:\\Users\\jack\\docs\\images\\my-screenshot.jpg",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("![my-screenshot](./images/my-screenshot.jpg)");
  });
});

describe("resolveImageInsertPath — Windows cross-drive and case-insensitivity", () => {
  it("returns absolute path when image is on a different drive (D: vs C:)", () => {
    const result = resolveImageInsertPath(
      "D:\\images\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    // Cross-drive — return normalized absolute path, not a broken ../../ sequence
    expect(result).toBe("D:/images/photo.png");
  });

  it("handles case-insensitive drive letters (c: vs C:)", () => {
    const result = resolveImageInsertPath(
      "C:\\Users\\jack\\docs\\photo.png",
      "c:\\Users\\jack\\docs\\notes.md",
    );
    expect(result).toBe("./photo.png");
  });

  it("handles case-insensitive folder names", () => {
    const result = resolveImageInsertPath(
      "C:\\Users\\Jack\\Docs\\photo.png",
      "C:\\Users\\jack\\docs\\notes.md",
    );
    // Case-insensitive match — photo.png is in the same dir
    expect(result).toBe("./photo.png");
  });
});

describe("buildImageMarkdown — Markdown metacharacter escaping", () => {
  it("escapes ] in alt text from filename", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/my[photo].png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![my\\[photo\\]](<./my[photo].png>)");
  });

  it("escapes [ and ] in alt text (both brackets)", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/fig[1].png",
      "/Users/jack/docs/notes.md",
    );
    // Both [ and ] must be escaped in alt text
    expect(result).toContain("\\[");
    expect(result).toContain("\\]");
  });

  it("wraps path in angle brackets when it contains parentheses", () => {
    const result = buildImageMarkdown(
      "/Users/jack/docs/my(photo).png",
      "/Users/jack/docs/notes.md",
    );
    expect(result).toBe("![my(photo)](<./my(photo).png>)");
  });
});

describe("resolveImageInsertPath — macOS case-sensitive paths regression", () => {
  it("treats /Users/Jack and /Users/jack as different paths on macOS", () => {
    // macOS HFS+ is case-insensitive by default, but the code must not
    // collapse different-cased paths silently. We preserve case-sensitivity
    // for non-Windows paths to avoid masking bugs.
    const result = resolveImageInsertPath(
      "/Users/Jack/docs/photo.png",
      "/Users/jack/docs/notes.md",
    );
    // Shared prefix: ["", "Users"] (jack ≠ Jack stops at index 2)
    // upCount = 2, downParts = ["Jack", "docs", "photo.png"]
    expect(result).toBe("../../Jack/docs/photo.png");
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
