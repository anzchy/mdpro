/**
 * D226 — WYSIWYG shows an ordered list from the number it starts at. D208 kept the
 * start in the `order` attr and in the saved bytes, but the editor's `<ol>` carried
 * only `data-order`, so WebKit and WebView2 numbered `5. five / 6. six` as 1, 2. The
 * list now carries `start` whenever it does not start at 1.
 *
 * Each row opens the bytes in a fresh real editor and reads the `start` attribute the
 * editor rendered. The bytes stay pinned by tests/d208-ordered-list-start.test.tsx.
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

/** The `start` attribute of every `<ol>` the editor rendered, outermost first. */
function renderedStarts(): (string | null)[] {
  const dom = viewOf(rig.editor()).dom;
  return Array.from(dom.querySelectorAll("ol")).map((ol) => ol.getAttribute("start"));
}

const ROWS: { id: string; file: string; starts: (string | null)[] }[] = [
  { id: "R1 starts at 5", file: "5. a\n6. b\n", starts: ["5"] },
  { id: "R2 starts at 0 (falsy, still shown)", file: "0. a\n1. b\n", starts: ["0"] },
  { id: "R3 guard: starts at 1 carries no start", file: "1. a\n2. b\n", starts: [null] },
  { id: "R4 starts at 12 with the `)` delimiter", file: "12) a\n13) b\n", starts: ["12"] },
  { id: "R5 list starting at 7 inside a blockquote", file: "> 7. a\n> 8. b\n", starts: ["7"] },
  { id: "R6 a nested list keeps its own start", file: "3. a\n\n   9. x\n   10. y\n", starts: ["3", "9"] },
];

describe("D226 — the WYSIWYG <ol> carries the list's start number", () => {
  for (const row of ROWS) {
    it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
      await rig.open(row.file);
      expect(renderedStarts()).toEqual(row.starts);
    });
  }

  it("R7 a pasted <ol start=4> renders from 4 and is still written from 4", async () => {
    await rig.open("x\n");
    const host = document.createElement("div");
    host.innerHTML = '<ol start="4"><li><p>a</p></li><li><p>b</p></li></ol>';
    const parsed = PmDOMParser.fromSchema(viewOf(rig.editor()).state.schema).parse(host);
    const kids: PmNode[] = [];
    parsed.forEach((c) => kids.push(c));
    rig.replaceWith(() => kids);
    await rig.settle();
    expect(renderedStarts()).toEqual(["4"]);
    expect(rig.doc().content).toBe("4. a\n5. b\n");
  });
});
