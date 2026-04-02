import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "../src/stores/documentStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";

// Mock fileService
const mockSaveFile = vi.fn();
vi.mock("../src/services/fileService", () => ({
  fileService: {
    saveFile: (...args: unknown[]) => mockSaveFile(...args),
  },
}));

// Mock loggingService
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    generateActionId: () => "test-action-id",
    logEventSync: vi.fn(),
  },
}));

// Import after mocks
import { prepareForRelaunch } from "../src/hooks/useUpdater";

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    path: "/tmp/test.md",
    content: "# Test",
    encoding: "utf-8",
    isModified: false,
    lastSaved: Date.now(),
    fileSize: 100,
    ...overrides,
  };
}

describe("prepareForRelaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: [], activeDocumentId: null });
    useToastStore.setState({ message: null });
    mockSaveFile.mockResolvedValue({ success: true });
  });

  it("returns true when no modified docs", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: false })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it("saves a single modified doc with a path", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: "/tmp/a.md", content: "hello" })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    expect(mockSaveFile).toHaveBeenCalledWith(
      "doc-1",
      "hello",
      "/tmp/a.md",
      "test-action-id",
    );
  });

  it("saves multiple modified docs", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", isModified: true, path: "/tmp/a.md" }),
        makeDoc({ id: "doc-2", isModified: true, path: "/tmp/b.md" }),
      ],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(true);
    expect(mockSaveFile).toHaveBeenCalledTimes(2);
  });

  it("blocks relaunch and shows toast when untitled doc is modified", async () => {
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: null })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(useToastStore.getState().message).toContain("unsaved changes");
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it("blocks relaunch and shows toast when save_file throws", async () => {
    mockSaveFile.mockRejectedValue(new Error("disk full"));
    useDocumentStore.setState({
      documents: [makeDoc({ isModified: true, path: "/tmp/a.md" })],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(useToastStore.getState().message).toContain("Failed to save");
  });

  it("blocks relaunch on first untitled even if second doc is saveable", async () => {
    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", isModified: true, path: null }),
        makeDoc({ id: "doc-2", isModified: true, path: "/tmp/b.md" }),
      ],
    });
    const result = await prepareForRelaunch();
    expect(result).toBe(false);
    expect(mockSaveFile).not.toHaveBeenCalled();
  });
});
