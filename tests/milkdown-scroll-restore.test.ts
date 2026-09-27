/**
 * @module milkdown-scroll-restore.test
 * Purpose: pin the lifecycle of `useMilkdownScrollRestore` (WI-8) — when the
 * WYSIWYG restore fires relative to Milkdown's `loading` flag and layout, the
 * settle re-pin window (D22), and cleanup. The geometry of the restore itself is
 * pinned in `scroll-anchor-correspondence.test.ts`, so the adapter is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: { logEventSync: vi.fn(), generateActionId: () => "id" },
}));

const restore = vi.fn();
let scroller: HTMLElement | null = null;
vi.mock("../src/utils/scrollAnchor/milkdown", () => ({
  resolveMilkdownScroller: () => scroller,
  restoreMilkdownScrollAnchor: (...args: unknown[]) => restore(...args),
}));

import { renderHook } from "@testing-library/react";
import type { useEditor } from "@milkdown/react";
import {
  SCROLL_RESTORE_SETTLE_MS,
  useMilkdownScrollRestore,
} from "../src/hooks/useMilkdownScrollRestore";
import { loggingService } from "../src/services/loggingService";
import {
  getPendingScrollAnchor,
  setPendingScrollAnchor,
  type ScrollAnchor,
} from "../src/utils/scrollAnchor/anchor";

type EditorReturn = ReturnType<typeof useEditor>;
const DOC = "doc-m";
const ANCHOR: ScrollAnchor = {
  documentId: DOC,
  block: { blockIndex: 3, fraction: 0.5, blockCount: 8 },
  heading: null,
};
const FRAME_MS = 16;
const fakeView = { dom: document.createElement("div") };

function fakeEditor(loading: boolean): EditorReturn {
  const instance = { action: (fn: (ctx: { get: () => unknown }) => unknown) => fn({ get: () => fakeView }) };
  return { loading, get: () => instance } as unknown as EditorReturn;
}

let clientHeight = 600;
let scrollTop = 0;

function makeScroller(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { get: () => clientHeight });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  el.getBoundingClientRect = () => ({ top: 0, bottom: 600 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function frames(n: number): void {
  for (let i = 0; i < n; i++) vi.advanceTimersByTime(FRAME_MS);
}

/** An `<img>` in the scroller whose top is `top` (the probe is at 40), then its `load`. */
function loadImageAt(top: number): void {
  const img = document.createElement("img");
  img.getBoundingClientRect = () => ({ top, bottom: top + 200 }) as DOMRect;
  scroller!.appendChild(img);
  img.dispatchEvent(new Event("load"));
}

beforeEach(() => {
  vi.useFakeTimers();
  restore.mockReset();
  vi.mocked(loggingService.logEventSync).mockReset();
  restore.mockImplementation(() => {
    scrollTop = 500;
    return true;
  });
  clientHeight = 600;
  scrollTop = 0;
  scroller = makeScroller();
  setPendingScrollAnchor(ANCHOR);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useMilkdownScrollRestore", () => {
  it("does nothing while Milkdown is loading, and leaves the slot for later", () => {
    renderHook(() => useMilkdownScrollRestore(fakeEditor(true), DOC));
    frames(5);
    expect(restore).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toEqual(ANCHOR);
  });

  it("consumes the slot once loaded and applies after two frames, not before", () => {
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    expect(getPendingScrollAnchor()).toBeNull();
    frames(1);
    expect(restore).not.toHaveBeenCalled();
    frames(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(fakeView, scroller, ANCHOR);
  });

  it("another document's anchor is discarded, never applied", () => {
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), "other-doc"));
    frames(5);
    expect(restore).not.toHaveBeenCalled();
    expect(getPendingScrollAnchor()).toBeNull();
  });

  it("waits for layout: no apply while the scroller has zero height", () => {
    clientHeight = 0;
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(4);
    expect(restore).not.toHaveBeenCalled();
    clientHeight = 600;
    frames(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of frames without layout", () => {
    clientHeight = 0;
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(200);
    clientHeight = 600;
    frames(5);
    expect(restore).not.toHaveBeenCalled();
  });

  it("re-applies through the settle window: one final re-pin at the deadline, then nothing", () => {
    // Assertion moved from call counts on the mocked restore to scrollTop (review T-1, CT-1).
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    expect(scrollTop).toBe(500);
    shift = 300;
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    expect(scrollTop).toBe(800);
    shift = 600;
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS * 4);
    expect(scrollTop).toBe(800);
  });

  it("skips the re-apply when the user has scrolled since", () => {
    // Assertion moved from call counts on the mocked restore to scrollTop (review T-1).
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    scrollTop = 120;
    shift = 300;
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    expect(scrollTop).toBe(120);
  });

  it("an image finishing loading above the probe re-applies immediately, and again at the deadline", () => {
    // Assertion moved from call counts on the mocked restore to scrollTop (review T-1).
    // D22 (plan WI-0 point 3): the one-shot settle let the first load end the window, so later
    // growth was left uncorrected; the restore now re-pins through it, ending with a final re-pin.
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    shift = 300;
    loadImageAt(-300);
    expect(scrollTop).toBe(800);
    shift = 600;
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    expect(scrollTop).toBe(1100);
  });

  it("two loads above the probe are each re-applied (D22 M-02)", () => {
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    shift = 300;
    loadImageAt(-300);
    shift = 600;
    loadImageAt(-200);
    expect(scrollTop).toBe(1100);
    expect(restore).toHaveBeenCalledTimes(3);
  });

  it("the below-the-probe filter applies to every load, not only the first (D22 M-03)", () => {
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    shift = 300;
    loadImageAt(300);
    expect(scrollTop).toBe(500);
    shift = 600;
    loadImageAt(-300);
    expect(scrollTop).toBe(1100);
  });

  it("an image loading BELOW the probe does not trigger a re-apply", () => {
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    const img = document.createElement("img");
    img.getBoundingClientRect = () => ({ top: 300, bottom: 500 }) as DOMRect;
    scroller!.appendChild(img);
    img.dispatchEvent(new Event("load"));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("unmounting before the frames elapse cancels the restore", () => {
    const { unmount } = renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    unmount();
    frames(5);
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    expect(restore).not.toHaveBeenCalled();
  });

  it("a restore that finds no position schedules no re-apply", () => {
    restore.mockReturnValue(false);
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    frames(2);
    vi.advanceTimersByTime(SCROLL_RESTORE_SETTLE_MS);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("a throwing logger cannot stop the restore landing or the pin arming (review C-4)", () => {
    vi.mocked(loggingService.logEventSync).mockImplementation(() => {
      throw new Error("logger down");
    });
    let shift = 0;
    restore.mockImplementation(() => {
      scrollTop = 500 + shift;
      return true;
    });
    renderHook(() => useMilkdownScrollRestore(fakeEditor(false), DOC));
    expect(() => frames(2)).not.toThrow();
    expect(scrollTop).toBe(500);
    shift = 300;
    loadImageAt(-300);
    expect(scrollTop).toBe(800);
  });
});
