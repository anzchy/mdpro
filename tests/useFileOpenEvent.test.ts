/**
 * D279-WI-4 — `useFileOpenEvent`, the window-scoped `file:open` listener moved
 * out of App.tsx (ruling R5). Matrix: `.claude/tdd-guardian/tests-20261018-100701.md`,
 * cases HK-1..HK-7, HK-L10, HK-L11.
 *
 * Before D279, App subscribed with the GLOBAL `listen` of
 * `@tauri-apps/api/event` (an `Any` listener that hears every window's emits)
 * and then asked `isFocused()`, failing open (`catch → true`). Rust now sends
 * `file:open` to exactly one window, so the hook must listen on
 * `getCurrentWindow()` and ask no focus question.
 *
 * Laws:
 *   L10 (S5, subscription conservation) — once every pending `listen()` has
 *     settled, `bus.count("file:open") === (mounted ? 1 : 0)`, across mount,
 *     re-render with new deps and unmount in any order relative to resolution.
 *   L11 (S4, per-event latch) — an event with `k` successful opens switches the
 *     view mode `min(1, k)` times, to the CURRENT `defaultViewMode`.
 *
 * Mock boundary: ONLY `@tauri-apps/api/window`, through the shared label-routed
 * bus in `tests/support/menuEventsHarness.ts` (its `win` has no `isFocused`).
 * `@tauri-apps/api/event` is deliberately NOT mocked: a regression to the
 * global `listen` reaches the real module, which rejects in jsdom (no
 * `__TAURI_INTERNALS__`), so nothing is delivered and HK-1 fails.
 * `openPaths` and `setViewMode` are the hook's injected parameters: `openPaths`
 * is a fake standing in for the D95/D51 open pipeline, and the real
 * `onFirstSuccess` latch runs inside the hook.
 *
 * Paired integration test: device D279-a (a second-launch open lands in the
 * real `main` webview while another app is frontmost).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => (await import("./support/menuEventsHarness")).windowModuleMock());

import { getCurrentWindow } from "@tauri-apps/api/window";
import { bus, win } from "./support/menuEventsHarness";
import { useFileOpenEvent } from "../src/hooks/useFileOpenEvent";
import type { ViewMode } from "../src/types/editor";
import { collectionCases } from "./support/collectionCases";

const EVT = "file:open";

let opened: string[][];
let viewModeCalls: ViewMode[];
/** How many files of the next event "open and activate" in the fake pipeline. */
let successes: number;

const openPaths = (paths: string[], onOpened?: () => void): Promise<void> => {
  opened.push(paths);
  for (let i = 0; i < successes; i++) onOpened?.();
  return Promise.resolve();
};
const setViewMode = (mode: ViewMode): void => {
  viewModeCalls.push(mode);
};

type Props = { defaultViewMode: ViewMode };

function mount(defaultViewMode: ViewMode = "wysiwyg") {
  return renderHook((props: Props) => useFileOpenEvent({ defaultViewMode: props.defaultViewMode, openPaths, setViewMode }), {
    initialProps: { defaultViewMode },
  });
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
};

const emitToMain = async (payload: unknown) => {
  await act(async () => {
    bus.emitTo("main", EVT, payload);
  });
  await flush();
};

beforeEach(() => {
  bus.reset();
  win.reset();
  opened = [];
  viewModeCalls = [];
  successes = 1;
});

describe("useFileOpenEvent — delivery (D279)", () => {
  it("HK-1: an event addressed to this window opens its paths and switches once", async () => {
    const h = mount("wysiwyg");
    await flush();
    await emitToMain(["/a.md", "/b.md"]);

    expect(opened).toEqual([["/a.md", "/b.md"]]);
    expect(viewModeCalls).toEqual(["wysiwyg"]);
    h.unmount();
  });

  it("HK-2: an event addressed to another window is not received", async () => {
    const h = mount();
    await flush();
    await act(async () => {
      bus.emitTo("mdpro-other", EVT, ["/x.md"]);
    });
    await flush();
    await emitToMain(["/y.md"]);

    expect(opened).toEqual([["/y.md"]]);
    h.unmount();
  });

  it("HK-3: an empty or null payload opens nothing and switches nothing", async () => {
    const h = mount("wysiwyg");
    await flush();
    await emitToMain([]);
    await emitToMain(null);
    await emitToMain(["/z.md"]);

    expect(opened).toEqual([["/z.md"]]);
    expect(viewModeCalls).toEqual(["wysiwyg"]);
    h.unmount();
  });

  it("HK-4: no focus question — the window mock has no isFocused, and the open still happens", async () => {
    // Precondition: a hook that asked `isFocused()` would hit a TypeError here.
    expect("isFocused" in getCurrentWindow()).toBe(false);
    const h = mount("wysiwyg");
    await flush();
    await emitToMain(["/a.md", "/b.md"]);

    expect(opened).toEqual([["/a.md", "/b.md"]]);
    h.unmount();
  });
});

