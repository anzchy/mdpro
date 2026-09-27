/**
 * WI-3 (ADR-0031 step 2, part 2) — the window-geometry **save** path.
 *
 * Cases WI3-A, WI3-B, WI3-C, WI3-D, WI3-K, WI3-L, WI3-M of
 * `.claude/tdd-guardian/tests-20260923-152800.md`.
 *
 * **Law (WI3-C): two-payload agreement.** One `saveWindowState()` call writes
 * two records — the `save_window_state` IPC payload and the
 * `save_window_geometry` IPC payload. They must agree exactly on `x`, `y`,
 * `width`, `height`, at every scale factor. The defect class this kills
 * ("only one of the two call sites was converted") is invisible to any
 * per-payload assertion. Its blind spot is recorded in WI3-C below and closed
 * by WI3-M.
 *
 * **What is mocked and what is not.** Only the two process boundaries:
 * `@tauri-apps/api/window` (a hand-written `getCurrentWindow` fake, following
 * `tests/window-close-guard-listener.test.ts:47-68`) and
 * `@tauri-apps/api/core` (`invoke` as a recording `vi.fn`, and the `isTauri`
 * spy from `tests/support/tauriCoreMock.ts`, set true). The WI-2
 * `windowGeometry` util, `preferencesService`, `windowService`,
 * `documentStore`, `loggingService`, `loggingStore` and the hook itself are
 * **real** — mocking any of them would make these cases assert their own mock.
 *
 * **What no lane here can prove.** Whether Tauri's `innerSize()` /
 * `outerPosition()` genuinely report physical pixels is decision D-c; jsdom has
 * no display. It was settled by reading `node_modules/@tauri-apps/api/window.d.ts`
 * and recorded in `src/hooks/useWindowCloseGuard.ts`'s header, not by this suite.
 * The two gui-acceptance criteria (a scale-2 Retina round trip and the scale-1
 * non-Retina no-regression check) remain UNVERIFIED by any automated case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type Sized = { width: number; height: number };
type Positioned = { x: number; y: number };

const { fake, invokeMock } = vi.hoisted(() => {
  const state = {
    scale: 1,
    size: { width: 1024, height: 768 } as Sized,
    position: { x: 0, y: 0 } as Positioned,
    maximized: false,
    /** When set, `scaleFactor()` rejects with this error (WI3-D). */
    scaleFactorError: null as Error | null,
  };

  const win = {
    label: "main",
    scaleFactor: async () => {
      if (state.scaleFactorError) throw state.scaleFactorError;
      return state.scale;
    },
    innerSize: async () => ({ ...state.size }),
    outerPosition: async () => ({ ...state.position }),
    isMaximized: async () => state.maximized,
    onCloseRequested: async (_handler: unknown) => () => {},
    close() {},
  };

  return {
    fake: {
      state,
      win,
      reset() {
        state.scale = 1;
        state.size = { width: 1024, height: 768 };
        state.position = { x: 0, y: 0 };
        state.maximized = false;
        state.scaleFactorError = null;
      },
    },
    invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  };
});

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => fake.win }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { isTauri } from "@tauri-apps/api/core";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";

