/**
 * ADR-0031 step 5b (WI-1) — the close-guard `saveWindowState` failure log is
 * stage-typed and enum-only.
 *
 * Matrix `.claude/tdd-guardian/tests-20260927-031000.md` W1. Law: every failure
 * inside `saveWindowState` produces exactly one `window.save_state` fail entry
 * with no `error` key and `context` deep-equal to `{ reason }`, where reason
 * names the stage that failed:
 *   - `geometry_read_failed`   — the window-API reads (scale, size, position)
 *   - `save_rejected`          — `preferencesService.saveWindowState` (main only)
 *   - `geometry_save_rejected` — `windowService.saveWindowGeometry`
 * The save never rethrows, the all-or-nothing law (WI3-K) holds, and no
 * substring of the rejection appears in any log payload of the row.
 * W1b (follow-up) adds the two reads W1 did not fault — `innerSize()` and
 * `isMaximized()` — both of which log `geometry_read_failed` and write nothing.
 *
 * Mocked: `@tauri-apps/api/core` (`invoke` + the `isTauri` spy, set true) and
 * the window fake in `tests/support/windowSaveHarness.ts`. Everything else is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", async () => {
  const h = await import("./support/windowSaveHarness");
  return { getCurrentWindow: () => h.win };
});
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./support/windowSaveHarness");
  return {
    ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
    invoke: (...args: unknown[]) => h.invokeMock(...args),
  };
});

import { isTauri } from "@tauri-apps/api/core";
import {
  callsFor,
  givenWindow,
  invokeMock,
  logCalls,
  mountAndSave,
  resetHarness,
  skipLogs,
  state,
  win,
} from "./support/windowSaveHarness";
import { useWindowCloseGuard } from "../src/hooks/useWindowCloseGuard";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";

type Fault =
  | { at: "scaleFactor"; error: Error }
  | { at: "outerPosition"; error: unknown }
  | { at: "innerSize" | "isMaximized"; error: unknown }
  | { at: "save_window_state" | "save_window_geometry"; error: unknown };

interface Row {
  label: string;
  fault: Fault;
  reason: "geometry_read_failed" | "save_rejected" | "geometry_save_rejected";
  stateCalls: number;
  geometryCalls: number;
}

const ROWS: Row[] = [
  { label: "main", fault: { at: "scaleFactor", error: new Error("no display /Users/x") }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "mdpro-abc", fault: { at: "scaleFactor", error: new Error("no display") }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "main", fault: { at: "outerPosition", error: "EACCES /Users/x" }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "main", fault: { at: "save_window_state", error: new Error("disk full at /Users/x/.mdpro/config.json") }, reason: "save_rejected", stateCalls: 1, geometryCalls: 0 },
  { label: "main", fault: { at: "save_window_state", error: "EACCES /Users/x/.mdpro/config.json" }, reason: "save_rejected", stateCalls: 1, geometryCalls: 0 },
  { label: "main", fault: { at: "save_window_state", error: { ParseError: { message: "expected value at line 1 column 3 /Users/x" } } }, reason: "save_rejected", stateCalls: 1, geometryCalls: 0 },
  { label: "main", fault: { at: "save_window_geometry", error: new Error("EACCES /Users/x/doc.md") }, reason: "geometry_save_rejected", stateCalls: 1, geometryCalls: 1 },
  { label: "main", fault: { at: "save_window_geometry", error: { IoError: { message: "Permission denied /Users/x" } } }, reason: "geometry_save_rejected", stateCalls: 1, geometryCalls: 1 },
  { label: "mdpro-abc", fault: { at: "save_window_geometry", error: "EACCES /Users/x/doc.md" }, reason: "geometry_save_rejected", stateCalls: 0, geometryCalls: 1 },
];

const FORBIDDEN = ["/Users", "EACCES", "no display", "line 1", "Permission denied", "doc.md", "message"];

/** W1b: the reads W1's rows leave unfaulted. Both happen before any write. */
const READ_ROWS: Row[] = [
  { label: "main", fault: { at: "innerSize", error: new Error("no display /Users/x") }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "mdpro-abc", fault: { at: "innerSize", error: "EACCES /Users/x" }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "main", fault: { at: "isMaximized", error: { IoError: { message: "Permission denied /Users/x" } } }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
  { label: "mdpro-abc", fault: { at: "isMaximized", error: new Error("no display") }, reason: "geometry_read_failed", stateCalls: 0, geometryCalls: 0 },
];

/** `isMaximized` has no harness error slot, so W1b faults it with a spy restored per row. */
let isMaximizedSpy: { mockRestore: () => void } | null = null;

function doc(id: string, path: string): Document {
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

function inject(fault: Fault): void {
  if (fault.at === "scaleFactor") givenWindow({ scaleFactorError: fault.error });
  else if (fault.at === "outerPosition") state.outerPositionError = fault.error;
  else if (fault.at === "innerSize") state.innerSizeError = fault.error;
  else if (fault.at === "isMaximized") isMaximizedSpy = vi.spyOn(win, "isMaximized").mockRejectedValue(fault.error);
  else {
    const command = fault.at;
    invokeMock.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === command) throw fault.error;
      return null;
    });
  }
}

