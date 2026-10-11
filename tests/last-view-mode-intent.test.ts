/**
 * D24 WI-3 (ADR-0031 step 6, ADR-0053, finding F5) — after settle the
 * persistence hook writes `lastViewMode` only for USER view-mode commands.
 * Programmatic switches (the large-document degrade, drop, Finder open,
 * launch paths, `?open=`) never write, and the stored mode is applied with a
 * programmatic switch so applying it never records a user choice.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-171405.md`, cases LVI-01 to
 * LVI-12 (with LVI-07b, r3). LVI-09s, the same law at length <= 6, is the slow
 * sibling `tests/last-view-mode-intent.slow.test.ts`; both run the shared
 * runner in `tests/support/lastViewModeLaw.ts`.
 *
 * jsdom (not node): `renderHook`, and the editor store's import graph needs a
 * window (DOMPurify hook in `sanitizerPolicy.ts`, ADR-0049).
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke`, routed to the stateful
 * backend fake in `tests/support/lastViewModeHarness.ts`. `@tauri-apps/api/window`
 * is NOT mocked: in the `?open=` row its real import throws outside Tauri and
 * `useOpenUrlParam` catches it. The real path is discharged on the device by
 * the D24 manual fixture (M-1 to M-4); there is no frontend integration lane.
 *
 * LVI-11 CHARACTERISES a known ADR-0053 cost (F-10); it is not an endorsement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { waitFor } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useOpenUrlParam } from "../src/hooks/useOpenUrlParam";
import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";
import type { Document } from "../src/types/document";
import type { ViewMode } from "../src/types/editor";
import type { UserPreferences } from "../src/types/preferences";
import { makePreferences } from "./support/preferenceFixtures";
import {
  answer,
  backend,
  callsFor,
  commits,
  dedupeConsecutive,
  flush,
  lastViewModeWrites,
  mountHarness,
  resetCase,
  resolveRead,
  resolveReadWith,
  setMode,
  setModeProgrammatic,
  storeChoice,
  storeMode,
  teardownCase,
} from "./support/lastViewModeHarness";
import { checkLastViewModeLaw } from "./support/lastViewModeLaw";
import { setOnlySequences } from "./support/viewModeCommandSequences";

const SETTLED = { loaded: true, launched: true } as const;

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
});

afterEach(() => {
  teardownCase();
});

const writtenModes = () => lastViewModeWrites().map((p) => p.preferences.lastViewMode);

/** `preferences.last_view_mode` contexts, in emission order. */
function lastViewModeLogs(): Array<Record<string, unknown>> {
  return callsFor("log_event")
    .map(([, args]) => (args as { payload: { event: string; context: Record<string, unknown> } }).payload)
    .filter((p) => p.event === "preferences.last_view_mode")
    .map((p) => p.context);
}

/** Case (a): settle through the read with `disk`, then open a document. */
async function settleThroughRead(disk: Partial<UserPreferences>) {
  resetCase(makePreferences(disk));
  const h = mountHarness({ ...SETTLED, hasDoc: false });
  await flush();
  await resolveRead();
  act(() => {
    h.rerender({ ...SETTLED, hasDoc: true });
  });
  await flush();
  return h;
}

