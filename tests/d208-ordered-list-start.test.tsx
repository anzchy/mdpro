/**
 * D208 — an ordered list is written back from the number it started at. preset-commonmark's
 * `ordered_list` reads no `start` from the file (its `order` attr stays 1) and writes
 * `start: 1`, and D195's re-registration kept that, so `5. a` came back as `1. a` on the
 * first save after an edit. That changes the document's content, not only its style.
 *
 * Each O row opens the bytes in a fresh real editor, pins the structure, types `!` at the
 * end of `a`, and pins the bytes edit-sync writes to documentStore. P1 is a pasted `<ol
 * start>`, which the schema's parseDOM already reads into `order`.
 *
 * Real `MilkdownEditor` through tests/support/d188EmptyParagraphRig. Mocked:
 * `@tauri-apps/api/{core,event,window}` and `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: async () => {},
    generateActionId: () => "test-id",
  },
}));

import { createHeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { createRig, type Rig } from "./support/d188EmptyParagraphRig";
import { DOMParser as PmDOMParser, type Node as PmNode } from "@milkdown/kit/prose/model";
import { viewOf } from "./helpers/milkdownEditorHarness";

let rig: Rig;

beforeEach(() => {
  installIntersectionObserverDouble();
  invokeMock.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  rig = createRig(createHeldInvoke(invokeMock));
});

afterEach(async () => {
  await rig.close();
});

type Row = { id: string; file: string; reopens: string; saved: string };

const ROWS: Row[] = [
  { id: "O1 starts at 5", file: "5. a\n6. b\n", reopens: "ol[li[p(a)] li[p(b)]]", saved: "5. a!\n6. b\n" },
  { id: "O2 starts at 0", file: "0. a\n1. b\n", reopens: "ol[li[p(a)] li[p(b)]]", saved: "0. a!\n1. b\n" },
  { id: "O3 guard: starts at 1", file: "1. a\n2. b\n", reopens: "ol[li[p(a)] li[p(b)]]", saved: "1. a!\n2. b\n" },
  {
    id: "O4 loose list starting at 3",
    file: "3. a\n\n4. b\n",
    reopens: "ol[li[p(a)] li[p(b)]]",
    saved: "3. a!\n\n4. b\n",
  },
  {
    // Not nested under a paragraph: a list starting at any number but 1 cannot interrupt one.
    id: "O5 list starting at 7 inside a blockquote",
    file: "> 7. a\n> 8. b\n",
    reopens: "bq[ol[li[p(a)] li[p(b)]]]",
    saved: "> 7. a!\n> 8. b\n",
  },
  {
    id: "O6 starts at 12 with the `)` delimiter",
    file: "12) a\n13) b\n",
    reopens: "ol[li[p(a)] li[p(b)]]",
    saved: "12) a!\n13) b\n",
  },
];

describe("D208 — an ordered list keeps its start number through read → edit → write", () => {
  for (const row of ROWS) {
    it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
      await rig.open(row.file);
      expect(rig.shape(), "structure on open").toBe(row.reopens);
      rig.typeAtEndOf("a", "!");
      await rig.settle();
      expect(rig.doc().isModified, "the edit did not dirty the document").toBe(true);
      expect(rig.doc().content).toBe(row.saved);
    });
  }

  it("S1 serialize → remount → serialize keeps the start (idempotent)", async () => {
    await rig.open(ROWS[0].file);
    rig.typeAtEndOf("a", "!");
    await rig.settle();
    const first = rig.doc().content;
    expect(first).toBe(ROWS[0].saved);
    await rig.remountFromStore();
    expect(rig.serialize()).toBe(first);
  });

  it("P1 a pasted <ol start=4> is written from 4", async () => {
    await rig.open("x\n");
    const host = document.createElement("div");
    host.innerHTML = '<ol start="4"><li><p>a</p></li><li><p>b</p></li></ol>';
    const parsed = PmDOMParser.fromSchema(viewOf(rig.editor()).state.schema).parse(host);
    const kids: PmNode[] = [];
    parsed.forEach((c) => kids.push(c));
    rig.replaceWith(() => kids);
    await rig.settle();
    expect(rig.doc().content).toBe("4. a\n5. b\n");
  });
});
