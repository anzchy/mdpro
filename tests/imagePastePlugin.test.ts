import { describe, expect, it } from "vitest";
import {
  isSupportedImageType,
  validateImageSize,
  getImageExtension,
} from "../src/plugins/milkdown/imagePastePlugin";

describe("imagePastePlugin — isSupportedImageType", () => {
  it("accepts image/png", () => {
    expect(isSupportedImageType("image/png")).toBe(true);
  });

  it("accepts image/jpeg", () => {
    expect(isSupportedImageType("image/jpeg")).toBe(true);
  });

  it("rejects image/gif", () => {
    expect(isSupportedImageType("image/gif")).toBe(false);
  });

  it("rejects image/webp", () => {
    expect(isSupportedImageType("image/webp")).toBe(false);
  });

  it("rejects image/bmp", () => {
    expect(isSupportedImageType("image/bmp")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSupportedImageType("")).toBe(false);
  });

  it("rejects non-image MIME type", () => {
    expect(isSupportedImageType("text/plain")).toBe(false);
  });
});

describe("imagePastePlugin — validateImageSize", () => {
  const MB = 1024 * 1024;

  it("accepts 0 bytes", () => {
    expect(validateImageSize(0)).toBe(true);
  });

  it("accepts 1 MB", () => {
    expect(validateImageSize(1 * MB)).toBe(true);
  });

  it("accepts 4.99 MB", () => {
    expect(validateImageSize(4.99 * MB)).toBe(true);
  });

  it("accepts exactly 5 MB (boundary)", () => {
    expect(validateImageSize(5 * MB)).toBe(true);
  });

  it("rejects 5 MB + 1 byte", () => {
    expect(validateImageSize(5 * MB + 1)).toBe(false);
  });

  it("rejects 6 MB", () => {
    expect(validateImageSize(6 * MB)).toBe(false);
  });

  it("rejects 100 MB", () => {
    expect(validateImageSize(100 * MB)).toBe(false);
  });
});

describe("imagePastePlugin — getImageExtension", () => {
  it("returns jpg for image/jpeg", () => {
    expect(getImageExtension("image/jpeg")).toBe("jpg");
  });

  it("returns png for image/png", () => {
    expect(getImageExtension("image/png")).toBe("png");
  });

  it("returns png as fallback for unknown types", () => {
    expect(getImageExtension("image/webp")).toBe("png");
    expect(getImageExtension("")).toBe("png");
  });
});
