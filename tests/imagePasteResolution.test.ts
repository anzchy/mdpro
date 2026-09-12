/**
 * Tests for immediate image resolution after paste (#375).
 *
 * Two layers:
 *  1. Call-site tests — verify handleImageFiles() invokes resolveImagesInContainer
 *     at the right times (success / destroyed-view / batch).
 *  2. Integration test — verify resolveImagesInContainer() actually rewrites
 *     <img src> from relative path to asset:// URL using real jsdom DOM.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockUploadImage, mockDecoSet, destroyedFlag, mockResolveImages } =
  vi.hoisted(() => {
    const destroyedFlag = { value: false };
    const mockDecoSet = {
      add: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      find: vi.fn().mockReturnValue([]),
      map: vi.fn().mockReturnThis(),
    };
    return {
      mockUploadImage: vi.fn(),
      mockDecoSet,
      destroyedFlag,
      mockResolveImages: vi.fn(),
    };
  });

vi.mock("../src/hooks/useMilkdownImages", () => ({
  resolveImagesInContainer: mockResolveImages,
}));

vi.mock("@milkdown/kit/prose/view", async () => {
  const mod = await vi.importActual<typeof import("@milkdown/kit/prose/view")>(
    "@milkdown/kit/prose/view",
  );
  return {
    ...mod,
    DecorationSet: { empty: mockDecoSet },
    Decoration: { widget: vi.fn(() => ({ spec: { key: "mock-widget" } })) },
  };
});

vi.mock("../src/services/imageService", () => ({
  uploadImage: mockUploadImage,
  fileToBase64: vi.fn().mockResolvedValue("data:image/png;base64,abc"),
  generateUniqueFilename: vi.fn((n: string) => n),
  formatBytes: vi.fn((bytes: number) => `${bytes}B`),
  uploadImagesBatch: vi.fn(),
}));

vi.mock("../src/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      documents: [{ id: "doc-1", path: "/home/user/test.md" }],
      activeDocumentId: "doc-1",
    }),
  },
}));

vi.mock("../src/stores/toastStore", () => ({
  useToastStore: { getState: () => ({ showToast: vi.fn() }) },
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeView(isDestroyedGetter: () => boolean): EditorView {
  const mockTr = {
    setMeta: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
  };
  return {
    get isDestroyed() {
      return isDestroyedGetter();
    },
    dispatch: vi.fn(),
    state: {
      selection: { from: 5 },
      tr: mockTr,
      doc: {},
      schema: { nodes: { image: { create: vi.fn(() => ({ nodeSize: 1 })) } } },
    },
  } as unknown as EditorView;
}

// ── Call-site tests ───────────────────────────────────────────────────────────

describe("handleImageFiles — resolveImagesInContainer call sites (#375)", () => {
  beforeEach(async () => {
    destroyedFlag.value = false;
    mockUploadImage.mockReset();
    mockResolveImages.mockClear();
    mockDecoSet.add.mockClear();
    mockDecoSet.find.mockReturnValue([]);
  });

  it("calls resolveImagesInContainer with document path after single-image paste", async () => {
    const { handleImageFiles } = await import(
      "../src/plugins/milkdown/imagePastePlugin"
    );
    mockUploadImage.mockResolvedValue({ relativePath: "images/photo.png" });
    const view = makeView(() => false);
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await handleImageFiles([file], view);
    expect(mockResolveImages).toHaveBeenCalledTimes(1);
    expect(mockResolveImages).toHaveBeenCalledWith("/home/user/test.md");
  });

  it("does not call resolveImagesInContainer when view is destroyed before insert", async () => {
    const { handleImageFiles } = await import(
      "../src/plugins/milkdown/imagePastePlugin"
    );
    mockUploadImage.mockImplementation(async () => {
      destroyedFlag.value = true;
      return { relativePath: "images/photo.png" };
    });
    const view = makeView(() => destroyedFlag.value);
    const file = new File(["x"], "photo.png", { type: "image/png" });
    await handleImageFiles([file], view);
    expect(mockResolveImages).not.toHaveBeenCalled();
  });

  it("calls resolveImagesInContainer once after successful batch paste", async () => {
    const { handleImageFiles } = await import(
      "../src/plugins/milkdown/imagePastePlugin"
    );
    const { uploadImagesBatch } = await import("../src/services/imageService");
    vi.mocked(uploadImagesBatch).mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      results: [
        {
          relativePath: "images/a.png",
          absolutePath: "/home/user/images/a.png",
          markdownSyntax: "![a](images/a.png)",
          fileSize: 1024,
        },
        {
          relativePath: "images/b.png",
          absolutePath: "/home/user/images/b.png",
          markdownSyntax: "![b](images/b.png)",
          fileSize: 2048,
        },
      ],
    });
    const view = makeView(() => false);
    await handleImageFiles(
      [
        new File(["x"], "a.png", { type: "image/png" }),
        new File(["x"], "b.png", { type: "image/png" }),
      ],
      view,
    );
    expect(mockResolveImages).toHaveBeenCalledTimes(1);
    expect(mockResolveImages).toHaveBeenCalledWith("/home/user/test.md");
  });
});

// ── Integration: resolveImagesInContainer rewrites <img src> in DOM ───────────

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => {
    const normalized = path.startsWith("/") ? path.slice(1) : path;
    return `asset://localhost/${normalized}`;
  },
  invoke: vi.fn(),
}));

describe("resolveImagesInContainer — jsdom DOM integration (#375)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("rewrites relative src to asset:// URL", async () => {
    // Use importActual to bypass the top-level vi.mock on useMilkdownImages
    const { resolveImagesInContainer } = await vi.importActual<
      typeof import("../src/hooks/useMilkdownImages")
    >("../src/hooks/useMilkdownImages");
    const container = document.createElement("div");
    container.id = "milkdown-container";
    const img = document.createElement("img");
    img.setAttribute("src", "./images/photo.png");
    container.appendChild(img);
    document.body.appendChild(container);

    resolveImagesInContainer("/home/user/doc.md");

    expect(img.getAttribute("src")).toBe(
      "asset://localhost/home/user/images/photo.png",
    );
  });

  it("does not rewrite already-resolved asset:// src", async () => {
    const { resolveImagesInContainer } = await vi.importActual<
      typeof import("../src/hooks/useMilkdownImages")
    >("../src/hooks/useMilkdownImages");
    const container = document.createElement("div");
    container.id = "milkdown-container";
    const img = document.createElement("img");
    const assetSrc = "asset://localhost/home/user/images/photo.png";
    img.setAttribute("src", assetSrc);
    container.appendChild(img);
    document.body.appendChild(container);

    resolveImagesInContainer("/home/user/doc.md");

    expect(img.getAttribute("src")).toBe(assetSrc);
  });

  it("is a no-op when #milkdown-container does not exist", async () => {
    const { resolveImagesInContainer } = await vi.importActual<
      typeof import("../src/hooks/useMilkdownImages")
    >("../src/hooks/useMilkdownImages");
    // No container in DOM — should not throw
    expect(() => resolveImagesInContainer("/home/user/doc.md")).not.toThrow();
  });

  it("is a no-op when documentPath is null", async () => {
    const { resolveImagesInContainer } = await vi.importActual<
      typeof import("../src/hooks/useMilkdownImages")
    >("../src/hooks/useMilkdownImages");
    const container = document.createElement("div");
    container.id = "milkdown-container";
    const img = document.createElement("img");
    img.setAttribute("src", "./images/photo.png");
    container.appendChild(img);
    document.body.appendChild(container);

    // null documentPath — relative src can't be resolved, should be left as-is
    resolveImagesInContainer(null);
    // src unchanged (resolveImageSrc returns original when no docPath)
    expect(img.getAttribute("src")).toBe("./images/photo.png");
  });
});
