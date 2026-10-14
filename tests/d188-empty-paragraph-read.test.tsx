/**
 * D188 / ADR-0091 — reader-side rows: matrix sections B (files written by people or other
 * editors), D (hard breaks and inline `<br>`, D192 must hold) and E (legacy files written by
 * the pre-D188 `<br />` writer). Matrix: ~/.mdpro-redesign/handoff/d188-roundtrip-matrix-adr0091.md.
 *
 * Each row opens the file bytes in a fresh real editor and pins the structure. Then it makes
 * a user edit elsewhere and pins the bytes edit-sync writes to documentStore (the "saved
 * after an edit" column). The untouched open → save check (store text, clean state, save_file
 * args) for these files lives in
 * tests/d188-empty-paragraph-stability.test.tsx (property F3).
 *
 * Rulings (user, 2026-10-14: 「(a) 写入时去掉首尾空段落」, plus the corrected matrix):
 * - leading and trailing empty paragraphs are stripped on write. The strip is a
 *   serialize-only projection, so no assertion here inspects the live doc after an edit;
 *   structure is read on open only, and bytes from the store;
 * - link definitions are NOT anchors: the reader runs after link inlining, which splices
 *   them out, and a deleted definition's lines never count as blank (B7, B7b);
 * - D192's `BR_PATTERN` is case-insensitive, so a standalone `<BR />` is a legacy empty
 *   paragraph (E6), not an E5 boundary;
 * - the store holds decoded, LF-normalised text; CRLF exists only on disk (B4b).
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

type Edit = { at: "end" | "start"; needle: string; text: string };
type Row = { id: string; file: string; reopens: string; edit?: Edit; saved?: string };

const BANG_B: Edit = { at: "end", needle: "b", text: "!" };

async function runRow(row: Row): Promise<void> {
  await rig.open(row.file);
  expect(rig.shape(), `structure on open of ${JSON.stringify(row.file)}`).toBe(row.reopens);
  if (!row.edit || row.saved === undefined) return;
  if (row.edit.at === "end") rig.typeAtEndOf(row.edit.needle, row.edit.text);
  else rig.typeAtStartOf(row.edit.needle, row.edit.text);
  await rig.settle();
  expect(rig.doc().isModified, "the edit did not dirty the document").toBe(true);
  expect(rig.doc().content, "bytes after an edit elsewhere").toBe(row.saved);
}

function rows(title: string, list: Row[]): void {
  describe(title, () => {
    for (const row of list) {
      it(`${row.id}: ${JSON.stringify(row.file)} → ${row.reopens}`, async () => {
        await runRow(row);
      });
    }
  });
}

rows("D188 B — reader-only inputs", [
  { id: "B0 guard: one blank line", file: "a\n\nb\n", reopens: "p(a) p(b)", edit: BANG_B, saved: "a\n\nb!\n" },
  { id: "B1 b=2, odd leftover ignored", file: "a\n\n\nb\n", reopens: "p(a) p(b)", edit: BANG_B, saved: "a\n\nb!\n" },
  { id: "B2 b=4", file: "a\n\n\n\n\nb\n", reopens: "p(a) ∅ p(b)", edit: BANG_B, saved: "a\n\n\n\nb!\n" },
  { id: "B2b b=5", file: `a${"\n".repeat(6)}b\n`, reopens: "p(a) ∅ ∅ p(b)", edit: BANG_B, saved: `a${"\n".repeat(6)}b!\n` },
  {
    id: "B3 whitespace-only lines are blank (b=3)",
    file: "a\n  \n\t\n \nb\n",
    reopens: "p(a) ∅ p(b)",
    edit: BANG_B,
    saved: "a\n\n\n\nb!\n",
  },
  { id: "B4a raw CRLF counts lines, not \\n bytes", file: "a\r\n\r\n\r\n\r\nb\r\n", reopens: "p(a) ∅ p(b)" },
  {
    id: "B5 no final newline (the writer adds one)",
    file: "a\n\n\n\nb",
    reopens: "p(a) ∅ p(b)",
    edit: BANG_B,
    saved: "a\n\n\n\nb!\n",
  },
  {
    id: "B6 guard: blank lines inside a code fence are content",
    file: "```\nx\n\n\n\ny\n```\n",
    reopens: 'code("x\\n\\n\\n\\ny")',
    edit: { at: "start", needle: "x", text: "!" },
    saved: "```\n!x\n\n\n\ny\n```\n",
  },
  {
    // D194 / ADR-0094: the definition is kept and is an anchor, so three blank lines give one gap.
    id: "B7 a leading definition is not an anchor",
    file: "[r]: http://x\n\n\n\na\n",
    reopens: "link_definition[] ∅ p(a)",
    edit: { at: "end", needle: "a", text: "!" },
    saved: "[r]: http://x\n\n\n\na!\n",
  },
  {
    id: "B7b a definition between paragraphs is not counted as blank lines",
    file: "a\n\n[r]: http://x\n\n\n\nb\n",
    reopens: "p(a) link_definition[] ∅ p(b)",
  },
  {
    id: "B9 code fence followed by 3 blank lines",
    file: "```\nx\n```\n\n\n\nb\n",
    reopens: 'code("x") ∅ p(b)',
    edit: BANG_B,
    saved: "```\nx\n```\n\n\n\nb!\n",
  },
]);

describe("D188 B — raw HTML and the CRLF save path", () => {
  it("B8 raw HTML blocks keep their blank lines: serialize equals the file", async () => {
    const file = "<div>\n\n\n\n</div>\n";
    await rig.open(file);
    expect(rig.shape()).toBe("p(<div>) ∅ p(</div>)");
    expect(rig.serialize(), "blank lines between raw HTML blocks collapsed").toBe(file);
  });

  it("B4b a CRLF file: LF store text, and save_file args carry lineEnding crlf", async () => {
    // Rust normalises CRLF to LF on open and restores it on save (commands/file.rs).
    await rig.open("a\n\n\n\nb\n", { lineEnding: "crlf" });
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
    rig.typeAtEndOf("b", "!");
    await rig.settle();
    const args = await rig.save();
    expect(rig.doc().content, "store text (LF)").toBe("a\n\n\n\nb!\n");
    expect(args.content, "save_file args content").toBe("a\n\n\n\nb!\n");
    expect(args.lineEnding).toBe("crlf");
  });
});

rows("D188 D — hard breaks and inline <br> (D192 must hold)", [
  { id: "D1 backslash hard break", file: "a\\\nb\n", reopens: "p(a⏎b)", edit: { at: "start", needle: "a", text: "X" }, saved: "Xa\\\nb\n" },
  { id: "D2 two-space hard break", file: "a  \nb\n", reopens: "p(a⏎b)", edit: { at: "start", needle: "a", text: "X" }, saved: "Xa\\\nb\n" },
  {
    id: "D3 inline <br />",
    file: "first<br />second\n\nb\n",
    reopens: "p(first<br />second) p(b)",
    edit: BANG_B,
    saved: "first<br />second\n\nb!\n",
  },
  { id: "D4a inline <br>", file: "a<br>c\n\nb\n", reopens: "p(a<br>c) p(b)", edit: BANG_B, saved: "a<br>c\n\nb!\n" },
  { id: "D4b inline <br/>", file: "a<br/>c\n\nb\n", reopens: "p(a<br/>c) p(b)", edit: BANG_B, saved: "a<br/>c\n\nb!\n" },
  { id: "D4c inline <br >", file: "a<br >c\n\nb\n", reopens: "p(a<br >c) p(b)", edit: BANG_B, saved: "a<br >c\n\nb!\n" },
  {
    id: "D5 inline <br/> in a list item",
    file: "- item<br/>more\n",
    reopens: "ul[li[p(item<br/>more)]]",
    edit: { at: "start", needle: "item", text: "X" },
    saved: "- Xitem<br/>more\n",
  },
  {
    id: "D6 inline <br> in a table cell",
    file: "| a |\n| - |\n| x<br>y |\n",
    reopens: "table[table_header_row[table_header[p(a)]] table_row[table_cell[p(x<br>y)]]]",
  },
]);

describe("D188 D6 — table cell serialization", () => {
  it("D6 a table cell keeps its <br> through serialize", async () => {
    await rig.open("| a |\n| - |\n| x<br>y |\n");
    expect(rig.serialize()).toBe("| a      |\n| ------ |\n| x<br>y |\n");
  });
});

rows("D188 E — legacy files written by the <br /> writer", [
  { id: "E1 one legacy empty", file: "a\n\n<br />\n\nb\n", reopens: "p(a) ∅ p(b)", edit: BANG_B, saved: "a\n\n\n\nb!\n" },
  {
    id: "E2 two legacy empties",
    file: "a\n\n<br />\n\n<br />\n\nb\n",
    reopens: "p(a) ∅ ∅ p(b)",
    edit: BANG_B,
    saved: `a${"\n".repeat(6)}b!\n`,
  },
  {
    id: "E3 a trailing legacy empty is stripped after an edit",
    file: "a\n\n<br />\n",
    reopens: "p(a) ∅",
    edit: { at: "end", needle: "a", text: "!" },
    saved: "a!\n",
  },
  {
    id: "E4 a legacy empty in a quote",
    file: "> a\n>\n> <br />\n>\n> b\n",
    reopens: "bq[p(a) ∅ p(b)]",
    edit: BANG_B,
    saved: "> a\n>\n>\n>\n> b!\n",
  },
  { id: "E4b legacy <br> without a slash", file: "a\n\n<br>\n\nb\n", reopens: "p(a) ∅ p(b)", edit: BANG_B, saved: "a\n\n\n\nb!\n" },
  {
    id: "E4c a legacy empty in a list item",
    file: "* a\n\n  <br />\n\n  b\n",
    reopens: "ul[li[p(a) ∅ p(b)]]",
    edit: BANG_B,
    saved: "* a\n\n\n\n  b!\n",
  },
  {
    // D192's BR_PATTERN is case-insensitive (/^<br\s*\/?\s*>$/i).
    id: "E6 a standalone upper-case <BR /> is a legacy empty paragraph",
    file: "a\n\n<BR />\n\nb\n",
    reopens: "p(a) ∅ p(b)",
    edit: BANG_B,
    saved: "a\n\n\n\nb!\n",
  },
  {
    id: "E6b an upper-case <BR> with inline text around it stays an atom",
    file: "a<BR>c\n\nb\n",
    reopens: "p(a<BR>c) p(b)",
    edit: BANG_B,
    saved: "a<BR>c\n\nb!\n",
  },
]);

const KEPT = [
  { id: "E5b", v: '<br class="x" />', shown: '<br class="x" />' },
  { id: "E5c", v: "<br /><br />", shown: "<br /><br />" },
  { id: "E5d", v: "`<br />`", shown: "<br />" },
  { id: "E5e", v: "\\<br />", shown: "<br />" },
  { id: "E5f", v: "<br /> text", shown: "<br /> text" },
];

rows(
  "D188 E5 — recognition boundaries: not empty paragraphs, kept as written",
  KEPT.map(({ id, v, shown }) => ({
    id: `${id} ${v}`,
    file: `a\n\n${v}\n\nb\n`,
    reopens: `p(a) p(${shown}) p(b)`,
    edit: BANG_B,
    saved: `a\n\n${v}\n\nb!\n`,
  })),
);
