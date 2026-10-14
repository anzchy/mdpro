/**
 * D204 — a list is written back with the marker it was read with. Milkdown builds its
 * stringifier with no list options, so mdast-util-to-markdown wrote every bullet list with
 * its default `*` and every ordered list with `.`: a file of `-` bullets came back as `*`
 * on the first save after an edit, and two adjacent lists swapped markers.
 *
 * Each M row opens the bytes in a fresh real editor, pins the structure, types `!` at the
 * end of `a`, and pins the bytes edit-sync writes to documentStore. N rows are lists with no
 * source marker (built in the editor, pasted as HTML): they get the ruled default, `-` and
 * `.` (delegator ruling 2026-10-15). C1 copies a list through the schema's toDOM / parseDOM.
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
import {
  DOMParser as PmDOMParser,
  DOMSerializer,
  type Node as PmNode,
} from "@milkdown/kit/prose/model";
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

async function editedBytes(row: Row): Promise<string> {
  await rig.open(row.file);
  expect(rig.shape(), `structure on open of ${JSON.stringify(row.file)}`).toBe(row.reopens);
  rig.typeAtEndOf("a", "!");
  await rig.settle();
  expect(rig.doc().isModified, "the edit did not dirty the document").toBe(true);
  return rig.doc().content;
}

const ROWS: Row[] = [
  { id: "M1 `-` bullets", file: "- a\n- b\n", reopens: "ul[li[p(a)] li[p(b)]]", saved: "- a!\n- b\n" },
  { id: "M2 `+` bullets", file: "+ a\n+ b\n", reopens: "ul[li[p(a)] li[p(b)]]", saved: "+ a!\n+ b\n" },
  { id: "M3 guard: `*` bullets", file: "* a\n* b\n", reopens: "ul[li[p(a)] li[p(b)]]", saved: "* a!\n* b\n" },
  {
    id: "M4 nested list with a different marker",
    file: "- a\n  * x\n- b\n",
    reopens: "ul[li[p(a) ul[li[p(x)]]] li[p(b)]]",
    saved: "- a!\n  * x\n- b\n",
  },
  {
    id: "M5 list inside a blockquote",
    file: "> - a\n> - b\n",
    reopens: "bq[ul[li[p(a)] li[p(b)]]]",
    saved: "> - a!\n> - b\n",
  },
  {
    id: "M6 task list",
    file: "- [ ] a\n- [x] b\n",
    reopens: "ul[li[p(a)] li[p(b)]]",
    saved: "- [ ] a!\n- [x] b\n",
  },
  {
    id: "M7 two adjacent lists keep their own markers (no swap)",
    file: "- a\n\n* b\n",
    reopens: "ul[li[p(a)]] ul[li[p(b)]]",
    saved: "- a!\n\n* b\n",
  },
  {
    id: "M8 `)` ordered delimiter",
    file: "1) a\n2) b\n",
    reopens: "ol[li[p(a)] li[p(b)]]",
    saved: "1) a!\n2) b\n",
  },
  {
    id: "M9 list after a D188 blank-line gap",
    file: "p\n\n\n\n- a\n- b\n",
    reopens: "p(p) ∅ ul[li[p(a)] li[p(b)]]",
    saved: "p\n\n\n\n- a!\n- b\n",
  },
  {
    id: "M10 loose `-` list keeps marker and spacing (D195)",
    file: "- a\n\n- b\n",
    reopens: "ul[li[p(a)] li[p(b)]]",
    saved: "- a!\n\n- b\n",
  },
  {
    id: "M11 `+` nested in an ordered `)` list",
    file: "1) a\n   + x\n2) b\n",
    reopens: "ol[li[p(a) ul[li[p(x)]]] li[p(b)]]",
    saved: "1) a!\n   + x\n2) b\n",
  },
];

describe("D204 — a list keeps its source marker through read → edit → write", () => {
  for (const row of ROWS) {
    it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
      expect(await editedBytes(row)).toBe(row.saved);
    });
  }
});

describe("D204 — the stock writer's safety switch is kept", () => {
  it("E1 guard: a `*` list whose item holds a thematic break keeps its structure on reopen", async () => {
    await rig.open("* ---\n* a\n");
    const opened = rig.shape();
    expect(opened).toBe("ul[li[∅ hr[]] li[p(a)]]");
    rig.typeAtEndOf("a", "!");
    await rig.settle();
    await rig.open(rig.doc("doc-a").content);
    expect(rig.shape()).toBe("ul[li[∅ hr[]] li[p(a!)]]");
  });
});

describe("D204 — lists with no source marker get the default", () => {
  it("N1 a bullet list built in the editor is written with `-`", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create(null, [
        s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("a"))),
        s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("b"))),
      ]),
    ]);
    await rig.settle();
    expect(rig.doc().content).toBe("- a\n- b\n");
  });

  it("N2 a pasted <ul> is written with `-`", async () => {
    await rig.open("x\n");
    const host = document.createElement("div");
    host.innerHTML = "<ul><li><p>a</p></li><li><p>b</p></li></ul>";
    const parsed = PmDOMParser.fromSchema(viewOf(rig.editor()).state.schema).parse(host);
    const kids: PmNode[] = [];
    parsed.forEach((c) => kids.push(c));
    rig.replaceWith(() => kids);
    await rig.settle();
    expect(rig.doc().content).toBe("- a\n- b\n");
  });

  it("N3 two adjacent editor-built lists still differ, so they stay two lists", async () => {
    await rig.open("x\n");
    const item = (s: Parameters<Parameters<Rig["replaceWith"]>[0]>[0], t: string) =>
      s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text(t)));
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create(null, [item(s, "a")]),
      s.nodes.bullet_list.create(null, [item(s, "b")]),
    ]);
    await rig.settle();
    const bytes = rig.doc().content;
    expect(bytes).toBe("- a\n\n* b\n");
    await rig.open(bytes);
    expect(rig.shape()).toBe("ul[li[p(a)]] ul[li[p(b)]]");
  });
});

describe("D204 — the marker survives copy inside the editor and remounts", () => {
  it("C1 a `+` list copied through toDOM → parseDOM keeps `+`", async () => {
    await rig.open("+ a\n+ b\n");
    const view = viewOf(rig.editor());
    const dom = DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content);
    const host = document.createElement("div");
    host.appendChild(dom);
    const parsed = PmDOMParser.fromSchema(view.state.schema).parse(host);
    const kids: PmNode[] = [];
    parsed.forEach((c) => kids.push(c));
    rig.replaceWith(() => kids);
    rig.typeAtEndOf("a", "!");
    await rig.settle();
    expect(rig.doc().content).toBe("+ a!\n+ b\n");
  });

  it("S1 serialize → remount → serialize keeps a `+` list (idempotent)", async () => {
    const first = await editedBytes(ROWS[1]);
    expect(first).toBe(ROWS[1].saved);
    await rig.remountFromStore();
    expect(rig.serialize()).toBe(first);
  });

  it("S2 guard: untouched open → save writes the file's own bytes", async () => {
    await rig.open("+ a\n+ b\n");
    await rig.settle();
    expect(rig.doc().isModified).toBe(false);
    const args = await rig.save();
    expect(args.content).toBe("+ a\n+ b\n");
  });
});