beforeEach(() => {
  resetHarness();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
});

describe("W1 close-save failure domain — stage-correct reason, whole-row redaction", () => {
  it("W1 every stage × rejection shape logs one enum-only fail entry and keeps all-or-nothing", async () => {
    expect(ROWS).toHaveLength(9);
    expect(isTauri()).toBe(true);
    expect(useLoggingStore.getState()).toMatchObject({ enabled: true, level: "debug" });

    for (const [index, row] of ROWS.entries()) {
      resetHarness();
      useDocumentStore.setState({ documents: [doc("d", "/Users/x/doc.md")], activeDocumentId: "d" });
      givenWindow({ label: row.label, scale: 2, size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } });
      inject(row.fault);

      const settled = await mountAndSave(useWindowCloseGuard);
      const tag = `row ${index + 1}`;

      expect(settled, tag).toBeUndefined();
      expect(state.label, tag).toBe(row.label);
      if (row.reason === "geometry_read_failed") {
        expect(state.order, tag).toContain(row.fault.at);
      } else if (row.reason === "save_rejected") {
        expect(callsFor("save_window_state"), tag).toHaveLength(1);
      } else {
        expect(callsFor("save_window_geometry"), tag).toHaveLength(1);
      }

      const fails = logCalls().filter((e) => e.event === "window.save_state" && e.status === "fail");
      expect(fails, tag).toHaveLength(1);
      expect(fails[0], tag).not.toHaveProperty("error");
      expect(fails[0].context, tag).toEqual({ reason: row.reason });

      expect(callsFor("save_window_state"), tag).toHaveLength(row.stateCalls);
      expect(callsFor("save_window_geometry"), tag).toHaveLength(row.geometryCalls);

      const whole = JSON.stringify(logCalls());
      for (const forbidden of FORBIDDEN) expect(whole, `${tag} ${forbidden}`).not.toContain(forbidden);

      if (index === 8) expect(skipLogs(), tag).toHaveLength(1);
    }
  });

  it("W1b innerSize() and isMaximized() rejecting log geometry_read_failed and write nothing", async () => {
    expect(READ_ROWS).toHaveLength(4);
    for (const [index, row] of READ_ROWS.entries()) {
      resetHarness();
      useDocumentStore.setState({ documents: [doc("d", "/Users/x/doc.md")], activeDocumentId: "d" });
      givenWindow({ label: row.label, scale: 2, size: { width: 2400, height: 1600 }, position: { x: 200, y: 200 } });
      inject(row.fault);
      const tag = `read row ${index + 1}`;
      try {
        expect(await mountAndSave(useWindowCloseGuard), tag).toBeUndefined();
        if (row.fault.at === "innerSize") expect(state.order, tag).not.toContain("outerPosition");
        else expect(state.order, tag).toEqual(["scaleFactor", "innerSize", "outerPosition"]);

        const fails = logCalls().filter((e) => e.event === "window.save_state" && e.status === "fail");
        expect(fails, tag).toHaveLength(1);
        expect(fails[0], tag).not.toHaveProperty("error");
        expect(fails[0].context, tag).toEqual({ reason: row.reason });
        expect(callsFor("save_window_state"), tag).toHaveLength(0);
        expect(callsFor("save_window_geometry"), tag).toHaveLength(0);
        expect(skipLogs(), tag).toHaveLength(0);

        const whole = JSON.stringify(logCalls());
        for (const forbidden of FORBIDDEN) expect(whole, `${tag} ${forbidden}`).not.toContain(forbidden);
      } finally {
        isMaximizedSpy?.mockRestore();
        isMaximizedSpy = null;
      }
    }
  });
});
