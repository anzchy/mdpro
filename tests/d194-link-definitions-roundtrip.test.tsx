/**
 * D194 / ADR-0094 — link reference definitions survive an edit + save. Rows R1–R14.
 *
 * Defect: preset-commonmark's `remarkInlineLinkPlugin` splices every mdast `definition` out
 * of the tree, so the first edited save drops them (data loss). Decision (ADR-0094, option B
 * + display (i)):
 * - a block atom node `link_definition` (attrs identifier / label / url / title / raw) that
 *   serializes VERBATIM as its raw source; consecutive definitions are joined tight;
 * - references (`[t][r]`, `[r][]`, `[r]`, `![a][i]`) are still resolved and inlined by our
 *   own resolver: case-insensitive label match, first definition wins. After an edit
 *   `[docs][r]` saves as `[docs](http://x)` while `[r]: http://x` stays (accepted);
 * - the D188 reader (ADR-0091) counts blank lines next to a definition, which is now a
 *   positioned sibling (R13). This supersedes the D188 read rows B7 / B7b.
 *
 * Each row opens the file in a fresh real editor, pins the structure, types `!` at the end of
 * a paragraph elsewhere (`Zed.` unless stated), and pins the bytes edit-sync writes to
 * documentStore and the bytes ⌘S hands to `save_file` (the structure check is soft, so a
 * failing row reports both its structure and its bytes). R14 (GFM footnotes) is a guard that
 * passes before the fix.
 *
 * Real `MilkdownEditor` through tests/support/d188EmptyParagraphRig (+ d194LinkDefinitionRig).
 * Mocked: `@tauri-apps/api/{core,event,window}` and `loggingService` only.
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
import { definitions } from "./support/d194LinkDefinitionRig";
import { collectionCases } from "./support/collectionCases";

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

type Row = { id: string; file: string; reopens: string; needle?: string; saved: string };

/** Open, pin the structure, type `!` at the end of `needle`, return store and save bytes. */
async function editAndSave(file: string, needle: string): Promise<{ store: string; saved: string }> {
  rig.typeAtEndOf(needle, "!");
  await rig.settle();
  expect(rig.doc().isModified, `the edit did not dirty ${JSON.stringify(file)}`).toBe(true);
  const store = rig.doc().content;
  const saved = (await rig.save()).content as string;
  return { store, saved };
}

async function runRow(row: Row): Promise<void> {
  await rig.open(row.file);
  // Soft, so a red row also reports what the edited save lost.
  expect.soft(rig.shape(), `structure on open of ${JSON.stringify(row.file)}`).toBe(row.reopens);
  const { store, saved } = await editAndSave(row.file, row.needle ?? "Zed.");
  expect(store, "bytes edit-sync wrote to documentStore").toBe(row.saved);
  expect(saved, "bytes ⌘S passed to save_file").toBe(row.saved);
}

function rows(title: string, list: Row[]): void {
  describe(title, () => {
    for (const row of collectionCases("tests/d194-link-definitions-roundtrip.test.tsx:85", list)) {
      it(`${row.id}: ${JSON.stringify(row.file)}`, async () => {
        await runRow(row);
      });
    }
  });
}

rows("D194 R1–R10 — definitions are kept verbatim after an edit elsewhere", [
  {
    id: "R1 unused definition kept",
    file: "Zed.\n\nText only.\n\n[r]: http://x\n",
    reopens: "p(Zed.) p(Text only.) link_definition[]",
    saved: "Zed.!\n\nText only.\n\n[r]: http://x\n",
  },
  {
    id: "R2 used definition kept, reference inlined",
    file: 'Zed.\n\nSee [docs][r].\n\n[r]: http://x "T"\n',
    reopens: "p(Zed.) p(See docs.) link_definition[]",
    saved: 'Zed.!\n\nSee [docs](http://x "T").\n\n[r]: http://x "T"\n',
  },
  {
    id: "R3 image reference inlined, definition kept",
    file: "Zed.\n\n![img][i]\n\n[i]: a.png\n",
    reopens: "p(Zed.) p(<image>) link_definition[]",
    saved: "Zed.!\n\n![img](a.png)\n\n[i]: a.png\n",
  },
  {
    id: "R4a verbatim spelling: odd spacing, angle brackets, single-quoted title",
    file: "Zed.\n\n[Ref]:   <http://x y>   'T i'\n",
    reopens: "p(Zed.) link_definition[]",
    saved: "Zed.!\n\n[Ref]:   <http://x y>   'T i'\n",
  },
  {
    id: "R4b verbatim spelling: title on the next line",
    file: 'Zed.\n\n[r]: http://x\n  "T"\n',
    reopens: "p(Zed.) link_definition[]",
    saved: 'Zed.!\n\n[r]: http://x\n  "T"\n',
  },
  {
    id: "R5 consecutive definitions stay tight",
    file: "Zed.\n\n[a]: http://a\n[b]: http://b\n",
    reopens: "p(Zed.) link_definition[] link_definition[]",
    saved: "Zed.!\n\n[a]: http://a\n[b]: http://b\n",
  },
  {
    id: "R6 duplicate labels: both kept, the reference takes the FIRST url",
    file: "Zed.\n\nSee [docs][r].\n\n[r]: http://first\n[r]: http://second\n",
    reopens: "p(Zed.) p(See docs.) link_definition[] link_definition[]",
    saved: "Zed.!\n\nSee [docs](http://first).\n\n[r]: http://first\n[r]: http://second\n",
  },
  {
    id: "R7 labels match case-insensitively",
    file: "Zed.\n\nSee [docs][R].\n\n[r]: http://x\n",
    reopens: "p(Zed.) p(See docs.) link_definition[]",
    saved: "Zed.!\n\nSee [docs](http://x).\n\n[r]: http://x\n",
  },
  {
    id: "R8a collapsed reference [r][] resolves",
    file: "Zed.\n\nSee [r][].\n\n[r]: http://x\n",
    reopens: "p(Zed.) p(See r.) link_definition[]",
    saved: "Zed.!\n\nSee [r](http://x).\n\n[r]: http://x\n",
  },
  {
    id: "R8b shortcut reference [r] resolves",
    file: "Zed.\n\nSee [r].\n\n[r]: http://x\n",
    reopens: "p(Zed.) p(See r.) link_definition[]",
    saved: "Zed.!\n\nSee [r](http://x).\n\n[r]: http://x\n",
  },
  {
    id: "R9 a definition between paragraphs stays in place",
    file: "Zed.\n\nSee [docs][r].\n\n[r]: http://x\n\nAfter.\n",
    reopens: "p(Zed.) p(See docs.) link_definition[] p(After.)",
    saved: "Zed.!\n\nSee [docs](http://x).\n\n[r]: http://x\n\nAfter.\n",
  },
  {
    id: "R10 a definition inside a blockquote stays inside it",
    file: "Zed.\n\n> See [docs][r].\n>\n> [r]: http://x\n",
    reopens: "p(Zed.) bq[p(See docs.) link_definition[]]",
    saved: "Zed.!\n\n> See [docs](http://x).\n>\n> [r]: http://x\n",
  },
]);

