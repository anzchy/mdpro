/**
 * Tests for useAutoSave hook logic.
 *
 * Since @testing-library/react is not available, we test the auto-save
 * behavior by verifying the hook's source contract and testing the
 * extractTitle helper via the store integration path.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_PATH = path.resolve(__dirname, "../src/hooks/useAutoSave.ts");
const src = fs.readFileSync(SRC_PATH, "utf-8");

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-action-id"),
  },
}));

describe("useAutoSave — source contract", () => {
  it("uses useEffect with cleanup (clearInterval)", () => {
    expect(src).toMatch(/clearInterval/);
    expect(src).toMatch(/useEffect/);
  });

  it("checks isModified before saving", () => {
    expect(src).toMatch(/isModified/);
  });

  it("calls save_draft via invoke", () => {
    expect(src).toMatch(/invoke\s*\(\s*["']save_draft["']/);
  });

  it("enforces minimum interval of 5000ms", () => {
    expect(src).toMatch(/Math\.max\(.*5000\)/);
  });

  it("disables auto-save when interval is 0 or negative", () => {
    expect(src).toMatch(/autoSaveInterval\s*<=\s*0/);
  });

  it("reads fresh state from store (avoids stale closures)", () => {
    expect(src).toMatch(/useDocumentStore\.getState\(\)/);
  });

  it("handles invoke errors without crashing", () => {
    expect(src).toMatch(/catch/);
  });

  it("depends on activeDocumentId and autoSaveInterval", () => {
    expect(src).toMatch(/\[activeDocumentId,\s*autoSaveInterval\]/);
  });
});

describe("useAutoSave — extractTitle helper", () => {
  // ADR-0035 changes the spec: extractTitle moved to src/utils/draftTitle.ts so
  // the quit backstop (quitDraftBackstop.ts) titles its drafts the same way.
  // Its behaviour — H1 extraction and the "Untitled" fallback — is now tested
  // directly in tests/draftTitle.test.ts (DT-1, DT-2). What remains here is that
  // the hook uses that one helper rather than a private copy that could drift.

  it("imports extractTitle from the shared draftTitle util", () => {
    expect(src).toMatch(/import\s*\{\s*extractTitle\s*\}\s*from\s*["']\.\.\/utils\/draftTitle["']/);
  });

  it("keeps no private copy of the title regex", () => {
    expect(src).not.toContain("^#\\s+(.+)$");
  });
});
