/**
 * D203 control — WYSIWYG: the same steps as the Source rows must not carry text across a
 * tab switch either. MilkdownEditor rebuilds its editor (and so its history) on a document
 * switch; these rows pin that, so a later change to the switch path cannot open the Source
 * hole here.
 *
 * Real `MilkdownEditor` through tests/support/d188EmptyParagraphRig; undo / redo are the
 * app's history commands on the live view. Mocked: `@tauri-apps/api/{core,event,window}`
 * and `loggingService` only.
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
import { act } from "@testing-library/react";
import { redo, undo } from "@milkdown/kit/prose/history";
import type { Editor } from "@milkdown/kit/core";
import { makeDoc, viewOf } from "./helpers/milkdownEditorHarness";

const SMALL = "# small98\n\nshort body.\n";
const BIG = `# big98\n\n${"a long line of the big document\n".repeat(50)}`;

const content = (id: string) => rig.doc(id).content;

function history(ed: Editor, cmd: typeof undo): void {
  const view = viewOf(ed);
  act(() => {
    cmd(view.state, view.dispatch);
  });
}

async function switchTo(id: string, prev: Editor): Promise<Editor> {
  rig.activate(id);
  return rig.adoptCurrent(prev);
}

describe("D203 control — WYSIWYG undo and redo never carry text across a tab switch", () => {
  it("W1 small98 → big98, ⌘Z then ⌘⇧Z leave both documents whole", async () => {
    const first = await rig.open(SMALL, { extraDocs: [makeDoc("big", BIG, "/tmp/big98.md")] });
    const ed = await switchTo("big", first);
    for (const cmd of [undo, redo]) {
      history(ed, cmd);
      await rig.settle();
      expect(content("doc-a")).toBe(SMALL);
      expect(content("big")).toBe(BIG);
      expect(rig.doc("big").isModified).toBe(false);
    }
  });

  it("W2 an edit in small98, a switch, then ⌘Z ×3 never reaches small98's text", async () => {
    const first = await rig.open(SMALL, { extraDocs: [makeDoc("big", BIG, "/tmp/big98.md")] });
    rig.typeAtEndOf("short body.", "X");
    await rig.settle();
    const ed = await switchTo("big", first);
    for (let i = 0; i < 3; i += 1) {
      history(ed, undo);
      await rig.settle();
      expect(content("doc-a")).toBe("# small98\n\nshort body.X\n");
      expect(content("big")).toBe(BIG);
    }
  });
});
