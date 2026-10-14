/**
 * D188 / ADR-0091 — the properties of decision 5 that are not already row assertions, and
 * the lifecycle rows. Matrix: ~/.mdpro-redesign/handoff/d188-roundtrip-matrix-adr0091.md
 * sections F and G.
 *
 * - F1, structure on reopen, is the "reopen" half of every A/C row
 *   (tests/d188-empty-paragraph-write.test.tsx) and the open half of every B/D/E row
 *   (tests/d188-empty-paragraph-read.test.tsx).
 * - F2: serialize → remount → serialize is idempotent for every "saved" byte string, so the
 *   writer's output is a fixed point of reader + writer.
 * - F3: an untouched open → ⌘S: the store holds the decoded, LF-normalised original, the
 *   document stays clean, and the `save_file` ARGS (content, path, lineEnding) carry the
 *   original. Tauri IPC is mocked, so this proves the args, NOT the bytes on disk; Rust
 *   restores CRLF and the BOM from `lineEnding` / `encoding` after the IPC
 *   (commands/file.rs:237–243, 266–294), which needs its own check there.
 * - G: the gap survives mode switch, tab switch, undo/redo, the timer write, the heading-id
 *   transaction and an external replace, each re-checked with A2 and E1.
 *
 * Real `MilkdownEditor` through tests/support/d188EmptyParagraphRig; every reopen is a real
 * unmount → remount. Mocked: `@tauri-apps/api/{core,event,window}` and `loggingService` only.
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

import { redo, undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EDIT_SYNC_DELAY_MS } from "../src/plugins/milkdown/editSync/controller";
import { useDocumentStore } from "../src/stores/documentStore";
import { prepareWholesaleReplace } from "../src/utils/wholesaleReplace";
import { A_PATH, createHeldInvoke } from "./helpers/heldInvoke";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { makeDoc, sleep, viewOf } from "./helpers/milkdownEditorHarness";
import { createRig, type Rig } from "./support/d188EmptyParagraphRig";

const A2 = "a\n\n\n\nb\n";
const E1 = "a\n\n<br />\n\nb\n";

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

/** Every "saved" byte string of sections A–E. */
const SAVED = [
  "a\n\nb\n",
  "a\n\n\n\nb\n",
  `a${"\n".repeat(6)}b\n`,
  `a${"\n".repeat(8)}b\n`,
  "a\n",
  "a\n\n\n\n## T\n",
  "> a\n>\n>\n>\n> b\n",
  "> a\n\nz\n",
  "* a\n\n\n\n  b\n",
  "* a\n\nc\n",
  "* a\n\n\n\nc\n",
  "```\nx\n\n\n\ny\n```\n",
  "```\nx\n```\n\n\n\nb\n",
  "<div>\n\n\n\n</div>\n",
  "| h |\n| - |\n|   |\n",
  "a\\\nb\n",
  "first<br />second\n",
  "* item<br/>more\n",
  "| a      |\n| ------ |\n| x<br>y |\n",
  'a\n\n<br class="x" />\n\nb\n',
];

/** Every file input of sections A–E (untouched open → save must keep each exactly). */
const FILES = [
  ...SAVED,
  // Not in SAVED: a tight list read from a file re-serializes loose on 7.18.0 (the parser
  // sets list_item `spread: "false"`, a truthy string). Pre-existing, outside D188.
  "* a\n* c\n",
  "a\n\n\nb\n",
  "a\n\n\n\n\nb\n",
  "a\n  \n\t\n \nb\n",
  "a\n\n\n\nb",
  "[r]: http://x\n\n\n\na\n",
  "a\n\n[r]: http://x\n\n\n\nb\n",
  "a  \nb\n",
  "a<br>b\n",
  "- item<br/>more\n",
  "| a |\n| - |\n| x<br>y |\n",
  E1,
  "a\n\n<br />\n\n<br />\n\nb\n",
  "a\n\n<br />\n",
  "> a\n>\n> <br />\n>\n> b\n",
  "a\n\n<BR />\n\nb\n",
  "a<BR>c\n\nb\n",
  "* a\n\n\n\n* b\n",
  "a\n\n<br /><br />\n\nb\n",
  "# T\n\n<br />\n\nb\n",
  "# T\n\n\n\nb\n",
];

describe("D188 F2 — serialize → remount → serialize is idempotent", () => {
  for (const bytes of SAVED) {
    it(`F2 ${JSON.stringify(bytes)}`, async () => {
      await rig.open(bytes);
      const first = rig.serialize();
      expect(first, "the writer does not reproduce its own saved bytes").toBe(bytes);
      await rig.reopen(first);
      expect(rig.serialize(), "second serialize after a remount differs").toBe(first);
    });
  }
});

describe("D188 F3 — untouched open → save: store text, clean state, save_file args", () => {
  for (const bytes of FILES) {
    it(`F3 save_file args keep ${JSON.stringify(bytes)}`, async () => {
      await rig.open(bytes);
      await rig.settle();
      expect(rig.doc().content, "opening rewrote the store text").toBe(bytes);
      expect(rig.doc().isModified, "opening dirtied the document").toBe(false);
      const args = await rig.save();
      expect(args.content, "save_file args content").toBe(bytes);
      expect(args.path).toBe(A_PATH);
      expect(args.lineEnding).toBe("lf");
    });
  }

  it("F3-crlf a CRLF file: LF store text, save_file args carry lineEnding crlf", async () => {
    await rig.open(A2, { lineEnding: "crlf" });
    await rig.settle();
    expect(rig.doc().isModified).toBe(false);
    const args = await rig.save();
    expect(args.content).toBe(A2);
    expect(args.lineEnding).toBe("crlf");
  });
});

