// @vitest-environment node
/**
 * Tests for cross-platform image path resolution (issue #41).
 *
 * Covers resolveImageSrc() from imagePathUtils.ts:
 *   - macOS/Linux absolute and relative paths (regression)
 *   - Windows absolute paths with backslashes and drive letters
 *   - Windows relative paths when documentPath uses backslashes
 *   - Remote and asset URLs passthrough
 */

import { describe, expect, it, vi } from "vitest";

// Mock convertFileSrc so tests don't need a Tauri runtime.
// The mock simply prefixes paths with "asset://localhost/" to make
// assertions readable without requiring a real Tauri environment.
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  convertFileSrc: (path: string) => {
    // Strip leading "/" for Unix paths to match the expected format
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `asset://localhost/${normalized}`;
  },
}));

import {
  normalizeSeparators,
  isWindowsAbsolutePath,
  resolveImageSrc,
} from "../src/services/imagePathUtils";

// ---------------------------------------------------------------------------
// normalizeSeparators
// ---------------------------------------------------------------------------

describe("normalizeSeparators", () => {
  it.each([
    { input: "C:\\Users\\jack\\image.png", expected: "C:/Users/jack/image.png" },
    { input: "/home/jack/image.png", expected: "/home/jack/image.png" },
    { input: "./image.png", expected: "./image.png" },
    { input: "../assets/img.jpg", expected: "../assets/img.jpg" },
    { input: "", expected: "" },
  ])("normalizes $input", ({ input, expected }) => {
    expect(normalizeSeparators(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isWindowsAbsolutePath
// ---------------------------------------------------------------------------

describe("isWindowsAbsolutePath", () => {
  it.each([
    { input: "C:\\Users\\image.png", expected: true },
    { input: "C:/Users/image.png", expected: true },
    { input: "c:/users/image.png", expected: true },
    { input: "D:\\work\\photo.jpg", expected: true },
    { input: "/home/jack/image.png", expected: false },
    { input: "./image.png", expected: false },
    { input: "../image.png", expected: false },
    { input: "image.png", expected: false },
    { input: "", expected: false },
  ])("returns $expected for '$input'", ({ input, expected }) => {
    expect(isWindowsAbsolutePath(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// resolveImageSrc — passthrough cases
// ---------------------------------------------------------------------------

describe("resolveImageSrc — passthrough for remote/asset URLs", () => {
  it("returns https:// URL unchanged", () => {
    expect(resolveImageSrc("https://example.com/img.png", null))
      .toBe("https://example.com/img.png");
  });

  it("returns http:// URL unchanged", () => {
    expect(resolveImageSrc("http://example.com/img.png", null))
      .toBe("http://example.com/img.png");
  });

  it("returns data: URI unchanged", () => {
    expect(resolveImageSrc("data:image/png;base64,abc==", null))
      .toBe("data:image/png;base64,abc==");
  });

  it("returns asset:// URL unchanged", () => {
    expect(resolveImageSrc("asset://localhost/path/img.png", null))
      .toBe("asset://localhost/path/img.png");
  });

  it("returns tauri:// URL unchanged", () => {
    expect(resolveImageSrc("tauri://localhost/img.png", null))
      .toBe("tauri://localhost/img.png");
  });
});

// ---------------------------------------------------------------------------
// resolveImageSrc — macOS/Unix absolute paths
// ---------------------------------------------------------------------------

describe("resolveImageSrc — Unix absolute paths", () => {
  it("converts Unix absolute path via convertFileSrc", () => {
    expect(resolveImageSrc("/home/jack/image.png", null))
      .toBe("asset://localhost/home/jack/image.png");
  });
});

// ---------------------------------------------------------------------------
// resolveImageSrc — macOS relative paths (regression)
// ---------------------------------------------------------------------------

describe("resolveImageSrc — macOS relative paths", () => {
  const docPath = "/Users/jack/docs/notes.md";

  it("resolves ./image.png relative to document dir", () => {
    expect(resolveImageSrc("./image.png", docPath))
      .toBe("asset://localhost/Users/jack/docs/image.png");
  });

  it("resolves bare filename relative to document dir", () => {
    expect(resolveImageSrc("image.png", docPath))
      .toBe("asset://localhost/Users/jack/docs/image.png");
  });

  it("resolves ./subdir/image.png relative to document dir", () => {
    expect(resolveImageSrc("./images/photo.jpg", docPath))
      .toBe("asset://localhost/Users/jack/docs/images/photo.jpg");
  });

  it("resolves ../sibling/image.png (parent reference)", () => {
    expect(resolveImageSrc("../assets/logo.svg", docPath))
      .toBe("asset://localhost/Users/jack/assets/logo.svg");
  });

  it("returns src unchanged when no documentPath and path is relative", () => {
    expect(resolveImageSrc("./image.png", null)).toBe("./image.png");
    expect(resolveImageSrc("image.png", null)).toBe("image.png");
  });
});

// ---------------------------------------------------------------------------
// resolveImageSrc — Windows absolute paths (issue #41)
// ---------------------------------------------------------------------------

describe("resolveImageSrc — Windows absolute paths", () => {
  it("converts Windows backslash absolute path via convertFileSrc", () => {
    expect(resolveImageSrc("C:\\Users\\jack\\image.png", null))
      .toBe("asset://localhost/C:/Users/jack/image.png");
  });

  it("converts Windows forward-slash absolute path via convertFileSrc", () => {
    expect(resolveImageSrc("C:/Users/jack/image.png", null))
      .toBe("asset://localhost/C:/Users/jack/image.png");
  });

  it("handles drive letters other than C:", () => {
    expect(resolveImageSrc("D:\\work\\photo.jpg", null))
      .toBe("asset://localhost/D:/work/photo.jpg");
  });
});

// ---------------------------------------------------------------------------
// resolveImageSrc — Windows relative paths (issue #41)
// ---------------------------------------------------------------------------

describe("resolveImageSrc — Windows relative paths with Windows documentPath", () => {
  const winDocPath = "C:\\Users\\jack\\docs\\notes.md";

  it("resolves ./image.png against Windows document path", () => {
    expect(resolveImageSrc("./image.png", winDocPath))
      .toBe("asset://localhost/C:/Users/jack/docs/image.png");
  });

  it("resolves bare filename against Windows document path", () => {
    expect(resolveImageSrc("image.png", winDocPath))
      .toBe("asset://localhost/C:/Users/jack/docs/image.png");
  });

  it("resolves ./subdir/img.png against Windows document path", () => {
    expect(resolveImageSrc("./images/photo.jpg", winDocPath))
      .toBe("asset://localhost/C:/Users/jack/docs/images/photo.jpg");
  });

  it("resolves ../assets/img.png against Windows document path", () => {
    expect(resolveImageSrc("../assets/logo.svg", winDocPath))
      .toBe("asset://localhost/C:/Users/jack/assets/logo.svg");
  });

  it("resolves with Windows forward-slash document path", () => {
    expect(resolveImageSrc("./image.png", "C:/Users/jack/docs/notes.md"))
      .toBe("asset://localhost/C:/Users/jack/docs/image.png");
  });
});
