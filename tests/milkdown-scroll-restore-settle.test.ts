/**
 * D22 WI-4 — `useMilkdownScrollRestore` keeps the restored anchor on the probe line for the
 * whole settle window, not just until the first image loads. Cases R-01 to R-06 of
 * `.claude/tdd-guardian/tests-20260927-112500.md`.
 *
 * Law (round trip): after the restore, while the user has not scrolled and within the
 * window, `captureMilkdownScrollAnchor(view, scroller)` gives back the pending block anchor
 * (same index and count, fraction within 1e-6) after every layout change plus trigger.
 *
 * Real: Milkdown (the WI-1 rig), the adapter, the settle pin, the logger. Boundaries: rig
 * geometry and `ResizeObserverDouble` (jsdom has neither layout nor ResizeObserver), fake
 * timers, and `@tauri-apps/api/core` (settle payloads are read off `invoke("log_event")`).
 * The paired real path is the manual GUI-D22-2.
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
import { captureMilkdownScrollAnchor } from "../src/utils/scrollAnchor/milkdown";
import { createLcg, DEFAULT_SEED } from "./helpers/headingCorpus";
import {
  installResizeObserverDouble,
  type ResizeObserverRegistry,
} from "./helpers/resizeObserverDouble";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { loadOn, settleLogs } from "./helpers/settlePinHarness";

type EditorReturn = ReturnType<typeof useEditor>;
const DOC = "doc-r";
/** G-06: blocks 1 and 2 are the image paragraphs; block 4 is "para b". */
const RIG_DOC =
  "# A\n\n![one](a.png)\n\n![two](b.png)\n\n## B\n\npara b\n\n## C\n\npara c\n\n## D\n\npara d\n";
const HEIGHTS = [80, 0, 0, 80, 80, 80, 80, 80, 2000];
const RIG_OPTIONS = { heights: HEIGHTS, margin: 20, rootTop: 90, viewHeight: 600 };
const ANCHOR: ScrollAnchor = {
  documentId: DOC,
  block: { blockIndex: 4, fraction: 0.5, blockCount: 9 },
  heading: null,
};
const FRAME_MS = 16;

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

/** Mount with real timers, then fake timers; run the hook and its two frames. */
async function restored(options: { ro?: boolean } = {}) {
  const r = await mountScriptedMilkdownRig(RIG_DOC, RIG_OPTIONS);
  rig = r;
  vi.useFakeTimers();
  const ro: ResizeObserverRegistry | null = options.ro ? installResizeObserverDouble() : null;
  setPendingScrollAnchor(ANCHOR);
  const editorReturn = { loading: false, get: () => r.editor } as unknown as EditorReturn;
  const hook = renderHook(({ id }: { id: string }) => useMilkdownScrollRestore(editorReturn, id), {
    initialProps: { id: DOC },
  });
  act(() => {
    vi.advanceTimersByTime(2 * FRAME_MS);
  });
  expect(r.scroller.scrollTop, "fixture guard: the restore landed block 4's middle on the probe").toBe(240);
  return { r, ro, hook };
}

const heldBlock = (r: MilkdownRig) => captureMilkdownScrollAnchor(r.view, r.scroller, DOC)?.block;

function expectHeld(r: MilkdownRig, message: string): void {
  expect(heldBlock(r), message).toEqual({
    blockIndex: 4,
    fraction: expect.closeTo(0.5, 6),
    blockCount: 9,
  });
}

const outcomes = () => settleLogs(invokeMock).map((p) => p.context.outcome);

describe("useMilkdownScrollRestore — re-pins through the settle window (WI-4)", () => {
  it("R-01 two images above the anchor load at different times, and the anchor holds", async () => {
    const { r } = await restored();
    r.growBlock(1, 300);
    loadOn(r.images(1)[0]);
    expectHeld(r, "after the first image");

    r.growBlock(2, 300);
    loadOn(r.images(2)[0]);
    expectHeld(r, "after the second image");
  });

  it("R-02 the ResizeObserver alone keeps the anchor, observing view.dom", async () => {
    const { r, ro } = await restored({ ro: true });
    expect(ro!.observed().has(r.view.dom)).toBe(true);
    r.growBlock(1, 300);
    ro!.fire();
    expectHeld(r, "after the first fire");
    r.growBlock(2, 300);
    ro!.fire();
    expectHeld(r, "after the second fire");
  });

  it("R-03 LAW: seeded growth above and below the anchor, mixed triggers", async () => {
    const { r, ro } = await restored({ ro: true });
    const rng = createLcg(DEFAULT_SEED);
    const blocks = [0, 1, 2, 3, 5, 6, 7, 8];
    for (let step = 0; step < 12; step++) {
      const k = blocks[rng() % blocks.length];
      const px = 1 + (rng() % 400);
      r.growBlock(k, px);
      const viaLoad = (k === 1 || k === 2) && rng() % 2 === 0;
      if (viaLoad) loadOn(r.images(k)[0]);
      else ro!.fire();
      expectHeld(r, `seed ${DEFAULT_SEED} step ${step}: grow ${k} by ${px} via ${viaLoad ? "load" : "fire"}`);
    }
  });

  it("R-04 a user scroll after the first re-pin ends the pin: no correction", async () => {
    const { r } = await restored();
    r.growBlock(1, 300);
    loadOn(r.images(1)[0]);
    expectHeld(r, "fixture guard: the first step held");

    act(() => {
      r.scroller.scrollTop = 100;
    });
    r.growBlock(2, 300);
    loadOn(r.images(2)[0]);
    act(() => {
      vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    });

    expect(r.scroller.scrollTop).toBe(100);
    const logs = settleLogs(invokeMock);
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "user-scroll", source: "restore" });
  });

  it("R-05 unmount mid-window tears everything down", async () => {
    const { r, ro, hook } = await restored({ ro: true });
    hook.unmount();

    r.growBlock(1, 300);
    ro!.fire();
    loadOn(r.images(1)[0]);
    act(() => {
      vi.advanceTimersByTime(10 * SCROLL_RESTORE_SETTLE_MS);
    });

    expect(ro!.observed().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.scroller.scrollTop).toBe(240);
    expect(outcomes()).toEqual(["disposed"]);
  });

  it("R-06 a document switch mid-window disposes the old document's pin", async () => {
    const { r, hook } = await restored();
    hook.rerender({ id: "other" });

    r.growBlock(1, 300);
    loadOn(r.images(1)[0]);

    expect(r.scroller.scrollTop).toBe(240);
    expect(vi.getTimerCount()).toBe(0);
    const logs = settleLogs(invokeMock); // review M-2: exactly one settle log, as disposed
    expect(logs).toHaveLength(1);
    expect(logs[0].context).toMatchObject({ outcome: "disposed", source: "restore" });
  });
});
