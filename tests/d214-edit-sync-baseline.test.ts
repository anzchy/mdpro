// @vitest-environment node
/**
 * D214-WI-3 — the WYSIWYG edit-sync controller re-evaluates its eager dirty mark.
 *
 * A user edit marks the document dirty at once (the eager mark). If the edit is undone
 * inside one debounce window, the serialised markdown equals the store content, the
 * controller writes nothing, and before D214 the eager mark stayed forever. Now the
 * no-write path re-evaluates `isModified` against the owner's baseline using the STORE
 * content (`owner.content`), never the serialised markdown (K9: a dirty document whose
 * editor serialises to the baseline must stay dirty, or its unsaved text is lost).
 *
 * Law (K8): after each settle (flush or timer), with a baseline `isModified ===
 * (content !== savedContent)`; without one, a dirty document stays dirty.
 *
 * Real stores, real controller, real dataLossGuards; only the Tauri core boundary is
 * mocked. Fake timers drive the debounce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));

import {
  createEditSyncController,
  EDIT_SYNC_DELAY_MS,
  type EditSyncController,
} from "../src/plugins/milkdown/editSync/controller";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import { activeDocumentAfterFlush, decideCloseRequest } from "../src/utils/dataLossGuards";

const ID = "doc-a";

function D(content: string, extra: Partial<Document> = {}): Document {
  return {
    id: ID,
    path: "/tmp/doc-a.md",
    content,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...extra,
  };
}

const store = () => useDocumentStore.getState();
const doc = () => store().getDocumentById(ID)!;

/** The editor under test: `editorDoc` is what the serialiser returns. */
interface Rig {
  controller: EditSyncController;
  setEditor: (markdown: string) => void;
  failNext: () => void;
}

function rig(initial: string): Rig {
  let editorDoc = initial;
  let fail = false;
  const controller = createEditSyncController({
    documentId: ID,
    baselineMarkdown: initial,
    getMarkdown: () => {
      if (fail) {
        fail = false;
        throw new Error("serialiser blew up");
      }
      return editorDoc;
    },
  });
  return {
    controller,
    setEditor: (markdown) => {
      editorDoc = markdown;
    },
    failNext: () => {
      fail = true;
    },
  };
}

/** A user edit that leaves the editor holding `markdown`. */
function userEdit(r: Rig, markdown: string): void {
  r.setEditor(markdown);
  r.controller.onDocChanged({ userEdit: true });
}

