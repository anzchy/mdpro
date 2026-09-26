/**
 * WI-3 (ADR-0031 step 5a) — `saveWindowState` call order and log redaction.
 *
 * Cases WI3-09 and WI3-10 of `.claude/tdd-guardian/tests-20260926-221500.md`:
 * - WI3-09: `scaleFactor()` settles before `innerSize()` / `outerPosition()`
 *   are called, for owner and non-owner alike (WI3-D, extended).
 * - WI3-10: no leaf of any log payload emitted during a save equals the
 *   window label, the file path, or any physical or logical coordinate.
 *
 * Harness: `tests/support/windowSaveHarness.ts`. Only `invoke` and
 * `getCurrentWindow` are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";

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
  deepLeaves,
  deferred,
  geometryPayload,
  givenWindow,
  logCalls,
  mountAndSave,
  mountAndStartSave,
  resetHarness,
  state,
} from "./support/windowSaveHarness";
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

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  resetHarness();
  (globalThis as unknown as Record<string, unknown>).__TAURI__ = {};
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useDocumentStore.setState({ documents: [doc("doc-a", "/tmp/a.md")], activeDocumentId: "doc-a" });
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI__;
});

describe("WI3-09 scaleFactor settles before size and position are read", () => {
  it.each(["mdpro-abc", "Main", "main"])("label %j", async (label) => {
    givenWindow({
      label,
      scale: 2,
      size: { width: 2400, height: 1600 },
      position: { x: 200, y: 200 },
    });
    const gate = deferred();
    state.scaleGate = gate;

    const running = await mountAndStartSave(useWindowCloseGuard);
    await flush();
    await flush();
    const pending = [...state.order];
    gate.resolve();
    await running.finish();

    expect(pending).toEqual(["scaleFactor"]);
    expect(state.order[0]).toBe("scaleFactor");
    expect([...state.order].sort()).toEqual(["innerSize", "outerPosition", "scaleFactor"]);
    expect(callsFor("save_window_geometry")).toHaveLength(1);
    expect(geometryPayload()).toEqual({ x: 100, y: 100, width: 1200, height: 800 });
    expect(callsFor("save_window_state")).toHaveLength(label === "main" ? 1 : 0);
  });
});

describe("WI3-10 no log payload carries the label, the path or a coordinate", () => {
  const LABEL = "mdpro-7f3e9c";
  const PATH = "/tmp/a.md";
  const NUMBERS = [642, 318, 2468, 1358, 321, 159, 1234, 679];
  const WINDOW = {
    scale: 2,
    size: { width: 2468, height: 1358 },
    position: { x: 642, y: 318 },
  };

  it("the leaf walker sees nested array values", () => {
    expect(deepLeaves({ context: { nested: [{ w: 1234 }] } })).toContain(1234);
  });

  const rows: Array<[string, string, () => void]> = [
    ["a", LABEL, () => {}],
    ["b", "Main", () => {}],
    [
      "c",
      LABEL,
      () => useDocumentStore.setState({ documents: [doc("u", null)], activeDocumentId: "u" }),
    ],
    ["d", LABEL, () => givenWindow({ scaleFactorError: new Error("no display") })],
  ];

  it.each(rows)("row (%s) label %j", async (row, label, setup) => {
    givenWindow({ label, ...WINDOW });
    setup();

    await mountAndSave(useWindowCloseGuard);

    const payloads = logCalls();
    expect(payloads.length, `row ${row} logged nothing`).toBeGreaterThanOrEqual(1);
    const forbidden = new Set<unknown>([label, PATH, ...NUMBERS, ...NUMBERS.map(String)]);
    const leaves = payloads.flatMap(deepLeaves);
    for (const v of leaves) {
      expect(forbidden.has(v), `row ${row} leaked ${String(v)}`).toBe(false);
      if (typeof v === "string") {
        expect(v.includes(label), `row ${row} leaked label in ${v}`).toBe(false);
        expect(v.includes(PATH), `row ${row} leaked path in ${v}`).toBe(false);
      }
    }
  });
});