describe("D194 R11 — a definition inside a list item", () => {
  it("R11 stays inside the item and the reference is inlined (tight/loose not pinned: D195)", async () => {
    const file = "Zed.\n\n* See [docs][r].\n\n  [r]: http://x\n";
    await rig.open(file);
    const { store, saved } = await editAndSave(file, "Zed.");
    for (const [what, text] of [
      ["store", store],
      ["save_file", saved],
    ] as const) {
      expect(text, `${what}: the reference is inlined`).toContain("[docs](http://x)");
      expect(text, `${what}: the definition is kept, indented inside the item`).toMatch(
        /\n[ ]{2,}\[r\]: http:\/\/x\n$/,
      );
      expect(text.indexOf("[r]: http://x"), `${what}: definition after the item's paragraph`).toBeGreaterThan(
        text.indexOf("See [docs]"),
      );
    }
  });
});

describe("D194 R12 — node structure", () => {
  it("R12a attrs: identifier normalized, label as written, url, title, raw = source slice", async () => {
    await rig.open('Zed.\n\nSee [docs][R].\n\n[R]: http://x "T"\n[u]: http://u\n');
    expect(definitions(rig).map((d) => d.attrs)).toEqual([
      { identifier: "r", label: "R", url: "http://x", title: "T", raw: '[R]: http://x "T"' },
      { identifier: "u", label: "u", url: "http://u", title: null, raw: "[u]: http://u" },
    ]);
  });

  it("R12b attrs of an odd spelling: angle-bracket url, single-quoted title, raw kept", async () => {
    await rig.open("Zed.\n\n[Ref]:   <http://x y>   'T i'\n");
    expect(definitions(rig).map((d) => d.attrs)).toEqual([
      {
        identifier: "ref",
        label: "Ref",
        url: "http://x y",
        title: "T i",
        raw: "[Ref]:   <http://x y>   'T i'",
      },
    ]);
  });

  it("R12c raw of a two-line definition spans both lines", async () => {
    await rig.open('Zed.\n\n[r]: http://x\n  "T"\n');
    expect(definitions(rig).map((d) => d.attrs.raw)).toEqual(['[r]: http://x\n  "T"']);
  });
});

rows("D194 R13 — D188 interplay: blank lines next to a definition count (ADR-0091)", [
  {
    id: "R13a a definition between a and a gap",
    file: "a\n\n[r]: http://x\n\n\n\nb\n",
    reopens: "p(a) link_definition[] ∅ p(b)",
    needle: "b",
    saved: "a\n\n[r]: http://x\n\n\n\nb!\n",
  },
  {
    id: "R13b a leading definition then a gap",
    file: "[r]: http://x\n\n\n\na\n",
    reopens: "link_definition[] ∅ p(a)",
    needle: "a",
    saved: "[r]: http://x\n\n\n\na!\n",
  },
]);

rows("D194 R14 — guard: GFM footnotes are untouched by the definition node", [
  {
    id: "R14 footnote reference and definition round-trip",
    file: "Zed.\n\nClaim[^1]\n\n[^1]: The note.\n",
    reopens: "p(Zed.) p(Claim<footnote_reference>) footnote_definition[p(The note.)]",
    saved: "Zed.!\n\nClaim[^1]\n\n[^1]: The note.\n",
  },
]);
