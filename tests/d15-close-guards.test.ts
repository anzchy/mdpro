/**
 * D15-WI-5 — close-guard follow-ups (review findings B and C).
 *
 * (B) A failed flush must count as unsaved. A history-less edit dirties the document only
 * when the controller writes it, so when that write fails the store still reads clean and
 * a close used to go through silently. Both close kinds must prompt instead.
 *
 * (C) `resolveCloseRequest` / `resolveWindowClose` were only reached from tests; App.tsx
 * composes the same decisions inline (`decideCloseRequest(activeDocumentAfterFlush())`,
 * `decideWindowClose({ …, hasUnsavedChanges: hasUnsavedChangesAfterFlush() })`). The dead
 * pair is removed, and the monotonic-safety matrix (formerly G3 in
 * `tests/data-loss-logic.test.ts`) is ported here over App's composition, with the
 * failed-flush rows now expecting "prompt" per (B).
 *
 * Flushers are registered directly in the real milkdownEditorStore; only loggingService
 * and the Tauri core boundary are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import * as guards from "../src/utils/dataLossGuards";
import {
  activeDocumentAfterFlush,
  decideCloseRequest,
  decideWindowClose,
  hasUnsavedChangesAfterFlush,
} from "../src/utils/dataLossGuards";

type FlusherKind = "none" | "clean" | "written-and-dirties" | "failed" | "throws";
const KINDS: FlusherKind[] = ["none", "clean", "written-and-dirties", "failed", "throws"];
const RANK = { close: 0, "save-and-close": 0, allow: 0, prompt: 1, noop: 0 } as const;

/** App.tsx handleCloseRequest's composition. */
const closeDecision = () => decideCloseRequest(activeDocumentAfterFlush());
/** App.tsx onCloseRequested's composition. */
const windowDecision = (allowWindowClose: boolean) =>
  decideWindowClose({ allowWindowClose, hasUnsavedChanges: hasUnsavedChangesAfterFlush() });

function seed(isModified: boolean, kind: FlusherKind): string[] {
  useDocumentStore.setState({
    documents: [
      {
        id: "doc-a",
        path: "/tmp/a.md",
        content: "A",
        encoding: "UTF-8",
        lineEnding: "lf",
        isModified,
        lastSaved: null,
        fileSize: null,
      },
    ],
    activeDocumentId: "doc-a",
  });
  useMilkdownEditorStore.setState({ flushers: {} });
  const reasons: string[] = [];
  if (kind === "none") return reasons;
  useMilkdownEditorStore.getState().registerFlusher("doc-a", (reason) => {
    reasons.push(reason);
    if (kind === "throws") throw new Error("serializer exploded");
    if (kind === "written-and-dirties") {
      useDocumentStore.getState().markDocumentModified("doc-a", true);
      return { status: "written" };
    }
    return { status: kind === "failed" ? "failed" : "clean" };
  });
  return reasons;
}

beforeEach(() => {
  seed(false, "none");
});

describe("B — a failed flush counts as unsaved on both close paths", () => {
  it("B1 a clean doc whose flusher fails prompts on ⌘W, never closes", () => {
    seed(false, "failed");
    expect(closeDecision()).toBe("prompt");
  });

  it("B2 a clean doc whose flusher fails prompts on window close, never saves-and-closes", () => {
    seed(false, "failed");
    expect(windowDecision(false)).toBe("prompt");
  });

  it("B3 a flusher that throws is a failure too, for both close kinds", () => {
    seed(false, "throws");
    expect(closeDecision()).toBe("prompt");
    seed(false, "throws");
    expect(windowDecision(false)).toBe("prompt");
  });

  it("B4 a failed flush does not mark the stored document modified behind the user", () => {
    seed(false, "failed");
    closeDecision();
    windowDecision(false);
    expect(useDocumentStore.getState().documents[0].isModified).toBe(false);
  });

  it("B5 the latched allow still wins over a failed flush (the user already confirmed)", () => {
    seed(false, "failed");
    expect(windowDecision(true)).toBe("allow");
  });
});

describe("G3' App's close composition is monotonically safe over the pre-state domain", () => {
  it("the flush only moves decisions toward prompt, and each helper flushes with its reason", () => {
    let promptRows = 0;
    for (const isModified of [true, false]) {
      for (const kind of KINDS) {
        for (const allowWindowClose of [true, false]) {
          const row = `isModified=${isModified} flusher=${kind} allow=${allowWindowClose}`;
          const reasons = seed(isModified, kind);
          const before = {
            close: decideCloseRequest({ isModified }),
            window: decideWindowClose({ allowWindowClose, hasUnsavedChanges: isModified }),
          };
          const close = closeDecision();
          const win = windowDecision(allowWindowClose);

          const unsaved =
            isModified || kind === "written-and-dirties" || kind === "failed" || kind === "throws";
          expect(close, row).toBe(unsaved ? "prompt" : "close");
          expect(win, row).toBe(allowWindowClose ? "allow" : unsaved ? "prompt" : "save-and-close");
          if (close === "prompt") promptRows += 1;
          expect(RANK[close], `${row}: close moved away from prompt`).toBeGreaterThanOrEqual(
            RANK[before.close],
          );
          expect(RANK[win], `${row}: window close moved away from prompt`).toBeGreaterThanOrEqual(
            RANK[before.window],
          );
          expect(reasons, row).toEqual(kind === "none" ? [] : ["tab-close", "window-close"]);
        }
      }
    }
    expect(promptRows, "non-vacuity").toBeGreaterThan(0);
  });
});

describe("C — the dead resolve* composition is gone", () => {
  it("C1 dataLossGuards no longer exports resolveCloseRequest / resolveWindowClose", () => {
    expect(Object.keys(guards)).not.toContain("resolveCloseRequest");
    expect(Object.keys(guards)).not.toContain("resolveWindowClose");
  });
});
