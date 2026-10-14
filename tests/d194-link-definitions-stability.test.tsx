/**
 * D194 / ADR-0094 — properties of the `link_definition` node beyond the round-trip rows
 * (tests/d194-link-definitions-roundtrip.test.tsx, R1–R14). Matrix ids S1–S5.
 *
 * - S1: an untouched open → ⌘S keeps a mixed file byte-for-byte: the store holds the file,
 *   the document stays clean, and the `save_file` args carry the file. A guard: it holds
 *   before the fix too (edit-sync baseline), and the new node must not break it.
 * - S2: after one edit, serialize → remount → serialize is idempotent AND keeps every
 *   definition (a writer that drops them is idempotent too, so the first serialize is pinned).
 * - S3: display (i): every definition renders as a block element carrying
 *   `data-type="link-definition"` and `contenteditable="false"`, whose textContent is its raw
 *   source text.
 * - S4: a definition selected as a NodeSelection and deleted is gone from the saved text,
 *   and nothing else changes.
 * - S5: the app's history plugin undoes that deletion.
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

import { A_PATH, createHeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { createRig, type Rig } from "./support/d188EmptyParagraphRig";
import {
  DEFINITION_SELECTOR,
  definitionElements,
  definitions,
  deleteDefinition,
  undoOnce,
} from "./support/d194LinkDefinitionRig";

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

/** Paragraphs, a used and an unused definition, consecutive definitions, one in a quote. */
const MIXED = [
  "Zed.",
  "",
  "See [docs][r] and [more][R].",
  "",
  '[r]: http://x "T"',
  "[unused]: http://u",
  "",
  "> Quoted [q].",
  ">",
  "> [q]: http://q",
  "",
  "After.",
  "",
].join("\n");

/** MIXED after `!` is typed at the end of `Zed.`: references inlined, definitions kept. */
const MIXED_EDITED = [
  "Zed.!",
  "",
  'See [docs](http://x "T") and [more](http://x "T").',
  "",
  '[r]: http://x "T"',
  "[unused]: http://u",
  "",
  "> Quoted [q](http://q).",
  ">",
  "> [q]: http://q",
  "",
  "After.",
  "",
].join("\n");

const MIXED_RAWS = ['[r]: http://x "T"', "[unused]: http://u", "[q]: http://q"];

const SIMPLE = "Zed.\n\nSee [docs][r].\n\n[r]: http://x\n\nAfter.\n";

describe("D194 S1 — untouched open → save keeps the bytes", () => {
  it("S1 store text, clean state and save_file args equal the file", async () => {
    await rig.open(MIXED);
    await rig.settle();
    expect(rig.doc().content, "opening rewrote the store text").toBe(MIXED);
    expect(rig.doc().isModified, "opening dirtied the document").toBe(false);
    const args = await rig.save();
    expect(args.content, "save_file args content").toBe(MIXED);
    expect(args.path).toBe(A_PATH);
    expect(args.lineEnding).toBe("lf");
  });
});

describe("D194 S2 — serialize → remount → serialize after an edit", () => {
  it("S2 the first serialize keeps every definition, and a remount reproduces it", async () => {
    await rig.open(MIXED);
    rig.typeAtEndOf("Zed.", "!");
    await rig.settle();
    const first = rig.serialize();
    expect(first, "the edited serialize lost or changed a definition").toBe(MIXED_EDITED);
    await rig.reopen(first);
    expect(rig.serialize(), "second serialize after a remount differs").toBe(first);
  });
});

describe("D194 S3 — display (i): a muted, non-editable block showing the raw text", () => {
  it(`S3 one ${DEFINITION_SELECTOR} block per definition, contenteditable=false, text = raw`, async () => {
    await rig.open(MIXED);
    const els = definitionElements(rig);
    expect(
      els.map((el) => el.textContent),
      "rendered definition blocks",
    ).toEqual(MIXED_RAWS);
    for (const el of els) {
      expect(el.getAttribute("contenteditable"), `contenteditable of ${el.textContent}`).toBe("false");
    }
    expect(
      els.map((el) => el.closest("blockquote") !== null),
      "only the quoted definition renders inside the blockquote",
    ).toEqual([false, false, true]);
  });
});

describe("D194 S4/S5 — delete a definition as a node, then undo", () => {
  it("S4 a NodeSelection delete removes the definition from the saved text, nothing else", async () => {
    await rig.open(SIMPLE);
    expect(definitions(rig), "the file's definition is not a link_definition node").toHaveLength(1);
    deleteDefinition(rig, 0);
    await rig.settle();
    expect(definitions(rig)).toHaveLength(0);
    expect(rig.doc().isModified, "the deletion did not dirty the document").toBe(true);
    const expected = "Zed.\n\nSee [docs](http://x).\n\nAfter.\n";
    expect(rig.doc().content, "bytes edit-sync wrote to documentStore").toBe(expected);
    expect((await rig.save()).content, "bytes ⌘S passed to save_file").toBe(expected);
  });

  it("S5 undo of the deletion restores the definition in the saved text", async () => {
    await rig.open(SIMPLE);
    rig.typeAtEndOf("Zed.", "!");
    expect(definitions(rig), "the file's definition is not a link_definition node").toHaveLength(1);
    deleteDefinition(rig, 0);
    await rig.settle();
    expect(rig.doc().content).toBe("Zed.!\n\nSee [docs](http://x).\n\nAfter.\n");
    undoOnce(rig);
    await rig.settle();
    expect(definitions(rig).map((d) => d.attrs.raw)).toEqual(["[r]: http://x"]);
    const expected = "Zed.!\n\nSee [docs](http://x).\n\n[r]: http://x\n\nAfter.\n";
    expect(rig.doc().content, "bytes edit-sync wrote to documentStore").toBe(expected);
    expect((await rig.save()).content, "bytes ⌘S passed to save_file").toBe(expected);
  });
});