describe("useFileOpenEvent — failure and teardown", () => {
  it("HK-5: a rejected listen neither throws out of the effect nor leaves a live subscription", async () => {
    bus.state.failure = new Error("outside Tauri");
    let h: ReturnType<typeof mount> | undefined;
    expect(() => {
      h = mount();
    }).not.toThrow();
    await flush();
    expect(() => h!.unmount()).not.toThrow();
    await flush();

    expect(bus.state.rejected).toBe(1);
    expect(bus.count(EVT)).toBe(0);
  });

  it("HK-7: unmount unsubscribes; a later emit opens nothing", async () => {
    const h = mount();
    await flush();
    expect(bus.count(EVT)).toBe(1);

    h.unmount();
    await emitToMain(["/late.md"]);

    expect(bus.count(EVT)).toBe(0);
    expect(opened).toEqual([]);
  });
});

/** k ∈ {0..3} for event 1 × k ∈ {0..3} for event 2: 16 sequences. */
const LATCH_ROWS = [0, 1, 2, 3].flatMap((k1) => [0, 1, 2, 3].map((k2) => ({ k1, k2 })));

describe("useFileOpenEvent — HK-L11 latch law: min(1, k) switches per event, to the current default (S4)", () => {
  it.each(collectionCases("tests/useFileOpenEvent.test.ts:167", LATCH_ROWS))("k1=$k1, k2=$k2", async ({ k1, k2 }) => {
    const h = mount("wysiwyg");
    await flush();

    successes = k1;
    await emitToMain(["/1.md"]);

    h.rerender({ defaultViewMode: "source" });
    await flush();

    successes = k2;
    await emitToMain(["/2.md"]);

    expect(opened).toEqual([["/1.md"], ["/2.md"]]);
    expect(viewModeCalls).toEqual([...(k1 > 0 ? ["wysiwyg"] : []), ...(k2 > 0 ? ["source"] : [])]);
    h.unmount();
  });
});

type Step = "rerender" | "unmount" | "drain";
const SCRIPTS: Record<string, Step[]> = {
  "(i) mount → drain": ["drain"],
  "(ii) mount → unmount → drain": ["unmount", "drain"],
  "(iii) mount → rerender → drain": ["rerender", "drain"],
  "(iv) mount → rerender → rerender → drain": ["rerender", "rerender", "drain"],
  "(v) mount → rerender → unmount → drain": ["rerender", "unmount", "drain"],
  "(vi) mount → drain → rerender → drain": ["drain", "rerender", "drain"],
};
const L10_ROWS = Object.entries(SCRIPTS).flatMap(([name, steps]) =>
  (["forward", "reverse"] as const).map((order) => ({ name, steps, order })),
);

describe("useFileOpenEvent — HK-L10 subscription conservation (S5)", () => {
  it.each(collectionCases("tests/useFileOpenEvent.test.ts:200", L10_ROWS))("$name, $order drain", async ({ steps, order }) => {
    bus.state.autoResolve = false;
    let mode: ViewMode = "wysiwyg";
    let mounted = true;
    const h = mount(mode);
    await flush();

    for (const step of steps) {
      if (step === "rerender") {
        mode = mode === "wysiwyg" ? "source" : "wysiwyg";
        h.rerender({ defaultViewMode: mode });
      } else if (step === "unmount") {
        h.unmount();
        mounted = false;
      } else {
        await act(async () => {
          bus.drain(order);
        });
      }
      await flush();
    }

    successes = 1;
    await emitToMain(["/after.md"]);

    expect(bus.count(EVT)).toBe(mounted ? 1 : 0);
    expect(opened.length).toBe(mounted ? 1 : 0);
    if (mounted) {
      expect(viewModeCalls.at(-1)).toBe(mode);
      h.unmount();
    }
  });
});
