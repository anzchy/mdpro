/**
 * D188 / ADR-0091 — an empty WYSIWYG paragraph is saved as blank lines and read back by
 * count. Matrix sections A (structure → saved bytes → reopen, root) and C (containers).
 * Matrix: ~/.mdpro-redesign/handoff/d188-roundtrip-matrix-adr0091.md (ADR-0091 D5).
 *
 * Convention (ADR-0091, and the user's ruling of 2026-10-14: 「(a) 写入时去掉首尾空段落」):
 * - writer: n empty paragraphs between A and B are A + "\n"×(2n+2) + B, no `<br />` ever;
 * - leading and trailing empty paragraphs are stripped on write in every container. The
 *   strip is a serialize-only projection: the live doc keeps a boundary ∅ until a remount,
 *   so these tests read the bytes (store, save_file args) and check structure only on a
 *   fresh mount, never the live doc after an edit;
 * - reader: b blank lines between positioned siblings of root, blockquote and listItem
 *   become floor((b−1)/2) empty paragraphs.
 *
 * Each row is pinned twice, separately (ADR-0091 D5):
 * - "write": the editor content is set by a user edit; the bytes are what edit-sync puts
 *   in documentStore AND what ⌘S hands to `save_file` (the app save path);
 * - "reopen": a fresh editor mounted on the row's EXPECTED bytes has the row's structure,
 *   so the reader is tested independently of the writer.
 *
 * Real `MilkdownEditor` (the app's own plugin list) through tests/support/d188EmptyParagraphRig.
 * Mocked: `@tauri-apps/api/{core,event,window}` and `loggingService` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act } from "@testing-library/react";

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

import { Fragment, type Node as PmNode, type Schema } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createHeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { viewOf } from "./helpers/milkdownEditorHarness";
import { b, createRig, type Rig } from "./support/d188EmptyParagraphRig";

const SEED = "seed\n";

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

/** Set the editor content by a user edit; return the bytes in the store and on save. */
async function write(build: (s: Schema) => PmNode[]): Promise<{ store: string; saved: string }> {
  await rig.open(SEED);
  rig.replaceWith(build);
  await rig.settle();
  expect(rig.doc().isModified, "the edit did not dirty the document").toBe(true);
  const store = rig.doc().content;
  const saved = (await rig.save()).content as string;
  return { store, saved };
}

async function expectWrites(build: (s: Schema) => PmNode[], bytes: string): Promise<void> {
  const { store, saved } = await write(build);
  expect(store, "bytes edit-sync wrote to documentStore").toBe(bytes);
  expect(saved, "bytes ⌘S passed to save_file").toBe(bytes);
}

async function expectReopens(bytes: string, structure: string): Promise<void> {
  await rig.open(bytes);
  expect(rig.shape(), `structure of a fresh editor on ${JSON.stringify(bytes)}`).toBe(structure);
}

type Row = {
  id: string;
  build: (s: Schema) => PmNode[];
  bytes: string;
  reopens: string;
};

const ROOT_ROWS: Row[] = [
  { id: "A1 [a,b]", build: (s) => [b.p(s, "a"), b.p(s, "b")], bytes: "a\n\nb\n", reopens: "p(a) p(b)" },
  { id: "A2 [a,∅,b]", build: (s) => [b.p(s, "a"), b.e(s), b.p(s, "b")], bytes: "a\n\n\n\nb\n", reopens: "p(a) ∅ p(b)" },
  {
    id: "A3 [a,∅,∅,b]",
    build: (s) => [b.p(s, "a"), b.e(s), b.e(s), b.p(s, "b")],
    bytes: `a${"\n".repeat(6)}b\n`,
    reopens: "p(a) ∅ ∅ p(b)",
  },
  {
    id: "A4 [a,∅,∅,∅,b]",
    build: (s) => [b.p(s, "a"), b.e(s), b.e(s), b.e(s), b.p(s, "b")],
    bytes: `a${"\n".repeat(8)}b\n`,
    reopens: "p(a) ∅ ∅ ∅ p(b)",
  },
  // User ruling 2026-10-14: leading and trailing empties are stripped on write (stock gives a\n\n).
  { id: "A5 [a,∅]", build: (s) => [b.p(s, "a"), b.e(s)], bytes: "a\n", reopens: "p(a)" },
  { id: "A6 [a,∅,∅]", build: (s) => [b.p(s, "a"), b.e(s), b.e(s)], bytes: "a\n", reopens: "p(a)" },
  { id: "A7 [∅,a]", build: (s) => [b.e(s), b.p(s, "a")], bytes: "a\n", reopens: "p(a)" },
  { id: "A7b [∅,∅,a]", build: (s) => [b.e(s), b.e(s), b.p(s, "a")], bytes: "a\n", reopens: "p(a)" },
  { id: "A7c [∅,a,∅]", build: (s) => [b.e(s), b.p(s, "a"), b.e(s)], bytes: "a\n", reopens: "p(a)" },
  { id: "A8 empty editor", build: (s) => [b.e(s)], bytes: "", reopens: "∅" },
  {
    id: "A9 [a,∅,h2(T)]",
    build: (s) => [b.p(s, "a"), b.e(s), b.h2(s, "T")],
    bytes: "a\n\n\n\n## T\n",
    reopens: "p(a) ∅ h2(T)",
  },
];