function doc(id: string, path: string | null): Document {
  return {
    id,
    path,
    content: `content of ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
  };
}

/** Configure the window fake for one case. */
function givenWindow(opts: {
  scale?: number;
  size?: Sized;
  position?: Positioned;
  maximized?: boolean;
  scaleFactorError?: Error;
}) {
  if (opts.scale !== undefined) fake.state.scale = opts.scale;
  if (opts.size) fake.state.size = opts.size;
  if (opts.position) fake.state.position = opts.position;
  if (opts.maximized !== undefined) fake.state.maximized = opts.maximized;
  if (opts.scaleFactorError) fake.state.scaleFactorError = opts.scaleFactorError;
}

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

function windowStatePayload() {
  const call = callsFor("save_window_state")[0];
  return (call?.[1] as { windowState: Record<string, unknown> } | undefined)?.windowState;
}

function geometryPayload() {
  const call = callsFor("save_window_geometry")[0];
  return (call?.[1] as { geometry: Record<string, unknown> } | undefined)?.geometry;
}

function logCalls() {
  return callsFor("log_event").map(
    ([, args]) => (args as { payload: Record<string, unknown> }).payload,
  );
}

function rect(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined;
  const { x, y, width, height } = payload;
  return { x, y, width, height };
}

/** Mount the hook and let its effect's dynamic import settle. */
async function mountAndSave() {
  const view = renderHook(() => useWindowCloseGuard());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  let settled: unknown = "not-settled";
  await act(async () => {
    settled = await view.result.current.saveWindowState();
  });
  view.unmount();
  return settled;
}

beforeEach(() => {
  fake.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => null);
  // `preferencesService.saveWindowState` returns early outside Tauri, so the
  // `save_window_state` payload would never reach `invoke` without this.
  vi.mocked(isTauri).mockReturnValue(true);
  // Without this, `shouldLog` filters WI3-K's entry and the log assertion would
  // fail for a reason unrelated to the code under test.
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
});


describe("WI-3 save path — physical pixels in, logical points out", () => {
  // WI3-A — the red-receipt anchor. The literal numbers from the bug report.
  it("WI3-A writes the logical rectangle to both payloads at scale 2", async () => {
    givenWindow({ scale: 2, size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } });

    await mountAndSave();

    expect(callsFor("save_window_state")).toHaveLength(1);
    expect(callsFor("save_window_geometry")).toHaveLength(1);
    expect(windowStatePayload()).toEqual({
      width: 1200,
      height: 800,
      x: 100,
      y: 100,
      isMaximized: false,
    });
    expect(callsFor("save_window_geometry")[0][1]).toEqual({
      filePath: "/tmp/a.md",
      geometry: { x: 100, y: 100, width: 1200, height: 800 },
    });
  });

  // WI3-B — the identity case. Separates "converts correctly" from "always halves".
  it("WI3-B leaves the values untouched at scale 1", async () => {
    givenWindow({ scale: 1, size: { width: 1024, height: 768 }, position: { x: 11, y: 22 } });

    await mountAndSave();

    expect(windowStatePayload()).toEqual({
      width: 1024,
      height: 768,
      x: 11,
      y: 22,
      isMaximized: false,
    });
    expect(geometryPayload()).toEqual({ x: 11, y: 22, width: 1024, height: 768 });
  });

  // WI3-C — Law (S5). Asserts a relation *between* the two payloads, so no
  // hardcoded value on either side satisfies it unless both are correct
  // together. Known blind spot: it holds vacuously when neither payload is
  // converted, so it cannot on its own detect `Math.trunc(scale) || 1`. WI3-M
  // is what closes that; this note exists so the law is not read as stronger
  // than it is.
  it("WI3-C emits two payloads that agree on x/y/width/height at every scale", async () => {
    const scales = [1, 1.25, 1.5, 2, 3];
    const geometries = [
      { size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } },
      { size: { width: 1801, height: 1199 }, position: { x: 301, y: 151 } },
    ];

    for (const scale of scales) {
      for (const g of geometries) {
        fake.reset();
        invokeMock.mockReset();
        invokeMock.mockImplementation(async () => null);
        givenWindow({ scale, size: g.size, position: g.position });

        await mountAndSave();

        const label = `scale=${scale} size=${g.size.width}x${g.size.height} pos=${g.position.x},${g.position.y}`;
        const state = rect(windowStatePayload());
        const geometry = rect(geometryPayload());
        expect(state, `no save_window_state payload for ${label}`).toBeDefined();
        expect(geometry, `no save_window_geometry payload for ${label}`).toBeDefined();
        expect(geometry, `the two payloads disagree for ${label}`).toEqual(state);
      }
    }
  });

  // WI3-M — a fractional scale factor is *applied*, not truncated. Every
  // division here is exact, so the expected values are independent of the
  // rounding rule: this case claims the factor is used, not how it rounds.
  it("WI3-M applies a fractional scale factor of 1.5 rather than truncating it", async () => {
    givenWindow({ scale: 1.5, size: { width: 1800, height: 1200 }, position: { x: 300, y: 150 } });

    await mountAndSave();

    expect(windowStatePayload()).toEqual({
      width: 1200,
      height: 800,
      x: 200,
      y: 100,
      isMaximized: false,
    });
    expect(geometryPayload()).toEqual({ x: 200, y: 100, width: 1200, height: 800 });
  });

  // WI3-L — `isMaximized: true` survives the conversion. Whole-object `toEqual`
  // on both payloads, so a key gained or lost is caught.
  it("WI3-L carries isMaximized: true through without disturbing the conversion", async () => {
    givenWindow({
      scale: 2,
      size: { width: 2400, height: 1600 },
      position: { x: 200, y: 200 },
      maximized: true,
    });

    await mountAndSave();

    expect(windowStatePayload()).toEqual({
      width: 1200,
      height: 800,
      x: 100,
      y: 100,
      isMaximized: true,
    });
    expect(geometryPayload()).toEqual({ x: 100, y: 100, width: 1200, height: 800 });
  });

  // WI3-D — the newly added await is a newly added failure point. It must fail
  // *before* the first write, or a physical record lands on disk with no
  // matching geometry record: worse than either doing nothing or doing both.
  it("WI3-D writes nothing and does not throw when scaleFactor() rejects", async () => {
    givenWindow({
      scale: 2,
      size: { width: 2400, height: 1600 },
      position: { x: 200, y: 200 },
      scaleFactorError: new Error("no display"),
    });

    const settled = await mountAndSave();

    expect(settled).toBeUndefined();
    expect(callsFor("save_window_state")).toHaveLength(0);
    expect(callsFor("save_window_geometry")).toHaveLength(0);
  });

  // WI3-K — a rejecting `save_window_state` neither escapes nor vanishes.
  //
  // **Branch pinned: (ii) all-or-nothing.** Two records that must agree (the
  // WI3-C law) are not allowed to half-exist, so a failed `save_window_state`
  // suppresses the per-file geometry write. This is today's de-facto ordering,
  // and this case plus the `useWindowCloseGuard.ts` header turn it from an
  // accident of `await` order into a recorded decision.
  //
  // WI-1 is what makes this class reachable: before it, `save_window_state`
  // swallowed a load failure and returned `Ok`.
  it("WI3-K logs a fail entry and writes no geometry when save_window_state rejects", async () => {
    givenWindow({ scale: 2, size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } });
    invokeMock.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "save_window_state") {
        throw new Error('ParseError { message: "expected value at line 1 column 3" }');
      }
      return null;
    });

    const settled = await mountAndSave();

    expect(settled).toBeUndefined();
    // Branch (ii): the geometry record must not half-exist.
    expect(callsFor("save_window_geometry")).toHaveLength(0);

    const failures = logCalls().filter((entry) => entry.status === "fail");
    expect(failures).toHaveLength(1);
    expect(failures[0].event).toBe("window.save_state");
    expect(failures[0].level).toBe("error");
    // SPEC INVERSION (ADR-0031 step 5b, RB-X item 7): the entry used to carry
    // the rejection text as `error`; it now carries a stage enum.
    expect(failures[0].context).toEqual({ reason: "save_rejected" });
    expect(failures[0]).not.toHaveProperty("error");
    expect(JSON.stringify(logCalls())).not.toContain("line 1");
  });
});
