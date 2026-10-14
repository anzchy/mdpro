/**
 * D195 — a tight list read from a file is written back tight after an edit, and a loose one
 * stays loose. preset-commonmark@7.18.0 keeps `spread` as the string "true" / "false"; its
 * `bullet_list` and plain `list_item` serializers hand that string to mdast, and
 * mdast-util-to-markdown only honours a boolean `spread`, so every tight bullet list (and
 * every list item holding a nested list) gained blank lines on the first save after an edit.
 *
 * Each row opens the bytes in a fresh real editor, pins the structure, types `!` at the end
 * of `a`, and pins the bytes edit-sync writes to documentStore. The `*` marker and the
 * `1.`-renumbering are the stock writer's, unchanged by D195.
 *
 * The P rows reach the other producer of `spread`: the schema's parseDOM (a pasted HTML
 * list), which stores a boolean for `ul` / `li` and the `data-spread` string for `ol`.
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

const BANG_A = { needle: "a", text: "!" };

type Row = { id: string; file: string; reopens: string; saved: string };

async function editedBytes(row: Row): Promise<string> {
  await rig.open(row.file);
  expect(rig.shape(), `structure on open of ${JSON.stringify(row.file)}`).toBe(row.reopens);
  rig.typeAtEndOf(BANG_A.needle, BANG_A.text);
  await rig.settle();
  expect(rig.doc().isModified, "the edit did not dirty the document").toBe(true);
  return rig.doc().content;
}

const ROWS: Row[] = [
  { id: "L1 tight bullet", file: "- a\n- b\n", reopens: "ul[li[p(a)] li[p(b)]]", saved: "* a!\n* b\n" },
  { id: "L2 guard: loose bullet", file: "- a\n\n- b\n", reopens: "ul[li[p(a)] li[p(b)]]", saved: "* a!\n\n* b\n" },
  { id: "L3 guard: tight ordered", file: "1. a\n2. b\n", reopens: "ol[li[p(a)] li[p(b)]]", saved: "1. a!\n2. b\n" },
  { id: "L4 guard: loose ordered", file: "1. a\n\n2. b\n", reopens: "ol[li[p(a)] li[p(b)]]", saved: "1. a!\n\n2. b\n" },
  {
    id: "L5 tight bullet nested in tight bullet",
    file: "- a\n  - x\n  - y\n- b\n",
    reopens: "ul[li[p(a) ul[li[p(x)] li[p(y)]]] li[p(b)]]",
    saved: "* a!\n  * x\n  * y\n* b\n",
  },
  {
    id: "L6 tight bullet nested in loose bullet",
    file: "- a\n\n  - x\n  - y\n\n- b\n",
    reopens: "ul[li[p(a) ul[li[p(x)] li[p(y)]]] li[p(b)]]",
    saved: "* a!\n\n  * x\n  * y\n\n* b\n",
  },
  {
    id: "L7 tight ordered nested in tight bullet",
    file: "- a\n  1. x\n  2. y\n- b\n",
    reopens: "ul[li[p(a) ol[li[p(x)] li[p(y)]]] li[p(b)]]",
    saved: "* a!\n  1. x\n  2. y\n* b\n",
  },
  {
    id: "L8 tight bullet nested in tight ordered",
    file: "1. a\n   - x\n   - y\n2. b\n",
    reopens: "ol[li[p(a) ul[li[p(x)] li[p(y)]]] li[p(b)]]",
    saved: "1. a!\n   * x\n   * y\n2. b\n",
  },
  {
    id: "L9 tight task list (gfm list item)",
    file: "- [ ] a\n- [x] b\n",
    reopens: "ul[li[p(a)] li[p(b)]]",
    saved: "* [ ] a!\n* [x] b\n",
  },
  {
    id: "L10 guard: loose task list",
    file: "- [ ] a\n\n- [x] b\n",
    reopens: "ul[li[p(a)] li[p(b)]]",
    saved: "* [ ] a!\n\n* [x] b\n",
  },
  {
    id: "L11 tight list after a D188 blank-line gap",
    file: "p\n\n\n\n- a\n- b\n",
    reopens: "p(p) ∅ ul[li[p(a)] li[p(b)]]",
    saved: "p\n\n\n\n* a!\n* b\n",
  },
  {
    id: "L12 tight list before a D188 blank-line gap",
    file: "- a\n- b\n\n\n\nq\n",
    reopens: "ul[li[p(a)] li[p(b)]] ∅ p(q)",
    saved: "* a!\n* b\n\n\n\nq\n",
  },
  {
    id: "L13 tight list inside a blockquote",
    file: "> - a\n> - b\n",
    reopens: "bq[ul[li[p(a)] li[p(b)]]]",
    saved: "> * a!\n> * b\n",
  },
];

describe("D195 — list spread survives read → edit → write", () => {
  for (const row of ROWS) {
    it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
      expect(await editedBytes(row)).toBe(row.saved);
    });
  }
});

describe("D195 — stability", () => {
  it("S1 serialize → remount → serialize keeps a tight list tight (idempotent)", async () => {
    const first = await editedBytes(ROWS[4]);
    expect(first).toBe(ROWS[4].saved);
    await rig.remountFromStore();
    expect(rig.serialize()).toBe(first);
  });

  it("S2 untouched open → save writes the file's own bytes", async () => {
    await rig.open("- a\n- b\n");
    await rig.settle();
    expect(rig.doc().isModified).toBe(false);
    const args = await rig.save();
    expect(args.content).toBe("- a\n- b\n");
  });

  it("S3 a list built in the editor (schema defaults) is written tight", async () => {
    await rig.open("x\n");
    rig.replaceWith((s) => [
      s.nodes.bullet_list.create(null, [
        s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("a"))),
        s.nodes.list_item.create(null, s.nodes.paragraph.create(null, s.text("b"))),
      ]),
    ]);
    await rig.settle();
    expect(rig.doc().content).toBe("* a\n* b\n");
  });
});

/** A pasted HTML list: parsed by the live schema's parseDOM, then put in as a user edit. */
async function pastedBytes(html: string): Promise<{ bytes: string; spreads: string[] }> {
  await rig.open("x\n");
  const host = document.createElement("div");
  host.innerHTML = html;
  const parsed = PmDOMParser.fromSchema(viewOf(rig.editor()).state.schema).parse(host);
  const spreads: string[] = [];
  parsed.descendants((n: PmNode) => {
    if ("spread" in n.attrs) spreads.push(`${n.type.name}:${typeof n.attrs.spread}`);
    return true;
  });
  const kids: PmNode[] = [];
  parsed.forEach((c) => kids.push(c));
  rig.replaceWith(() => kids);
  await rig.settle();
  return { bytes: rig.doc().content, spreads };
}