const CONTAINER_ROWS: Row[] = [
  {
    id: "C1 quote [a,∅,b]",
    build: (s) => [b.bq(s, [b.p(s, "a"), b.e(s), b.p(s, "b")])],
    bytes: "> a\n>\n>\n>\n> b\n",
    reopens: "bq[p(a) ∅ p(b)]",
  },
  {
    id: "C1t quote [a,∅] then z (trailing strip in a quote)",
    build: (s) => [b.bq(s, [b.p(s, "a"), b.e(s)]), b.p(s, "z")],
    bytes: "> a\n\nz\n",
    reopens: "bq[p(a)] p(z)",
  },
  {
    id: "C1l quote [∅,a] then z (leading strip in a quote)",
    build: (s) => [b.bq(s, [b.e(s), b.p(s, "a")]), b.p(s, "z")],
    bytes: "> a\n\nz\n",
    reopens: "bq[p(a)] p(z)",
  },
  {
    id: "C2 list item [a,∅,b]",
    build: (s) => [b.ul(s, [b.li(s, [b.p(s, "a"), b.e(s), b.p(s, "b")])])],
    bytes: "* a\n\n\n\n  b\n",
    reopens: "ul[li[p(a) ∅ p(b)]]",
  },
  {
    id: "C3 item [a,∅] then root c",
    build: (s) => [b.ul(s, [b.li(s, [b.p(s, "a"), b.e(s)])]), b.p(s, "c")],
    bytes: "* a\n\nc\n",
    reopens: "ul[li[p(a)]] p(c)",
  },
  {
    // Measured: stock [li(a), li(c)] is the tight `* a\n* c\n`; stock [li(a,∅), li(c)] is
    // `* a\n\n\n* c\n`. With the strip the list must come out tight, as [li(a), li(c)].
    id: "C3b [li(a,∅), li(c)] writes the tight list",
    build: (s) => [b.ul(s, [b.li(s, [b.p(s, "a"), b.e(s)]), b.li(s, [b.p(s, "c")])])],
    bytes: "* a\n* c\n",
    reopens: "ul[li[p(a)] li[p(c)]]",
  },
  {
    id: "C3d list item [∅,a] (leading strip in an item)",
    build: (s) => [b.ul(s, [b.li(s, [b.e(s), b.p(s, "a")])])],
    bytes: "* a\n",
    reopens: "ul[li[p(a)]]",
  },
  {
    id: "C4 root [list(a),∅,c]",
    build: (s) => [b.ul(s, [b.li(s, [b.p(s, "a")])]), b.e(s), b.p(s, "c")],
    bytes: "* a\n\n\n\nc\n",
    reopens: "ul[li[p(a)]] ∅ p(c)",
  },
];

