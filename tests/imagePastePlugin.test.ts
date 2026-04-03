import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  isSupportedImageType,
  validateImageSize,
  getImageExtension,
  handleImageFiles,
} from "../src/plugins/milkdown/imagePastePlugin";

// ── Hoisted mocks (available inside vi.mock factories) ────────────────────────

const { mockUploadImage, mockDecoSet, destroyedFlag, mockResolveImages } = vi.hoisted(() => {
  const destroyedFlag = { value: false };
  const mockDecoSet = {
    add: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    find: vi.fn().mockReturnValue([]),
    map: vi.fn().mockReturnThis(),
  };
  const mockUploadImage = vi.fn();
  const mockResolveImages = vi.fn();
  return { mockUploadImage, mockDecoSet, destroyedFlag, mockResolveImages };
});

vi.mock("../src/hooks/useMilkdownImages", () => ({
  resolveImagesInContainer: mockResolveImages,
}));

// Override only DecorationSet + Decoration; preserve all other real exports.
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
  useToastStore: {
    getState: () => ({ showToast: vi.fn() }),
  },
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

// ── Pure-function tests ───────────────────────────────────────────────────────

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

// ── handleImageFiles — destroyed-view regression ──────────────────────────────

describe("handleImageFiles — destroyed-view guard", () => {
  beforeEach(() => {
    destroyedFlag.value = false;
    mockUploadImage.mockReset();
    mockDecoSet.add.mockClear();
    mockDecoSet.find.mockReturnValue([]);
  });

  it("does not dispatch after upload completes if view was destroyed during upload", async () => {
    // Simulate the view being destroyed mid-upload (user closes the tab).
    mockUploadImage.mockImplementation(async () => {
      destroyedFlag.value = true;
      return { relativePath: "images/test.png" };
    });

    const dispatch = vi.fn();
    const mockTr = {
      setMeta: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    };
    const mockView = {
      get isDestroyed() {
        return destroyedFlag.value;
      },
      dispatch,
      state: {
        selection: { from: 5 },
        tr: mockTr,
        doc: {},
        schema: {
          nodes: { image: { create: vi.fn(() => ({ nodeSize: 1 })) } },
        },
      },
    } as unknown as EditorView;

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await handleImageFiles([file], mockView);

    // addPlaceholders fires dispatch exactly once, synchronously, before the upload.
    // After the view is destroyed, removePlaceholders + insertImageNode must be skipped.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches normally when view is alive after upload", async () => {
    // View is NOT destroyed — all dispatches should fire.
    mockUploadImage.mockResolvedValue({ relativePath: "images/test.png" });

    const dispatch = vi.fn();
    const mockTr = {
      setMeta: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    };
    const mockView = {
      get isDestroyed() {
        return false; // never destroyed
      },
      dispatch,
      state: {
        selection: { from: 5 },
        tr: mockTr,
        doc: {},
        schema: {
          nodes: { image: { create: vi.fn(() => ({ nodeSize: 1 })) } },
        },
      },
    } as unknown as EditorView;

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await handleImageFiles([file], mockView);

    // addPlaceholders (1) + insertImageNode (1) = 2 dispatches.
    // (removePlaceholders is a no-op because find() returns [])
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch in catch path if view was destroyed when upload fails", async () => {
    // Upload fails, but the view is already destroyed by the time the catch runs.
    mockUploadImage.mockImplementation(async () => {
      destroyedFlag.value = true;
      throw new Error("network error");
    });

    const dispatch = vi.fn();
    const mockTr = { setMeta: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis() };
    const mockView = {
      get isDestroyed() { return destroyedFlag.value; },
      dispatch,
      state: {
        selection: { from: 0 },
        tr: mockTr,
        doc: {},
        schema: { nodes: { image: { create: vi.fn(() => ({ nodeSize: 1 })) } } },
      },
    } as unknown as EditorView;

    const file = new File(["x"], "photo.png", { type: "image/png" });
    await handleImageFiles([file], mockView);

    // addPlaceholders fires once before the upload. The catch block's
    // removePlaceholders must be skipped when the view is destroyed.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch after batch upload if view was destroyed during upload", async () => {
    const { uploadImagesBatch } = await import("../src/services/imageService");
    vi.mocked(uploadImagesBatch).mockImplementation(async () => {
      destroyedFlag.value = true;
      return {
        successCount: 2,
        failureCount: 0,
        results: [
          { relativePath: "images/a.png" },
          { relativePath: "images/b.png" },
        ],
      };
    });

    const dispatch = vi.fn();
    const mockTr = { setMeta: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis() };
    const mockView = {
      get isDestroyed() { return destroyedFlag.value; },
      dispatch,
      state: {
        selection: { from: 0 },
        tr: mockTr,
        doc: {},
        schema: { nodes: { image: { create: vi.fn(() => ({ nodeSize: 1 })) } } },
      },
    } as unknown as EditorView;

    // Two files triggers the batch path.
    const files = [
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["x"], "b.png", { type: "image/png" }),
    ];
    await handleImageFiles(files, mockView);

    // addPlaceholders fires once for all placeholders before the batch upload.
    // removePlaceholders + insertImageNodes must be skipped when destroyed.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

