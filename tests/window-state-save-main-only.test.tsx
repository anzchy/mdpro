/**
 * WI-3 (ADR-0031 step 5a, ADR-0037 Decision 3) — only `main` writes the global
 * `windowState` on close; every window still writes its own per-file geometry.
 *
 * Cases WI3-01 … WI3-07 of `.claude/tdd-guardian/tests-20260926-221500.md`.
 * WI3-08 is `tests/window-geometry-save-path.test.tsx` passing unedited;
 * WI3-09 and WI3-10 live in `tests/window-state-save-order-redaction.test.tsx`.
 *
 * Mocked: only `@tauri-apps/api/core#invoke` and
 * `@tauri-apps/api/window#getCurrentWindow` (fakes in
 * `tests/support/windowSaveHarness.ts`). The hook, `preferencesService`,
 * `windowService`, `loggingService`, the stores and `physicalToLogical` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => {
  const h = await import("./support/windowSaveHarness");
  return { getCurrentWindow: () => h.win };
});
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./support/windowSaveHarness");
  return { invoke: (...args: unknown[]) => h.invokeMock(...args) };
});

import {
  callsFor,
  geometryPayload,
  givenWindow,
  invokeMock,
  logCalls,
  mountAndSave,
  resetHarness,
  skipLogs,
  windowStatePayload,
} from "./support/windowSaveHarness";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { physicalToLogical } from "../src/utils/windowGeometry";
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

const PLAN_LABELS = ["mdpro-abc", "Main", "main ", ""];
const NEAR = [
  "mdpro-abc",
  "Main",
  "MAIN",
  "main ",
  " main",
  "main\n",
  "mainx",
  "xmain",
  "mai",
  "",
  "mаin", // Cyrillic а
  "main​", // zero-width space
];
const RETINA = { scale: 2, size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } };
const save = () => mountAndSave(useWindowCloseGuard);

beforeEach(() => {
  resetHarness();
  (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
});

describe("WI-3 saveWindowState — the global windowState is main's alone", () => {
  // WI3-01 — the regression red.
  it.each(PLAN_LABELS)(
    "WI3-01 label %j skips save_window_state but writes the exact per-file geometry",
    async (label) => {
      givenWindow({ label, ...RETINA });

      await save();

      expect(callsFor("save_window_state")).toHaveLength(0);
      expect(callsFor("save_window_geometry")).toHaveLength(1);
      expect(callsFor("save_window_geometry")[0][1]).toEqual({
        filePath: "/tmp/a.md",
        geometry: physicalToLogical({ x: 200, y: 200, width: 2400, height: 1600 }, 2),
      });
      expect(callsFor("save_window_geometry")[0][1]).toEqual({
        filePath: "/tmp/a.md",
        geometry: { x: 100, y: 100, width: 1200, height: 800 },
      });
    },
  );

  // WI3-02 — ownership (S4) and label-invariance (S6).
  it("WI3-02 ownership holds over the label domain and the geometry is label-invariant", async () => {
    const scales = [1, 1.25, 1.5, 2];
    const geometries = [
      { size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } },
      { size: { width: 1203, height: 799 }, position: { x: 7, y: 13 } },
    ];
    for (const scale of scales) {
      for (const g of geometries) {
        givenWindow({ label: "main", scale, ...g });
        await save();
        const ref = geometryPayload();
        expect(ref, `main @${scale} wrote no geometry`).toBeDefined();
        expect(callsFor("save_window_state"), `main @${scale}`).toHaveLength(1);

        for (const label of NEAR) {
          invokeMock.mockClear();
          givenWindow({ label, scale, ...g });
          await save();
          const tag = `label ${JSON.stringify(label)} @${scale} ${JSON.stringify(g)}`;
          expect(callsFor("save_window_state"), tag).toHaveLength(0);
          expect(callsFor("save_window_geometry"), tag).toHaveLength(1);
          expect(geometryPayload(), tag).toEqual(ref);
        }
        invokeMock.mockClear();
      }
    }
  });

  // WI3-03 — the skip log is enum-only.
  it.each(["mdpro-abc", ""])(
    "WI3-03 label %j emits exactly one enum-only skip log",
    async (label) => {
      givenWindow({ label, ...RETINA });

      await save();

      const entries = logCalls().filter((e) => e.event === "window.save_state");
      expect(entries).toEqual([
        {
          level: "info",
          event: "window.save_state",
          status: "success",
          actionId: expect.any(String),
          context: { outcome: "skipped", reason: "not_main" },
        },
      ]);
      expect(logCalls().filter((e) => e.status === "fail")).toHaveLength(0);
      const keys = Object.keys(entries[0].context as Record<string, unknown>);
      for (const forbidden of ["path", "label", "x", "y", "width", "height"]) {
        expect(keys).not.toContain(forbidden);
      }
    },
  );

  // WI3-04 — the positive control that makes WI3-01's zero non-vacuous.
  it("WI3-04 label main writes one global state and one agreeing geometry record", async () => {
    givenWindow({ label: "main", ...RETINA });

    await save();

    expect(callsFor("save_window_state")).toHaveLength(1);
    expect(windowStatePayload()).toEqual({
      width: 1200,
      height: 800,
      x: 100,
      y: 100,
      isMaximized: false,
    });
    expect(callsFor("save_window_geometry")).toHaveLength(1);
    expect(geometryPayload()).toEqual({ x: 100, y: 100, width: 1200, height: 800 });
    expect(skipLogs()).toHaveLength(0);
  });

  // WI3-05 — untitled document on a non-main window.
  it("WI3-05 non-main with an untitled document writes nothing and still logs the skip", async () => {
    useDocumentStore.setState({ documents: [doc("u", null)], activeDocumentId: "u" });
    givenWindow({ label: "mdpro-abc", ...RETINA });

    await save();

    expect(callsFor("save_window_state")).toHaveLength(0);
    expect(callsFor("save_window_geometry")).toHaveLength(0);
    expect(skipLogs()).toEqual([
      {
        level: "info",
        event: "window.save_state",
        status: "success",
        actionId: expect.any(String),
        context: { outcome: "skipped", reason: "not_main" },
      },
    ]);
  });

  // WI3-06 — scale is read before the ownership branch.
  it("WI3-06 a scaleFactor rejection on non-main writes nothing, logs one fail and no skip", async () => {
    givenWindow({ label: "mdpro-abc", ...RETINA, scaleFactorError: new Error("no display") });

    const settled = await save();

    expect(settled).toBeUndefined();
    expect(callsFor("save_window_state")).toHaveLength(0);
    expect(callsFor("save_window_geometry")).toHaveLength(0);
    const entries = logCalls().filter((e) => e.event === "window.save_state");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "fail", error: "no display" });
    expect(skipLogs()).toHaveLength(0);
  });

  // WI3-07 — the isTauriEnv detector still gates the global write in 5a.
  it("WI3-07 without __TAURI__, main writes no global state but still writes geometry", async () => {
    delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
    givenWindow({ label: "main", ...RETINA });

    await save();

    expect(callsFor("save_window_state")).toHaveLength(0);
    expect(callsFor("save_window_geometry")).toHaveLength(1);
  });
});
