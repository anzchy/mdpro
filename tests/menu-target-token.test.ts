/**
 * D261-WI-1c: `src/utils/menuTargetToken.ts`, the token a menu action carries
 * from its receipt to its final mutation.
 *
 * Law (S5, "staleness is absorbing"): `isTokenCurrent(t)` is true iff the
 * window label, the active document id and the editor generation all equal
 * what `t` captured. The generation is monotonic, so once a bump-class event
 * follows the capture the token is never current again, including after a
 * switch away and back. `abandonIfStale` returns `!isTokenCurrent(t)` and writes
 * exactly one `ui.menu.select` `cancel` line iff it returns true.
 *
 * Mock boundary: `@tauri-apps/api/window` (the label) and `@tauri-apps/api/core`
 * (`invoke` captures `log_event`). The stores and `loggingService` are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { win, logs } = vi.hoisted(() => ({
  win: { label: "A" },
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: { payload?: Record<string, unknown> } = {}) => {
    if (cmd === "log_event") logs.push(args.payload ?? {});
    return null;
  },
}));

import { getEditorGeneration } from "../src/stores/editorGeneration";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { abandonIfStale, captureToken, isTokenCurrent } from "../src/utils/menuTargetToken";
import { applyGenEvent, GEN_EVENTS, newView, seedStores, type Shadow } from "./support/editorGenerationDomain";
import { genSequence, mulberry32 } from "./support/seededSequences";

let shadow: Shadow;

beforeEach(() => {
  win.label = "A";
  shadow = seedStores();
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
});

const menuSelects = () => logs.filter((l) => l.event === "ui.menu.select");

describe("captureToken (S2)", () => {
  it("reads the label it is given, the active document and the generation", () => {
    const g = getEditorGeneration();
    const first = captureToken("A");
    expect(first).toEqual({ windowLabel: "A", documentId: "d1", generation: g });

    useDocumentStore.getState().setActiveDocument("d2");
    const second = captureToken("A");
    expect(second).toEqual({ windowLabel: "A", documentId: "d2", generation: g + 1 });
    expect(second).not.toEqual(first);
  });

  it("captures a null document when none is active", () => {
    useDocumentStore.setState({ activeDocumentId: null });
    expect(captureToken("A")).toEqual({ windowLabel: "A", documentId: null, generation: getEditorGeneration() });
  });
});

describe("isTokenCurrent examples (S2, S3)", () => {
  it("(i) true at capture", () => {
    expect(isTokenCurrent(captureToken("A"))).toBe(true);
  });

  it("(ii) true after typing into the same document", () => {
    const t = captureToken("A");
    useDocumentStore.getState().updateDocumentContent("d1", "typed");
    expect(isTokenCurrent(t)).toBe(true);
  });

  it("(iii) false after a switch to d2", () => {
    const t = captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    expect(isTokenCurrent(t)).toBe(false);
  });

  it("(iv) false after d1 → d2 → d1: switching away and back is stale", () => {
    const t = captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    useDocumentStore.getState().setActiveDocument("d1");
    expect(useDocumentStore.getState().activeDocumentId).toBe(t.documentId);
    expect(isTokenCurrent(t)).toBe(false);
  });

  it("(v) false when this window's label is not the token's", () => {
    const t = captureToken("A");
    win.label = "B";
    expect(isTokenCurrent(t)).toBe(false);
  });

  it("(v') false for a token captured under another label", () => {
    expect(isTokenCurrent(captureToken("B"))).toBe(false);
  });

  it("(vi) false after a new EditorView mounts on the same document", () => {
    const t = captureToken("A");
    useEditorStore.getState().setEditorView(newView());
    expect(isTokenCurrent(t)).toBe(false);
  });

  it("(vii) true with no active document at capture and still none", () => {
    useDocumentStore.setState({ activeDocumentId: null });
    expect(isTokenCurrent(captureToken("A"))).toBe(true);
  });

  it("each field alone makes the token stale", () => {
    const t = captureToken("A");
    expect(isTokenCurrent({ ...t, windowLabel: "a" })).toBe(false);
    expect(isTokenCurrent({ ...t, documentId: "d2" })).toBe(false);
    expect(isTokenCurrent({ ...t, documentId: null })).toBe(false);
    expect(isTokenCurrent({ ...t, generation: t.generation - 1 })).toBe(false);
    expect(isTokenCurrent({ ...t, generation: t.generation + 1 })).toBe(false);
    expect(isTokenCurrent({ ...t })).toBe(true);
  });
});

describe("staleness is absorbing (S5)", () => {
  it("seeds 1-200: current before the first bump-class event, stale at and after it", () => {
    for (let seed = 1; seed <= 200; seed++) {
      shadow = seedStores();
      const seq = genSequence(mulberry32(seed), GEN_EVENTS, 25);
      const t = captureToken("A");
      let bumped = false;
      seq.forEach((event, i) => {
        if (applyGenEvent(event, shadow) > 0) bumped = true;
        expect(isTokenCurrent(t), `seed ${seed} step ${i} (${event}): ${JSON.stringify(seq)}`).toBe(!bumped);
      });
    }
  });
});

describe("abandonIfStale (S3)", () => {
  it("writes nothing and returns false while current; one cancel line and true once stale", () => {
    const t = captureToken("A");
    expect(abandonIfStale(t, "table_submit", "act-1")).toBe(false);
    expect(menuSelects()).toEqual([]);

    useDocumentStore.getState().setActiveDocument("d2");
    expect(abandonIfStale(t, "table_submit", "act-1")).toBe(true);

    const lines = menuSelects();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      level: "info",
      event: "ui.menu.select",
      status: "cancel",
      actionId: "act-1",
      context: { windowLabel: "A", reason: "stale", stage: "table_submit" },
    });
    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain("d1");
    expect(serialized).not.toContain("/x/");
  });

  it("each stale call writes its own single line, with its own stage", () => {
    const t = captureToken("A");
    useEditorStore.getState().setEditorView(newView());
    expect(abandonIfStale(t, "close_confirm", "act-2")).toBe(true);
    expect(abandonIfStale(t, "save_entry", "act-3")).toBe(true);
    expect(menuSelects().map((l) => [l.actionId, (l.context as Record<string, unknown>).stage])).toEqual([
      ["act-2", "close_confirm"],
      ["act-3", "save_entry"],
    ]);
  });

  it("returns exactly !isTokenCurrent over a seeded sequence, logging once per stale call", () => {
    const seq = genSequence(mulberry32(261), GEN_EVENTS, 25);
    const t = captureToken("A");
    let expectedLines = 0;
    seq.forEach((event, i) => {
      applyGenEvent(event, shadow);
      const stale = !isTokenCurrent(t);
      expect(abandonIfStale(t, "probe", `id-${i}`), `step ${i} (${event})`).toBe(stale);
      if (stale) expectedLines += 1;
    });
    expect(menuSelects()).toHaveLength(expectedLines);
  });
});