describe("D195 — spread from parseDOM (pasted HTML)", () => {
  it("P1 a pasted tight <ul> (boolean false) is written tight", async () => {
    const r = await pastedBytes(
      '<ul data-spread="false"><li data-spread="false"><p>a</p></li><li data-spread="false"><p>b</p></li></ul>',
    );
    expect(r.spreads).toEqual(["bullet_list:boolean", "list_item:boolean", "list_item:boolean"]);
    expect(r.bytes).toBe("* a\n* b\n");
  });

  it("P2 a pasted loose <ul> (boolean true) is written loose", async () => {
    const r = await pastedBytes(
      '<ul data-spread="true"><li data-spread="true"><p>a</p></li><li data-spread="true"><p>b</p></li></ul>',
    );
    expect(r.spreads).toEqual(["bullet_list:boolean", "list_item:boolean", "list_item:boolean"]);
    expect(r.bytes).toBe("* a\n\n* b\n");
  });

  it("P3 a pasted loose <ol> (the data-spread string) is written loose", async () => {
    const r = await pastedBytes(
      '<ol data-spread="true"><li data-spread="false"><p>a</p></li><li data-spread="false"><p>b</p></li></ol>',
    );
    expect(r.spreads[0]).toBe("ordered_list:string");
    expect(r.bytes).toBe("1. a\n\n2. b\n");
  });

  it("P4 a pasted tight list holding a nested list (boolean item spread) stays tight", async () => {
    const r = await pastedBytes(
      '<ul data-spread="false"><li data-spread="false"><p>a</p><ul data-spread="false">' +
        '<li data-spread="false"><p>x</p></li></ul></li><li data-spread="false"><p>b</p></li></ul>',
    );
    expect(r.bytes).toBe("* a\n  * x\n* b\n");
  });
});
