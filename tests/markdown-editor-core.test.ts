import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportService } from "../src/services/exportService";
import {
  fileToBase64,
  formatBytes,
  generateUniqueFilename,
  isRemoteUrl,
  uploadImage,
  uploadImagesBatch,
  copyExternalImage,
} from "../src/services/imageService";
import { parseHeadingsFromContent } from "../src/services/tocService";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("tocService.parseHeadingsFromContent", () => {
  it("parses heading levels and lines", () => {
    const markdown = [
      "# Title",
      "Paragraph",
      "## Section",
      "### Subsection ###",
      "not a heading",
      "###### Deep",
    ].join("\n");

    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(4);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 6]);
    expect(headings.map((h) => h.text)).toEqual([
      "Title",
      "Section",
      "Subsection",
      "Deep",
    ]);
    expect(headings.map((h) => h.line)).toEqual([1, 3, 4, 6]);
  });

  it("ignores invalid ATX headings", () => {
    const markdown = [
      "#ValidWithoutSpace",
      "####### TooManyHashes",
      "##",
      "###  ",
      "## Valid Heading",
    ].join("\n");

    const headings = parseHeadingsFromContent(markdown);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe("Valid Heading");
  });

  it("generates deterministic unique ids for duplicates", () => {
    const markdown = ["## Intro", "## Intro", "## Intro"].join("\n");
    const headings = parseHeadingsFromContent(markdown);

    expect(headings.map((h) => h.id)).toEqual(["intro", "intro-1", "intro-2"]);
  });

  it("normalizes punctuation and trailing heading hashes", () => {
    const markdown = "## Heading with (Brackets) & symbols! ###";
    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(1);
    expect(headings[0].id).toBe("heading-with-brackets-symbols");
    expect(headings[0].text).toBe("Heading with (Brackets) & symbols!");
  });

  it("tracks character offset of each heading", () => {
    const markdown = ["# A", "xx", "## B"].join("\n");
    const headings = parseHeadingsFromContent(markdown);

    expect(headings).toHaveLength(2);
    expect(headings[0].offset).toBe(0);
    // "# A\nxx\n" => 4 + 3 = 7
    expect(headings[1].offset).toBe(7);
  });
});

describe("exportService.renderMarkdown", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("uses backend HTML and sanitizes unsafe script tags", async () => {
    invokeMock.mockResolvedValueOnce({
      html: '<h1 data-heading-id="title">Title</h1><script>alert(1)</script><mark>x</mark><u>y</u>',
    });

    const html = await exportService.renderMarkdown("# Title");

    expect(invokeMock).toHaveBeenCalledWith("render_markdown", { content: "# Title" });
    expect(html).toContain('<h1 data-heading-id="title">Title</h1>');
    expect(html).toContain("<mark>x</mark>");
    expect(html).toContain("<u>y</u>");
    expect(html).not.toContain("<script>");
  });

  it("falls back to marked parser when backend invoke fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));

    const html = await exportService.renderMarkdown("# Hello");

    expect(html).toContain('<h1 id="hello" data-heading-id="hello">Hello</h1>');
  });

  it("generates unique heading ids in fallback mode", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend unavailable"));

    const html = await exportService.renderMarkdown("## Intro\n\n## Intro");

    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-1"');
  });
});

describe("imageService utilities", () => {
  it("detects remote URLs", () => {
    expect(isRemoteUrl("https://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("http://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("file:///tmp/a.png")).toBe(false);
    expect(isRemoteUrl("./assets/a.png")).toBe(false);
  });

  it("formats file size", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("generates unique filename with timestamp and extension", () => {
    vi.spyOn(Date, "now").mockReturnValue(1735689600000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    const filename = generateUniqueFilename("photo.jpeg");
    expect(filename).toMatch(/^image-1735689600000-[a-z0-9]{6}\.jpeg$/);
  });

  it("converts file to base64 string", async () => {
    class SuccessfulReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | ((error: unknown) => void) = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,QUJD";
        this.onload?.();
      }
    }

    vi.stubGlobal("FileReader", SuccessfulReader);
    const file = new File(["abc"], "a.txt", { type: "text/plain" });
    await expect(fileToBase64(file)).resolves.toBe("QUJD");
  });

  it("rejects when FileReader emits error", async () => {
    class FailingReader {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | ((error: unknown) => void) = null;

      readAsDataURL() {
        this.onerror?.(new Error("read failed"));
      }
    }

    vi.stubGlobal("FileReader", FailingReader);
    const file = new File(["abc"], "a.txt", { type: "text/plain" });
    await expect(fileToBase64(file)).rejects.toThrow("read failed");
  });
});

describe("imageService invoke args use camelCase keys (Tauri 2 requirement)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("uploadImage passes camelCase keys", async () => {
    invokeMock.mockResolvedValueOnce({
      relativePath: "assets/img.png",
      absolutePath: "/tmp/img.png",
      markdownSyntax: "![](assets/img.png)",
      fileSize: 100,
    });

    await uploadImage("/doc.md", "base64data", "img.png", "assets");

    expect(invokeMock).toHaveBeenCalledWith("upload_image", {
      documentPath: "/doc.md",
      imageData: "base64data",
      filename: "img.png",
      assetFolder: "assets",
    });
  });

  it("uploadImagesBatch passes camelCase keys", async () => {
    invokeMock.mockResolvedValueOnce({
      results: [],
      successCount: 0,
      failureCount: 0,
    });

    await uploadImagesBatch("/doc.md", [{ data: "b64", filename: "a.png" }], "assets");

    expect(invokeMock).toHaveBeenCalledWith("upload_images_batch", {
      documentPath: "/doc.md",
      images: [{ data: "b64", filename: "a.png" }],
      assetFolder: "assets",
    });
  });

  it("copyExternalImage passes camelCase keys", async () => {
    invokeMock.mockResolvedValueOnce({
      relativePath: "assets/img.png",
      absolutePath: "/tmp/img.png",
      markdownSyntax: "![](assets/img.png)",
    });

    await copyExternalImage("/doc.md", "/tmp/src.png", "assets");

    expect(invokeMock).toHaveBeenCalledWith("copy_external_image", {
      documentPath: "/doc.md",
      sourcePath: "/tmp/src.png",
      assetFolder: "assets",
    });
  });
});