describe("useLastViewModePersistence — only user choices persist (D24 WI-3)", () => {
  it("LVI-01 (a): a programmatic degrade after a read-settle writes nothing", async () => {
    await settleThroughRead({ lastViewMode: "wysiwyg" });
    setModeProgrammatic("source");
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("wysiwyg");
    expect(storeMode()).toBe("source");
  });

  it("LVI-01 (b): a programmatic degrade after a document-active settle writes nothing", async () => {
    resetCase(makePreferences({ lastViewMode: "wysiwyg" }));
    mountHarness({ ...SETTLED, hasDoc: true });
    await flush();
    expect(callsFor("get_preferences").length).toBe(0);
    setModeProgrammatic("source");
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("wysiwyg");
    expect(storeMode()).toBe("source");
  });

  it.each(["drop", "Finder open", "launch paths"])(
    "LVI-02 %s: the reset to defaultViewMode after settle writes nothing",
    async () => {
      await settleThroughRead({ lastViewMode: "source", defaultViewMode: "wysiwyg" });
      expect(storeMode()).toBe("source");
      setModeProgrammatic("wysiwyg");
      await flush();

      expect(lastViewModeWrites()).toEqual([]);
      expect(backend.disk.lastViewMode).toBe("source");
      expect(storeMode()).toBe("wysiwyg");
    },
  );

  it("LVI-02 ?open=: the real useOpenUrlParam, run after settle, writes nothing", async () => {
    await settleThroughRead({ lastViewMode: "source", defaultViewMode: "wysiwyg" });
    expect(storeMode()).toBe("source");
    window.history.replaceState({}, "", "/?open=%2Ftmp%2Fx.md");
    const opened: Document = {
      id: "d1",
      path: "/tmp/x.md",
      content: "x",
      encoding: "UTF-8",
      lineEnding: "lf",
      isModified: false,
      lastSaved: null,
      fileSize: null,
    };
    const open = renderHook((p: { loaded: boolean }) =>
      useOpenUrlParam({
        preferencesLoaded: p.loaded,
        defaultViewMode: "wysiwyg",
        setViewMode: useEditorStore.getState().setViewMode,
        openPathOutcome: async () => ({ document: opened, activated: true }),
        updateRecentFiles: vi.fn(),
      }),
    { initialProps: { loaded: false } });
    act(() => {
      open.rerender({ loaded: true });
    });
    await flush();
    await flush();
    // Under coverage the dynamic `@tauri-apps/api/window` import can outlast two
    // macrotasks; wait (default waitFor budget, not raised) for the path to finish.
    await waitFor(() => expect(window.location.search).toBe(""));

    expect(window.location.search).toBe("");
    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("source");
    expect(storeMode()).toBe("wysiwyg");
    open.unmount();
  });

  it("LVI-03: user ⌃2 then ⌃4 after settle writes each, in order", async () => {
    await settleThroughRead({ lastViewMode: "wysiwyg" });
    setMode("source");
    await flush();
    setMode("wysiwyg");
    await flush();

    expect(writtenModes()).toEqual(["source", "wysiwyg"]);
    expect(backend.disk.lastViewMode).toBe("wysiwyg");
  });

  it("LVI-04: a user choice survives later programmatic switches, and the close re-read restores it", async () => {
    const h = await settleThroughRead({ lastViewMode: "wysiwyg" });
    setMode("source");
    await flush();
    setModeProgrammatic("wysiwyg");
    await flush();
    setModeProgrammatic("source");
    await flush();
    setModeProgrammatic("wysiwyg");
    await flush();

    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);
    expect(backend.disk.lastViewMode).toBe("source");

    act(() => {
      h.rerender({ ...SETTLED, hasDoc: false });
    });
    await flush();
    await resolveRead();

    expect(storeMode()).toBe("source");
    expect(lastViewModeWrites()).toHaveLength(1);
    expect(callsFor("get_preferences").length).toBe(2);
  });

  it("LVI-05: an explicit no-change command over a programmatic mode writes once (D-3)", async () => {
    await settleThroughRead({ lastViewMode: "wysiwyg" });
    setModeProgrammatic("source");
    await flush();
    expect(lastViewModeWrites(), "checkpoint A: the degrade writes nothing").toEqual([]);

    setMode("source");
    await flush();
    expect(lastViewModeWrites(), "checkpoint B: the explicit choice writes").toEqual([
      { preferences: { lastViewMode: "source" } },
    ]);
    expect(storeChoice()).toEqual({ seq: 1, mode: "source" });
  });

  it("LVI-06: an explicit command equal to lastSeen is deduped", async () => {
    await settleThroughRead({ lastViewMode: "source" });
    setModeProgrammatic("wysiwyg");
    setMode("source");
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("source");
    expect(storeMode()).toBe("source");
    expect(storeChoice()).toEqual({ seq: 1, mode: "source" });
  });

  it("LVI-07: a deduped user choice still invalidates a pending close re-read", async () => {
    const h = await settleThroughRead({ lastViewMode: "source" });
    expect(storeMode()).toBe("source");
    act(() => {
      h.rerender({ ...SETTLED, hasDoc: false });
    });
    await flush();
    expect(backend.pending.length).toBe(2);

    setMode("source");
    await resolveReadWith(makePreferences({ lastViewMode: "wysiwyg" }));

    expect(storeMode()).toBe("source");
    expect(lastViewModeWrites()).toEqual([]);
    const logs = lastViewModeLogs();
    expect(logs.at(-1)).toEqual({ outcome: "discarded", reason: "stale_read_discarded" });
    expect(logs.filter((c) => c.reason === "read_applied")).toHaveLength(1);
  });

  it("LVI-07b: a repeated same-mode user choice still invalidates a pending re-read", async () => {
    const h = await settleThroughRead({ lastViewMode: "wysiwyg" });
    setMode("source");
    await flush();
    expect(writtenModes()).toEqual(["source"]);
    expect(storeChoice()).toEqual({ seq: 1, mode: "source" });
    setModeProgrammatic("wysiwyg");

    act(() => {
      h.rerender({ ...SETTLED, hasDoc: false });
    });
    await flush();
    expect(backend.pending.length).toBe(2);

    setMode("source");
    expect(storeChoice()).toEqual({ seq: 2, mode: "source" });
    await resolveReadWith(makePreferences({ lastViewMode: "wysiwyg" }));

    expect(storeMode()).toBe("source");
    expect(lastViewModeWrites()).toEqual([{ preferences: { lastViewMode: "source" } }]);
    expect(lastViewModeLogs().at(-1)).toEqual({ outcome: "discarded", reason: "stale_read_discarded" });
  });

  describe("LVI-08: a programmatic mode change in the same commit as a document change writes nothing", () => {
    const P = { ...SETTLED, hasDoc: true } as const;

    async function mountD1() {
      resetCase(makePreferences({ lastViewMode: "wysiwyg" }));
      const h = mountHarness({ ...P, docId: "d1" });
      await flush();
      return h;
    }

    it("same-commit", async () => {
      const h = await mountD1();
      const base = commits.length;
      act(() => {
        useEditorStore.getState().setViewMode("source");
        h.rerender({ ...P, docId: "d2" });
      });
      await flush();

      const delta = dedupeConsecutive(commits.slice(base));
      expect(delta).toContainEqual(["source", "d2"]);
      expect(delta).not.toContainEqual(["source", "d1"]);
      expect(delta).not.toContainEqual(["wysiwyg", "d2"]);
      expect(lastViewModeWrites()).toEqual([]);
      expect(storeMode()).toBe("source");
    });

    it("mode-first", async () => {
      const h = await mountD1();
      setModeProgrammatic("source");
      await flush();
      act(() => {
        h.rerender({ ...P, docId: "d2" });
      });
      await flush();

      expect(lastViewModeWrites()).toEqual([]);
      expect(storeMode()).toBe("source");
    });

    it("doc-first", async () => {
      const h = await mountD1();
      act(() => {
        h.rerender({ ...P, docId: "d2" });
      });
      await flush();
      setModeProgrammatic("source");
      await flush();

      expect(lastViewModeWrites()).toEqual([]);
      expect(storeMode()).toBe("source");
    });
  });

  it("LVI-09: erasure and closed-form law over every set-only sequence of length <= 2 (40 rows)", async () => {
    const sequences = setOnlySequences(2);
    expect(sequences).toHaveLength(20);
    const failures = await checkLastViewModeLaw(sequences, { logging: true });
    expect(failures).toEqual([]);
  });

  it("LVI-10: a user cycle that lands on lastSeen after a programmatic switch writes nothing", async () => {
    await settleThroughRead({ lastViewMode: "wysiwyg" });
    setModeProgrammatic("source");
    act(() => userViewModeCommands.cycle());
    await flush();

    expect(storeMode()).toBe("wysiwyg");
    expect(storeChoice()).toEqual({ seq: 1, mode: "wysiwyg" });
    expect(lastViewModeWrites()).toEqual([]);

    act(() => userViewModeCommands.cycle());
    await flush();
    expect(writtenModes()).toEqual(["source"]);
  });

  it("LVI-11 (characterisation, F-10): in case (b) lastSeen is the screen mode, so picking it writes nothing", async () => {
    resetCase(makePreferences({ lastViewMode: "source" }));
    expect(storeMode()).toBe("wysiwyg");
    mountHarness({ ...SETTLED, hasDoc: true });
    await flush();
    setMode("wysiwyg");
    await flush();

    expect(lastViewModeWrites()).toEqual([]);
    expect(backend.disk.lastViewMode).toBe("source");
  });

  it("LVI-12: the hook applies the stored mode programmatically, at startup and on the close re-read", async () => {
    resetCase(makePreferences({ lastViewMode: "source" }));
    const h = mountHarness({ ...SETTLED, hasDoc: false });
    await flush();
    await resolveRead();

    expect(storeMode(), "check 1: the startup read applied").toBe("source");
    expect(storeChoice(), "check 1: no user choice recorded").toEqual({ seq: 0, mode: "wysiwyg" });

    act(() => {
      h.rerender({ ...SETTLED, hasDoc: true });
    });
    await flush();
    act(() => {
      h.rerender({ ...SETTLED, hasDoc: false });
    });
    await flush();
    await resolveReadWith(makePreferences({ lastViewMode: "wysiwyg" as ViewMode }));

    expect(storeMode(), "check 2: the re-read applied").toBe("wysiwyg");
    expect(storeChoice(), "check 2: still no user choice").toEqual({ seq: 0, mode: "wysiwyg" });
    expect(lastViewModeWrites()).toEqual([]);
  });
});
