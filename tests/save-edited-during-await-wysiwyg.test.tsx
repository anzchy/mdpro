/**
 * D19 WI-1: a save overwrites a WYSIWYG edit made while it is awaiting, through the real
 * editor.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-232521-d19.md` (Revision 3), cases
 * R-wysiwyg-timer and R-wysiwyg-pending (F4, F5). The cases pin the edit-sync controller's
 * two timing windows. Each asserts, just before release, that it really is in the window
 * it claims (gap 4). WI-4 must turn this file green without editing it.
 *
 * R-wysiwyg-timer also settles the D19 row's mitigation claim. Checkpoint A (soft) reads
 * right after the save returns. Checkpoint B reads after a `tab-close` flush with no
 * further keystroke: if B fails before the fix, the controller does not rescue an edit its
 * timer already wrote (`controller.ts` `write()` returns early on `revision <= lastWritten`).
 *
 * Real `MilkdownEditor`, stores and `useDocument`. Mocked: `@tauri-apps/api/{core,event,
 * window}` and `loggingService`.
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

import type { Editor } from "@milkdown/kit/core";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocument } from "../src/hooks/useDocument";
import { EDIT_SYNC_DELAY_MS } from "../src/plugins/milkdown/editSync/controller";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import { docById, makeDoc, mountAndWait, resetStores, sleep, typeAtEnd } from "./helpers/milkdownEditorHarness";
import { A_PATH, SAVED_AT, createHeldInvoke, type HeldInvoke } from "./helpers/heldInvoke";

const TIMER_WRITE_MARGIN_MS = 100;
const UNMOUNT_SETTLE_MS = 100;
type Api = ReturnType<typeof useDocument>;

let api: Api | null = null;
function Probe() {
  api = useDocument();
  return null;
}

let held: HeldInvoke;
let unmount: (() => void) | null = null;
const docA = () => docById("doc-a")!;
const draftsForA = () => held.calls("delete_draft").filter((a) => a.documentId === "doc-a");
const ok = { success: true, path: A_PATH, savedAt: SAVED_AT };

async function mountAndStartSave(): Promise<{ instance: Editor; p: Promise<unknown> }> {
  const mounted = await mountAndWait(
    <>
      <MilkdownEditor />
      <Probe />
    </>,
  );
  unmount = mounted.unmount;
  expect(api, "useDocument probe never rendered").not.toBeNull();
  let p!: Promise<unknown>;
  await act(async () => {
    p = api!.saveActiveDocument();
    await held.whenCalled("save_file");
  });
  return { instance: mounted.instance, p };
}

async function release(p: Promise<unknown>): Promise<void> {
  await act(async () => {
    held.release("save_file", ok);
    await p;
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  api = null;
  unmount = null;
  installIntersectionObserverDouble();
  invokeMock.mockReset();
  held = createHeldInvoke(invokeMock);
  held.hold("save_file");
  vi.mocked(isTauri).mockReturnValue(true);
  resetStores([makeDoc("doc-a", "Hello world", A_PATH), makeDoc("doc-b", "Other")]);
});

afterEach(async () => {
  held.assertDrained();
  if (unmount) {
    unmount();
    await sleep(UNMOUNT_SETTLE_MS);
  }
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("D19 red — WYSIWYG edit during the save's await (L-H1, L-H2)", () => {
  it("R-wysiwyg-timer: an edit the 200 ms timer already wrote survives the save", async () => {
    const { instance, p } = await mountAndStartSave();
    act(() => typeAtEnd(instance, "LATE"));
    await sleep(EDIT_SYNC_DELAY_MS + TIMER_WRITE_MARGIN_MS);
    // Gap-4 precondition: the timer really wrote before the save returned.
    expect(docA().content, "PRECONDITION: timer wrote LATE before release").toContain("LATE");
    await release(p);
    // Checkpoint A: straight after the save returns.
    expect.soft(docA().content, "checkpoint A: content").toContain("LATE");
    expect.soft(docA().isModified, "checkpoint A: dirty").toBe(true);
    // Checkpoint B: a later flush with no further keystroke (the D19 row's mitigation).
    act(() => { useMilkdownEditorStore.getState().flushPendingEdits("tab-close"); });
    expect(docA().content, "checkpoint B: content").toContain("LATE");
    expect(docA().isModified, "checkpoint B: dirty").toBe(true);
    expect(draftsForA()).toEqual([]);
  });

  it("R-wysiwyg-pending: an edit still in the timer when the save returns survives it", async () => {
    const { instance, p } = await mountAndStartSave();
    act(() => typeAtEnd(instance, "LATE"));
    // Gap-4 precondition: the edit has not reached the store yet (content, not dirty).
    expect(docA().content, "PRECONDITION: LATE still pending in the timer").not.toContain("LATE");
    await release(p);
    expect(docA().content).toContain("LATE");
    expect(docA().isModified).toBe(true);
    expect(draftsForA()).toEqual([]);
  });
});