/** Put the caret at the end of the first textblock whose text is `text`. */
function caretAtEndOf(text: string): void {
  const view = viewOf(rig.editor());
  let pos = -1;
  view.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + n.nodeSize - 1;
    return pos < 0;
  });
  act(() => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  });
}

function pressEnter(): void {
  const view = viewOf(rig.editor());
  act(() => {
    view.someProp("handleKeyDown", (f) =>
      f(view, new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
  });
}

function history(cmd: typeof undo): void {
  const view = viewOf(rig.editor());
  act(() => {
    cmd(view.state, view.dispatch);
  });
}

describe("D188 G — lifecycle", () => {
  it("G0 the Enter key in an empty line's place writes blank lines (the user gesture)", async () => {
    await rig.open("a\n\nb\n");
    caretAtEndOf("a");
    pressEnter();
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
    await rig.settle();
    expect(rig.doc().content).toBe(A2);
  });

  it("G1 timer write: nothing before the debounce, blank lines after it", async () => {
    await rig.open("a\n\nb\n");
    rig.insertEmptyAfter("a");
    expect(rig.doc().content, "written before the debounce").toBe("a\n\nb\n");
    expect(rig.doc().isModified).toBe(true);
    await sleep(EDIT_SYNC_DELAY_MS + 100);
    expect(rig.doc().content).toBe(A2);
  });

  it("G2 mode switch (WYSIWYG unmount → store → remount) keeps A2", async () => {
    await rig.open("a\n\nb\n");
    rig.insertEmptyAfter("a");
    await rig.close(); // WYSIWYG → Source: the editor's destroy flushes the edit
    expect(rig.doc().content, "the text Source mode would show").toBe(A2);
    await rig.remountFromStore(); // Source → WYSIWYG
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
  });

  it("G2-E1 mode switch after editing a legacy file writes blank lines, no <br />", async () => {
    await rig.open(E1);
    rig.typeAtEndOf("b", "!");
    await rig.close();
    expect(rig.doc().content).toBe("a\n\n\n\nb!\n");
    await rig.remountFromStore();
    expect(rig.shape()).toBe("p(a) ∅ p(b!)");
  });

  it("G3 tab switch away and back keeps A2", async () => {
    const first = await rig.open("a\n\nb\n", { extraDocs: [makeDoc("doc-b", "Other")] });
    rig.insertEmptyAfter("a");
    rig.activate("doc-b");
    const other = await rig.adoptCurrent(first);
    expect(rig.doc().content, "the switch did not write doc-a's edit").toBe(A2);
    rig.activate("doc-a");
    await rig.adoptCurrent(other);
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
  });

  it("G3-E1 tab switch after opening a legacy file untouched keeps its bytes and its gap", async () => {
    const first = await rig.open(E1, { extraDocs: [makeDoc("doc-b", "Other")] });
    rig.activate("doc-b");
    const other = await rig.adoptCurrent(first);
    expect(rig.doc().content).toBe(E1);
    expect(rig.doc().isModified).toBe(false);
    rig.activate("doc-a");
    await rig.adoptCurrent(other);
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
  });

  it("G4 undo / redo across an inserted empty paragraph", async () => {
    await rig.open("a\n\nb\n");
    rig.insertEmptyAfter("a");
    await rig.settle();
    expect(rig.doc().content).toBe(A2);
    history(undo);
    await rig.settle();
    expect(rig.shape()).toBe("p(a) p(b)");
    expect(rig.doc().content).toBe("a\n\nb\n");
    history(redo);
    await rig.settle();
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
    expect(rig.doc().content).toBe(A2);
  });

  it("G4-E1 undo of an edit to a legacy file leaves the gap, written as blank lines", async () => {
    await rig.open(E1);
    rig.typeAtEndOf("b", "!");
    await rig.settle();
    history(undo);
    await rig.settle();
    expect(rig.shape()).toBe("p(a) ∅ p(b)");
    expect(rig.doc().content).toBe(A2);
  });

  it("G5 heading-id transaction: a heading file with a legacy empty opens clean", async () => {
    await rig.open("# T\n\n<br />\n\nb\n");
    await rig.settle();
    expect(rig.shape()).toBe("h1(T) ∅ p(b)");
    expect(rig.doc().isModified).toBe(false);
    expect(rig.doc().content).toBe("# T\n\n<br />\n\nb\n");
  });

  it("G5b heading-id transaction: a heading file with a blank-line gap opens clean with the gap", async () => {
    await rig.open("# T\n\n\n\nb\n");
    await rig.settle();
    expect(rig.doc().isModified, "the heading-id sync dirtied the document").toBe(false);
    expect(rig.doc().content).toBe("# T\n\n\n\nb\n");
    expect(rig.shape()).toBe("h1(T) ∅ p(b)");
    rig.typeAtEndOf("b", "!");
    await rig.settle();
    expect(rig.doc().content).toBe("# T\n\n\n\nb!\n");
  });

  for (const [id, bytes] of [
    ["G6", A2],
    ["G6-E1", E1],
  ] as const) {
    it(`${id} external replace while open rebuilds with the gap and stays clean`, async () => {
      const first = await rig.open("a\n\nb\n");
      act(() => {
        prepareWholesaleReplace("doc-a", "file-reload");
        useDocumentStore.setState((st) => ({
          documents: st.documents.map((d) =>
            d.id === "doc-a" ? { ...d, content: bytes, isModified: false } : d,
          ),
        }));
      });
      await rig.adoptCurrent(first);
      expect(rig.shape()).toBe("p(a) ∅ p(b)");
      await rig.settle();
      expect(rig.doc().isModified, "the rebuilt editor dirtied the document").toBe(false);
      expect(rig.doc().content).toBe(bytes);
    });
  }
});