function countEmissions(): { count: () => number; stop: () => void } {
  let n = 0;
  const stop = useDocumentStore.subscribe(() => {
    n += 1;
  });
  return { count: () => n, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("K1 edit, flush, edit back, flush", () => {
  it("reads dirty, dirty, dirty, clean", () => {
    store().upsertDocument(D("A"));
    const r = rig("A");
    const flags: boolean[] = [];
    userEdit(r, "AB");
    flags.push(doc().isModified);
    r.controller.flush("save");
    flags.push(doc().isModified);
    userEdit(r, "A");
    flags.push(doc().isModified);
    r.controller.flush("save");
    flags.push(doc().isModified);
    expect(flags).toEqual([true, true, true, false]);
    expect(doc().content).toBe("A");
  });
});

describe("K2 edit then undo inside one debounce window", () => {
  it.each(["flush", "timer"] as const)("settled by %s: clean again, close does not prompt", (settle) => {
    store().upsertDocument(D("A"));
    store().setActiveDocumentId(ID);
    const r = rig("A");
    userEdit(r, "AB");
    expect(doc().isModified).toBe(true);
    userEdit(r, "A");
    if (settle === "flush") {
      expect(r.controller.flush("tab-switch")).toEqual({ status: "clean" });
    } else {
      vi.advanceTimersByTime(EDIT_SYNC_DELAY_MS);
    }
    expect(doc().isModified).toBe(false);
    expect([doc().content, doc().savedContent]).toEqual(["A", "A"]);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("close");
  });
});

describe("K3 no baseline: edit then undo stays dirty", () => {
  it.each([
    ["setState seed", () => useDocumentStore.setState({ documents: [D("A", { isModified: true })] })],
    ["dirty upsert without savedContent", () => store().upsertDocument(D("A", { isModified: true }))],
  ])("%s", (_label, seed) => {
    seed();
    const r = rig("A");
    userEdit(r, "AB");
    userEdit(r, "A");
    expect(r.controller.flush("tab-close")).toEqual({ status: "clean" });
    expect(doc().isModified).toBe(true);
    expect(doc().savedContent).toBeUndefined();
  });
});

describe("K4 content differs from the baseline", () => {
  it("stays dirty after an edit that serialises to the store content", () => {
    store().upsertDocument(D("AB", { isModified: true, savedContent: "A" }));
    const r = rig("AB");
    userEdit(r, "ABC");
    userEdit(r, "AB");
    r.controller.flush("tab-close");
    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["AB", true, "A"]);
  });
});

describe("K5 a no-op serialisation emits nothing", () => {
  it.each([
    ["clean with a baseline", () => store().upsertDocument(D("A"))],
    ["sticky dirty", () => store().upsertDocument(D("A", { isModified: true }))],
  ])("%s", (_label, seed) => {
    seed();
    const r = rig("A");
    const before = doc();
    const emissions = countEmissions();
    r.controller.onDocChanged({ userEdit: false });
    expect(r.controller.flush("tab-switch")).toEqual({ status: "clean" });
    vi.advanceTimersByTime(EDIT_SYNC_DELAY_MS);
    emissions.stop();
    expect(emissions.count()).toBe(0);
    expect(doc()).toBe(before);
  });
});

describe("K6 the re-evaluation reads the live baseline", () => {
  it("a save after mount moves the baseline the controller compares against", () => {
    store().upsertDocument(D("A"));
    const r = rig("A");
    userEdit(r, "AB");
    r.controller.flush("save");
    // The save lands: a clean upsert of "AB" makes "AB" the baseline.
    store().upsertDocument(D("AB"));
    userEdit(r, "ABC");
    expect(doc().isModified).toBe(true);
    userEdit(r, "AB");
    expect(r.controller.flush("tab-switch")).toEqual({ status: "clean" });
    expect([doc().content, doc().isModified, doc().savedContent]).toEqual(["AB", false, "AB"]);
  });
});

describe("K7 a serialiser failure does not re-evaluate", () => {
  it("stays dirty after the failed flush, then the next flush re-evaluates", () => {
    store().upsertDocument(D("A"));
    const r = rig("A");
    userEdit(r, "AB");
    userEdit(r, "A");
    r.failNext();
    expect(r.controller.flush("tab-switch")).toEqual({ status: "failed" });
    expect(doc().isModified).toBe(true);
    expect(r.controller.flush("tab-switch")).toEqual({ status: "clean" });
    expect(doc().isModified).toBe(false);
  });
});

describe("K9 the re-evaluation compares store content, never the serialised markdown", () => {
  it("a dirty document whose editor serialises to the baseline stays dirty", () => {
    store().upsertDocument(D("* a\n", { isModified: true, savedContent: "- a\n" }));
    store().setActiveDocumentId(ID);
    const r = rig("- a\n");
    r.controller.onDocChanged({ userEdit: true });
    r.controller.flush("tab-close");
    expect([doc().isModified, doc().content, doc().savedContent]).toEqual([true, "* a\n", "- a\n"]);
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
  });
});

// ---------------------------------------------------------------------------
// K8 (S5): every sequence of 1–4 operations over 8 operations (8+64+512+4096 = 4680).
// ---------------------------------------------------------------------------

const OPS = ["editA", "editAB", "editB", "quietAB", "flush", "timer", "save", "sticky"] as const;
type Op = (typeof OPS)[number];

function sequences(maxLength: number): Op[][] {
  const out: Op[][] = [];
  let layer: Op[][] = [[]];
  for (let n = 1; n <= maxLength; n += 1) {
    layer = layer.flatMap((seq) => OPS.map((op) => [...seq, op]));
    out.push(...layer);
  }
  return out;
}

function apply(r: Rig, op: Op): void {
  switch (op) {
    case "editA":
      return userEdit(r, "A");
    case "editAB":
      return userEdit(r, "AB");
    case "editB":
      return userEdit(r, "B");
    case "quietAB":
      r.setEditor("AB");
      r.controller.onDocChanged({ userEdit: false });
      return;
    case "flush":
      r.controller.flush("tab-switch");
      return;
    case "timer":
      vi.advanceTimersByTime(EDIT_SYNC_DELAY_MS);
      return;
    case "save":
      // A save of the store content: a clean upsert, i.e. a clean point.
      store().upsertDocument({ ...doc(), isModified: false });
      return;
    case "sticky":
      // A recovered draft / failed save: dirty, no baseline.
      store().upsertDocument({ ...doc(), isModified: true, savedContent: undefined });
      return;
  }
}

describe("K8 law after every settle, over all ≤ 4-op sequences", () => {
  it("4680 sequences: with a baseline isModified === (content !== savedContent); without, dirty", () => {
    const all = sequences(4);
    expect(all).toHaveLength(4680);
    const violations: string[] = [];
    let settles = 0;
    let cleanedByReevaluation = 0;
    for (const seq of all) {
      useDocumentStore.setState({ documents: [], activeDocumentId: null });
      store().upsertDocument(D("A"));
      const r = rig("A");
      for (const op of seq) {
        const dirtyBefore = doc().isModified;
        const contentBefore = doc().content;
        apply(r, op);
        if (op !== "flush" && op !== "timer") continue;
        settles += 1;
        const d = doc();
        const ok = d.savedContent === undefined ? d.isModified : d.isModified === (d.content !== d.savedContent);
        if (!ok) violations.push(`${seq.join(",")} @${op}: ${JSON.stringify(d)}`);
        if (dirtyBefore && !d.isModified && d.content === contentBefore) cleanedByReevaluation += 1;
      }
      r.controller.discard();
      vi.clearAllTimers();
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(violations).toHaveLength(0);
    // Non-vacuity: settles happen, and some settle clears an eager mark without a write.
    expect(settles).toBeGreaterThan(1000);
    expect(cleanedByReevaluation).toBeGreaterThan(0);
  });
});
