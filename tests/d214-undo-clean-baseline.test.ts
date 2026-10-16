// @vitest-environment node
/**
 * D214-WI-1 — documentStore keeps a saved-content baseline, so undoing back to the
 * saved text reads clean again.
 *
 * Law: with a baseline, `isModified === (content !== savedContent)` (strict `===`),
 * whatever the history of writes; without one (`savedContent === undefined`), every
 * write reads dirty. The baseline moves only at a clean point: a clean upsert or
 * `markDocumentModified(id, false)`. Baselines are per document.
 *
 * Real stores and real dataLossGuards; only the Tauri core boundary is mocked
 * (loggingService's `log_event` reaches an inert `invoke`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import {
  activeDocumentAfterFlush,
  assessWindowUnsaved,
  decideCloseRequest,
} from "../src/utils/dataLossGuards";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { D214_STRINGS } from "./support/d214Strings";

function D(id: string, content: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    path: `/tmp/${id}.md`,
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
const doc = (id: string) => store().getDocumentById(id)!;
const write = (id: string, content: string) => store().updateDocumentContent(id, content);

beforeEach(() => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useMilkdownEditorStore.setState({ flushers: {} });
});

describe("S1 undo back to the saved text", () => {
  it("clean 'A' → 'AB' → 'A' reads false, true, false with the baseline fixed at 'A'", () => {
    store().upsertDocument(D("a", "A"));
    const flags = [doc("a").isModified];
    const baselines = [doc("a").savedContent];
    write("a", "AB");
    flags.push(doc("a").isModified);
    baselines.push(doc("a").savedContent);
    write("a", "A");
    flags.push(doc("a").isModified);
    baselines.push(doc("a").savedContent);
    expect(flags).toEqual([false, true, false]);
    expect(baselines).toEqual(["A", "A", "A"]);
  });
});

describe("S2/S3 strict comparison", () => {
  it("S2 same length, different text ('ab' → 'ba') is dirty", () => {
    store().upsertDocument(D("a", "ab"));
    write("a", "ba");
    expect(doc("a").isModified).toBe(true);
  });

  it.each([
    ["", "x", true],
    ["x", "", true],
    ["a", "a\n", true],
    ["a\n", "a\r\n", true],
    ["a\r\n", "a\n", true],
    ["é", "é", true],
    ["", "", false],
  ])("S3 baseline %j, write %j → isModified %s", (baseline, next, dirty) => {
    store().upsertDocument(D("a", baseline));
    write("a", next);
    expect(doc("a").isModified).toBe(dirty);
    expect(doc("a").savedContent).toBe(baseline);
  });
});

describe("S4 law over Σ (40 strings, length 0–3 over {a, b, \\n})", () => {
  it("Σ has 40 distinct strings", () => {
    expect(D214_STRINGS).toHaveLength(40);
    expect(new Set(D214_STRINGS).size).toBe(40);
  });

  it("(i) one write: isModified === (c !== b), baseline b; 40 clean, 1560 dirty", () => {
    let clean = 0;
    let dirty = 0;
    const violations: string[] = [];
    for (const b of D214_STRINGS) {
      for (const c of D214_STRINGS) {
        store().upsertDocument(D("a", b));
        write("a", c);
        const d = doc("a");
        if (d.isModified !== (c !== b) || d.savedContent !== b) {
          violations.push(JSON.stringify([b, c, d.isModified, d.savedContent]));
        }
        if (d.isModified) dirty += 1;
        else clean += 1;
      }
    }
    expect(violations).toEqual([]);
    expect([clean, dirty]).toEqual([40, 1560]);
  });

  it("(ii) history independence: after writes c1 then c2, isModified === (c2 !== b)", () => {
    const violations: string[] = [];
    for (const b of D214_STRINGS) {
      for (const c1 of D214_STRINGS) {
        for (const c2 of D214_STRINGS) {
          store().upsertDocument(D("a", b));
          write("a", c1);
          write("a", c2);
          const d = doc("a");
          if (d.isModified !== (c2 !== b) || d.savedContent !== b) {
            violations.push(JSON.stringify([b, c1, c2, d.isModified]));
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("(iii) an eager mark before the write does not change the law", () => {
    const violations: string[] = [];
    for (const b of D214_STRINGS) {
      for (const c of D214_STRINGS) {
        store().upsertDocument(D("a", b));
        store().markDocumentModified("a", true);
        write("a", c);
        const d = doc("a");
        if (d.isModified !== (c !== b) || d.savedContent !== b) {
          violations.push(JSON.stringify([b, c, d.isModified]));
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("S5 no baseline: every write reads dirty", () => {
  const writes = ["A", "", "AB", "A"];

  function expectStickyDirty(id: string) {
    for (const c of writes) {
      write(id, c);
      expect(doc(id).isModified).toBe(true);
      expect(doc(id).savedContent).toBeUndefined();
    }
  }

  it("a setState seed (no savedContent) is dirty on every write, even of its own content", () => {
    useDocumentStore.setState({ documents: [D("a", "A")], activeDocumentId: "a" });
    expectStickyDirty("a");
  });

  it("a dirty upsert without savedContent is dirty on every write", () => {
    store().upsertDocument(D("a", "A", { isModified: true }));
    expect(doc("a").savedContent).toBeUndefined();
    expectStickyDirty("a");
  });

  it("a recovered draft carries no savedContent key and stays dirty on every write", () => {
    const outcome = draftRecoveryOutcome("draft-1", {
      action: "recover",
      outcome: { kind: "ok", result: { originalPath: "/tmp/x.md", content: "A", title: "x.md" } },
    });
    expect(outcome.upsert).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(outcome.upsert, "savedContent")).toBe(false);
    store().upsertDocument(outcome.upsert!);
    expect(doc("draft-1").isModified).toBe(true);
    expectStickyDirty("draft-1");
  });
});

describe("eager mark (markDocumentModified true) changes the flag only", () => {
  it("S6 eager mark then a write equal to the baseline reads clean", () => {
    store().upsertDocument(D("a", "A"));
    store().markDocumentModified("a", true);
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });

  it("S7 eager mark alone reads dirty and keeps content and baseline", () => {
    store().upsertDocument(D("a", "A"));
    store().markDocumentModified("a", true);
    const d = doc("a");
    expect({ content: d.content, isModified: d.isModified, savedContent: d.savedContent }).toEqual({
      content: "A",
      isModified: true,
      savedContent: "A",
    });
  });
});

describe("clean points move the baseline", () => {
  it("S8 markDocumentModified(false) makes the current content the baseline", () => {
    store().upsertDocument(D("a", "A"));
    write("a", "B");
    store().markDocumentModified("a", false);
    expect(doc("a").savedContent).toBe("B");
    expect(doc("a").isModified).toBe(false);
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
    write("a", "B");
    expect(doc("a").isModified).toBe(false);
  });

  it("S8b markDocumentModified(false) gives a sticky document a baseline", () => {
    useDocumentStore.setState({ documents: [D("a", "A", { isModified: true })] });
    store().markDocumentModified("a", false);
    expect(doc("a").savedContent).toBe("A");
    write("a", "AB");
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });

  it("S9 a clean upsert sets savedContent = content, overriding a passed value", () => {
    store().upsertDocument(D("a", "A", { savedContent: "Z" }));
    expect(doc("a").savedContent).toBe("A");
    write("a", "Z");
    expect(doc("a").isModified).toBe(true);
  });

  it("S9b a clean upsert over an existing document resets its baseline", () => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("a", "R"));
    expect(doc("a").savedContent).toBe("R");
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
  });
});

describe("S10 a dirty upsert stores savedContent exactly as passed", () => {
  it("(a) a passed baseline is stored and governs later writes", () => {
    store().upsertDocument(D("a", "AB", { isModified: true, savedContent: "A" }));
    expect(doc("a").savedContent).toBe("A");
    expect(doc("a").isModified).toBe(true);
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });

  it("(b) no key → undefined, never inherited from the document it replaces", () => {
    store().upsertDocument(D("a", "A"));
    expect(doc("a").savedContent).toBe("A");
    store().upsertDocument(D("a", "AB", { isModified: true }));
    expect(doc("a").savedContent).toBeUndefined();
    write("a", "A");
    expect(doc("a").isModified).toBe(true);
  });
});

describe("S11 path changes keep the baseline", () => {
  it("updateDocumentPath and updateDocumentPaths leave savedContent alone", () => {
    store().upsertDocument(D("a", "A"));
    write("a", "AB");
    store().updateDocumentPath("a", "/tmp/renamed.md");
    expect(doc("a").savedContent).toBe("A");
    store().updateDocumentPaths([{ id: "a", path: "/tmp/moved.md" }]);
    expect(doc("a").savedContent).toBe("A");
    expect(doc("a").path).toBe("/tmp/moved.md");
    write("a", "A");
    expect(doc("a").isModified).toBe(false);
  });
});

describe("S12 close decisions through the real dataLossGuards", () => {
  it("undo back to the saved text closes without a prompt and is not listed dirty", () => {
    store().upsertDocument(D("a", "A"));
    store().setActiveDocumentId("a");
    write("a", "AB");
    write("a", "A");
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("close");
    expect(assessWindowUnsaved("window-close").dirtyDocuments).toEqual([]);
  });

  it("a one-character difference prompts and is listed", () => {
    store().upsertDocument(D("a", "A"));
    store().setActiveDocumentId("a");
    write("a", "AB");
    write("a", "B");
    expect(decideCloseRequest(activeDocumentAfterFlush())).toBe("prompt");
    expect(assessWindowUnsaved("window-close").dirtyDocuments).toEqual([
      { id: "a", path: "/tmp/a.md" },
    ]);
  });
});

describe("S13 baselines are per document", () => {
  it("one document's clean point never moves another's baseline", () => {
    store().upsertDocument(D("a", "A"));
    store().upsertDocument(D("b", "B"));
    store().setActiveDocumentId("b");

    write("a", "B");
    write("b", "A");
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([true, "A"]);
    expect([doc("b").isModified, doc("b").savedContent]).toEqual([true, "B"]);

    store().markDocumentModified("a", false);
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "B"]);
    expect([doc("b").isModified, doc("b").savedContent]).toEqual([true, "B"]);

    write("b", "A");
    expect([doc("a").isModified, doc("a").savedContent]).toEqual([false, "B"]);
    expect([doc("b").isModified, doc("b").savedContent]).toEqual([true, "B"]);
    expect(assessWindowUnsaved("window-close").dirtyDocuments).toEqual([
      { id: "b", path: "/tmp/b.md" },
    ]);
  });
});