describe("D188 A — root: structure → saved bytes → reopen", () => {
  for (const row of ROOT_ROWS) {
    it(`${row.id} write → ${JSON.stringify(row.bytes)}`, async () => {
      await expectWrites(row.build, row.bytes);
    });
    it(`${row.id} reopen ${JSON.stringify(row.bytes)} → ${row.reopens}`, async () => {
      await expectReopens(row.bytes, row.reopens);
    });
  }

  it("A-noBr no write of an empty paragraph ever contains a <br> tag", async () => {
    const { store } = await write((s) => [b.e(s), b.p(s, "a"), b.e(s), b.e(s), b.p(s, "b"), b.e(s)]);
    expect(store, "an empty paragraph was written as a <br> tag").not.toMatch(/<br/i);
  });
});

describe("D188 C — containers", () => {
  for (const row of CONTAINER_ROWS) {
    it(`${row.id} write → ${JSON.stringify(row.bytes)}`, async () => {
      await expectWrites(row.build, row.bytes);
    });
    it(`${row.id} reopen ${JSON.stringify(row.bytes)} → ${row.reopens}`, async () => {
      await expectReopens(row.bytes, row.reopens);
    });
  }

  it("C5 an empty table cell loads as one empty paragraph and writes blank (ADR-0067)", async () => {
    const bytes = "| h |\n| - |\n|   |\n";
    await rig.open(bytes);
    expect(rig.shape()).toBe("table[table_header_row[table_header[p(h)]] table_row[table_cell[∅]]]");
    expect(rig.serialize()).toBe(bytes);
  });

  it("C6 a cell holds exactly one paragraph: [p(a), ∅, p(b)] cannot exist in a cell", async () => {
    await rig.open("| h |\n| - |\n|   |\n");
    const s = viewOf(rig.editor()).state.schema;
    const cell = s.nodes.table_cell;
    expect(cell.validContent(Fragment.from([b.p(s, "a"), b.e(s), b.p(s, "b")]))).toBe(false);
    expect(cell.validContent(Fragment.from([b.p(s, "a"), b.e(s)]))).toBe(false);
    expect(cell.validContent(Fragment.empty), "an empty cell needs its one paragraph").toBe(false);
    expect(cell.validContent(Fragment.from(b.e(s)))).toBe(true);
    expect(() => cell.createChecked(null, [b.p(s, "a"), b.e(s), b.p(s, "b")])).toThrow();
    expect(rig.serialize(), "empty-cell bytes").toBe("| h |\n| - |\n|   |\n");
  });

  it("C6b Enter in a table cell leaves the table and never adds a block to the cell", async () => {
    await rig.open("| h |\n| - |\n| a |\n");
    const view = viewOf(rig.editor());
    let pos = -1;
    view.state.doc.descendants((n, p) => {
      if (n.isText && n.text === "a") pos = p + 1; // end of "a"
    });
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    });
    for (let i = 0; i < 2; i += 1) {
      act(() => {
        view.someProp("handleKeyDown", (f) =>
          f(view, new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
        );
      });
    }
    const cells: string[] = [];
    viewOf(rig.editor()).state.doc.descendants((n) => {
      if (n.type.name === "table_cell" || n.type.name === "table_header") {
        cells.push(n.childCount === 1 ? "one" : `many(${n.childCount})`);
        return false;
      }
      return true;
    });
    expect(cells, "a cell holds more than one block").toEqual(["one", "one"]);
    expect(rig.shape(), "the cell content changed").toMatch(/table_cell\[p\(a\)\]/);
    // Enter leaves the table into trailing empty paragraphs. The live doc keeps them (the
    // strip is serialize-only); the written bytes do not.
    await rig.settle();
    expect(rig.doc().content, "trailing empties after the table were written").toBe(
      "| h |\n| - |\n| a |\n",
    );
  });

  // Accepted limit (user ruling 2026-10-14, via the delegator): the reader does not insert
  // paragraphs between `list` children, so the ∅ between two same-kind lists is lost on
  // reopen and the two lists merge. Pinned as observed; the fixed point is NOT claimed.
  it("C7 ACCEPTED LIMIT root [list(a), ∅, list(b)] writes a gap but reopens as ONE list", async () => {
    await expectWrites(
      (s) => [b.ul(s, [b.li(s, [b.p(s, "a")])]), b.e(s), b.ul(s, [b.li(s, [b.p(s, "b")])])],
      "* a\n\n\n\n* b\n",
    );
    await expectReopens("* a\n\n\n\n* b\n", "ul[li[p(a)] li[p(b)]]");
  });
});
