/**
 * D208, audit b131 — an ordered list's numbers never pass nine digits. CommonMark reads at
 * most nine digits as a list number, so keeping the start number and counting up from it
 * wrote `999999999. a` / `1000000000. b`, and the second line reopened as text inside the
 * first item. A list whose last number would not fit is written with every item carrying the
 * start number (later numbers are ignored on read). A start that does not fit itself, which
 * only a pasted `<ol start>` can carry, is written from 1.
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

type Row = { id: string; file: string; saved: string };

const ROWS: Row[] = [
  { id: "F1 starts at 999999999", file: "999999999. a\n999999999. b\n", saved: "999999999. a!\n999999999. b\n" },
  { id: "F2 starts at 999999999 with `)`", file: "999999999) a\n999999999) b\n", saved: "999999999) a!\n999999999) b\n" },
  { id: "F3 guard: the last number fits", file: "999999998. a\n999999999. b\n", saved: "999999998. a!\n999999999. b\n" },
];

describe("D208 b131 — list numbers stay within nine digits", () => {
  for (const row of ROWS) {
    it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
      await rig.open(row.file);
      expect(rig.shape(), "structure on open").toBe("ol[li[p(a)] li[p(b)]]");
      rig.typeAtEndOf("a", "!");
      await rig.settle();
      const bytes = rig.doc().content;
      expect(bytes).toBe(row.saved);
      await rig.open(bytes);
      expect(rig.shape(), "structure on reopen").toBe("ol[li[p(a!)] li[p(b)]]");
    });
  }

  it("F4 a pasted <ol start=1000000000> is written from 1", async () => {
    await rig.open("x\n");
    const host = document.createElement("div");
    host.innerHTML = '<ol start="1000000000"><li><p>a</p></li><li><p>b</p></li></ol>';
    const parsed = PmDOMParser.fromSchema(viewOf(rig.editor()).state.schema).parse(host);
    const kids: PmNode[] = [];
    parsed.forEach((c) => kids.push(c));
    rig.replaceWith(() => kids);
    await rig.settle();
    expect(rig.doc().content).toBe("1. a\n2. b\n");
  });
});
