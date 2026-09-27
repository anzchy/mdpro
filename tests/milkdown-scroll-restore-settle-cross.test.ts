/**
 * D22 WI-4 — the restore's settle pin against its neighbours: an outline click taking over
 * the scroller, a restore that finds no position, and the one settle log per window.
 * Cases R-07 to R-09 of `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Real: Milkdown (the WI-1 rig), the restore hook, `scrollHeadingToAnchor`, the settle pin,
 * the logger. Boundaries: rig geometry, `ResizeObserverDouble`, fake timers, and
 * `@tauri-apps/api/core` (log payloads are read off `invoke("log_event")`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null as unknown),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { act, renderHook } from "@testing-library/react";
import type { useEditor } from "@milkdown/react";
import {
  SCROLL_RESTORE_SETTLE_MS,
  useMilkdownScrollRestore,
} from "../src/hooks/useMilkdownScrollRestore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { setPendingScrollAnchor, type ScrollAnchor } from "../src/utils/scrollAnchor/anchor";
import {
  captureMilkdownScrollAnchor,
  scrollHeadingToAnchor,
} from "../src/utils/scrollAnchor/milkdown";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { loadOn, settleLogs } from "./helpers/settlePinHarness";

type EditorReturn = ReturnType<typeof useEditor>;
const DOC = "doc-x";
/** G-06: blocks 1 and 2 are the image paragraphs; block 7 is "## D". */
const RIG_DOC =
  "# A\n\n![one](a.png)\n\n![two](b.png)\n\n## B\n\npara b\n\n## C\n\npara c\n\n## D\n\npara d\n";
const HEIGHTS = [80, 0, 0, 80, 80, 80, 80, 80, 2000];
const HEADING_D = 7;
const ROOT_TOP = 90;
const ANCHOR: ScrollAnchor = {
  documentId: DOC,
  block: { blockIndex: 4, fraction: 0.5, blockCount: 9 },
  heading: null,
};
const FRAME_MS = 16;
const RESTORE_EVENT = "editor.scroll_anchor.restore";

let rig: MilkdownRig | null = null;

beforeEach(() => {
  invokeMock.mockClear();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

afterEach(async () => {
  vi.useRealTimers();
  await rig?.destroy();
  rig = null;
  document.body.innerHTML = "";
});

async function restoreWith(anchor: ScrollAnchor, withRo: boolean) {
  const container = document.body.appendChild(document.createElement("div"));
  const r = await mountScriptedMilkdownRig(RIG_DOC, {
    heights: HEIGHTS,
    margin: 20,
    rootTop: ROOT_TOP,
    viewHeight: 600,
    container,
  });
  rig = r;
  vi.useFakeTimers();
  const ro: ResizeObserverRegistry | null = withRo ? installResizeObserverDouble() : null;
  setPendingScrollAnchor(anchor);
  const editorReturn = { loading: false, get: () => r.editor } as unknown as EditorReturn;
  renderHook(() => useMilkdownScrollRestore(editorReturn, DOC));
  act(() => {
    vi.advanceTimersByTime(2 * FRAME_MS);
  });
  return { r, ro, container };
}

interface Payload {
  event: string;
  status: string;
  context: Record<string, unknown>;
}

const restoreLogs = (): Payload[] =>
  invokeMock.mock.calls
    .filter(([cmd]) => cmd === "log_event")
    .map(([, args]) => (args as { payload: Payload }).payload)
    .filter((p) => p.event === RESTORE_EVENT);

describe("useMilkdownScrollRestore settle pin — neighbours (WI-4)", () => {
  it("R-07 an outline click during the restore window takes over the scroller", async () => {
    const { r, ro, container } = await restoreWith(ANCHOR, true);
    expect(r.scroller.scrollTop, "fixture guard: restored").toBe(240);

    expect(scrollHeadingToAnchor(container, r.blockElement(HEADING_D))).toBe(true);
    r.growBlock(1, 300);
    ro!.fire();

    expect(r.blockElement(HEADING_D).getBoundingClientRect().top - ROOT_TOP).toBe(40);
    expect(captureMilkdownScrollAnchor(r.view, r.scroller, DOC)?.block).not.toEqual(ANCHOR.block);

    const logs = settleLogs(invokeMock);
    expect(logs, "one restore log; the toc pin is still live").toHaveLength(1);
    expect(logs[0].context.source).toBe("restore");
    expect(["user-scroll", "replaced"]).toContain(logs[0].context.outcome);
  });

  it("R-08 a restore that finds no position arms no pin", async () => {
    const noPosition: ScrollAnchor = {
      documentId: DOC,
      block: { blockIndex: 4, fraction: 0.5, blockCount: 7 },
      heading: { headingOrdinal: 0, fraction: 0, headingCount: 9 },
    };
    const { r, ro } = await restoreWith(noPosition, true);

    expect(r.scroller.scrollTop).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ro!.constructCount()).toBe(0);
    expect(settleLogs(invokeMock)).toEqual([]);
    expect(restoreLogs().map((p) => p.status)).toEqual(["cancel"]);
  });

  it("R-09 one settle log per restore window, source restore, with exact counts", async () => {
    const { r } = await restoreWith(ANCHOR, false);
    r.growBlock(1, 300);
    loadOn(r.images(1)[0]);
    r.growBlock(2, 300);
    loadOn(r.images(2)[0]);
    act(() => {
      vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    });

    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toEqual({
      surface: "wysiwyg",
      source: "restore",
      outcome: "expired",
      repins: 3,
      triggers: 2,
    });
    expect(logs[0].context).not.toHaveProperty("documentId");

    const restores = restoreLogs();
    expect(restores).toHaveLength(1);
    expect(restores[0].status).toBe("success");
    expect(restores[0].context).toEqual({ surface: "wysiwyg", documentId: DOC, frames: 2 });
  });
});
