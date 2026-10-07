/**
 * D24 WI-1 — the view-mode intent signal in the editor store (ADR-0031 step 6).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261007-171405.md`, cases VMI-00..VMI-07
 * (VMI-06s, the length-6 sweep, lives in `view-mode-intent.slow.test.ts`).
 *
 * Laws under test:
 *   - Counting: `userViewModeChoice.seq` equals the number of user-intent
 *     commands, changed or not; programmatic commands leave the choice as-is.
 *   - Agreement: right after a user command, `choice.mode === viewMode`.
 *
 * Runs under jsdom, not node (ADR-0049): the editor store's import graph
 * reaches `src/services/sanitizerPolicy.ts`, which calls `DOMPurify.addHook`
 * at module load. Without a window DOMPurify exports a stub that lacks
 * `addHook`, so the file fails to load under node ("default.addHook is not a
 * function"). Only `@tauri-apps/api/core` is mocked; the real loggingService, editor store
 * and milkdown flusher registry run. Log entries are read at the
 * `invoke("log_event")` boundary and filtered to `view.mode.change`, because
 * a transition also logs `editor.scroll_anchor.capture`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: ipc.invoke, isTauri: true }),
);

import { useEditorStore, userViewModeCommands } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { ViewMode } from "../src/types/editor";
import { allCommandSequences, checkViewModeLaws } from "./support/viewModeCommandSequences";

interface LoggedPayload {
  event: string;
  context: Record<string, unknown>;
}

function viewModeChangeEntries(): LoggedPayload[] {
  return ipc.invoke.mock.calls
    .filter((call) => (call as unknown[])[0] === "log_event")
    .map((call) => ((call as unknown[])[1] as { payload: LoggedPayload }).payload)
    .filter((payload) => payload.event === "view.mode.change");
}

function choice() {
  return useEditorStore.getState().userViewModeChoice;
}

function seed(viewMode: ViewMode, seq: number, mode: ViewMode): void {
  useEditorStore.setState({ viewMode, userViewModeChoice: { seq, mode } });
}

beforeEach(() => {
  seed("wysiwyg", 0, "wysiwyg");
  useLoggingStore.setState({ enabled: true, level: "debug" });
  useMilkdownEditorStore.setState({ flushers: {} });
  ipc.invoke.mockClear();
});

describe("VMI-00 initial choice value", () => {
  it("a freshly loaded store starts at { seq: 0, mode: 'wysiwyg' }", async () => {
    vi.resetModules();
    const fresh = await import("../src/stores/editorStore");
    expect(fresh.useEditorStore.getState().userViewModeChoice).toEqual({ seq: 0, mode: "wysiwyg" });
    expect(fresh.useEditorStore.getState().viewMode).toBe("wysiwyg");
  });
});

describe("VMI-01 programmatic commands are frame-preserving", () => {
  it.each([
    { name: "setViewMode('source') default intent", run: () => useEditorStore.getState().setViewMode("source"), to: "source" },
    { name: "setViewMode('wysiwyg') default intent, no change", run: () => useEditorStore.getState().setViewMode("wysiwyg"), to: "wysiwyg" },
    { name: "setViewMode('source', 'programmatic')", run: () => useEditorStore.getState().setViewMode("source", "programmatic"), to: "source" },
    { name: "cycleViewMode() default intent", run: () => useEditorStore.getState().cycleViewMode(), to: "source" },
    { name: "cycleViewMode('programmatic')", run: () => useEditorStore.getState().cycleViewMode("programmatic"), to: "source" },
  ] as const)("$name leaves the choice untouched, then a user set still bumps", ({ run, to }) => {
    seed("wysiwyg", 3, "source");
    run();
    expect(choice()).toEqual({ seq: 3, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe(to);

    useEditorStore.getState().setViewMode("wysiwyg", "user");
    expect(choice()).toEqual({ seq: 4, mode: "wysiwyg" });
  });
});

describe("VMI-02 a user set to the current mode still counts (D-3)", () => {
  it.each(["source", "wysiwyg"] as const)("user set %s while already in that mode bumps seq, logs nothing", (mode) => {
    seed(mode, 3, "wysiwyg");
    const before = choice();
    useEditorStore.getState().setViewMode(mode, "user");
    expect(choice()).toEqual({ seq: 4, mode });
    expect(choice()).not.toBe(before);
    expect(useEditorStore.getState().viewMode).toBe(mode);
    expect(viewModeChangeEntries()).toHaveLength(0);
  });
});

describe("VMI-03 a user cycle records the landed mode", () => {
  it.each([
    { from: "wysiwyg", expected: "source" },
    { from: "source", expected: "wysiwyg" },
  ] as const)("cycle from $from lands on $expected", ({ from, expected }) => {
    seed(from, 7, from);
    useEditorStore.getState().cycleViewMode("user");
    expect(useEditorStore.getState().viewMode).toBe(expected);
    expect(choice()).toEqual({ seq: 8, mode: expected });
  });
});

describe("VMI-04 the view.mode.change context is exact and enum-only", () => {
  const W2S = { fromMode: "wysiwyg", toMode: "source" };
  it.each([
    { name: "setViewMode user", run: () => useEditorStore.getState().setViewMode("source", "user"), context: { ...W2S, source: "setViewMode", intent: "user" } },
    { name: "setViewMode default", run: () => useEditorStore.getState().setViewMode("source"), context: { ...W2S, source: "setViewMode", intent: "programmatic" } },
    { name: "cycleViewMode user", run: () => useEditorStore.getState().cycleViewMode("user"), context: { ...W2S, source: "cycleViewMode", intent: "user" } },
    { name: "cycleViewMode default", run: () => useEditorStore.getState().cycleViewMode(), context: { ...W2S, source: "cycleViewMode", intent: "programmatic" } },
    { name: "adapter set with actionId", run: () => userViewModeCommands.set("source", "act-1"), context: { ...W2S, source: "setViewMode", intent: "user" } },
    { name: "adapter cycle with actionId", run: () => userViewModeCommands.cycle("act-2"), context: { ...W2S, source: "cycleViewMode", intent: "user" } },
  ])("$name logs exactly one entry with the exact context", ({ run, context }) => {
    run();
    const entries = viewModeChangeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].context).toEqual(context);
  });

  it("a user set to the current mode logs nothing", () => {
    seed("source", 0, "wysiwyg");
    useEditorStore.getState().setViewMode("source", "user");
    expect(viewModeChangeEntries()).toHaveLength(0);
  });
});

describe("VMI-05 the adapter never reads an actionId as an intent", () => {
  it("set/cycle with and without an actionId all record user choices", () => {
    userViewModeCommands.set("source", "act-1");
    expect(choice()).toEqual({ seq: 1, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe("source");

    userViewModeCommands.cycle("act-2");
    expect(choice()).toEqual({ seq: 2, mode: "wysiwyg" });
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

    userViewModeCommands.set("wysiwyg");
    expect(choice()).toEqual({ seq: 3, mode: "wysiwyg" });
    expect(useEditorStore.getState().viewMode).toBe("wysiwyg");

    userViewModeCommands.cycle();
    expect(choice()).toEqual({ seq: 4, mode: "source" });
    expect(useEditorStore.getState().viewMode).toBe("source");
  });
});

describe("VMI-05b the store fails closed on a non-literal intent", () => {
  it("only the literal 'user' counts", () => {
    const store = () => useEditorStore.getState();
    store().setViewMode("source", "act-1" as never);
    expect(choice()).toEqual({ seq: 0, mode: "wysiwyg" });
    expect(store().viewMode).toBe("source");

    store().cycleViewMode("act-2" as never);
    expect(choice()).toEqual({ seq: 0, mode: "wysiwyg" });
    expect(store().viewMode).toBe("wysiwyg");

    store().setViewMode("wysiwyg", "USER" as never);
    expect(choice()).toEqual({ seq: 0, mode: "wysiwyg" });
    expect(store().viewMode).toBe("wysiwyg");

    store().setViewMode("source", "user");
    expect(choice()).toEqual({ seq: 1, mode: "source" });
  });
});

describe("VMI-05c the adapter's own second argument cannot downgrade it", () => {
  it("passing 'programmatic' as the actionId still records a user choice", () => {
    userViewModeCommands.set("source", "programmatic");
    expect(choice()).toEqual({ seq: 1, mode: "source" });
    userViewModeCommands.cycle("programmatic");
    expect(choice()).toEqual({ seq: 2, mode: "wysiwyg" });
  });
});

describe("VMI-06 counting and agreement law, every sequence of length <= 4", () => {
  const sequences = allCommandSequences(4);

  it("enumerates 1555 sequences", () => {
    expect(sequences).toHaveLength(1 + 6 + 36 + 216 + 1296);
  });

  it("holds after every prefix with the default programmatic intent", () => {
    expect(checkViewModeLaws(sequences, { explicitProgrammatic: false })).toEqual([]);
  });

  it("holds after every prefix with an explicit 'programmatic' intent", () => {
    expect(checkViewModeLaws(sequences, { explicitProgrammatic: true })).toEqual([]);
  });
});

describe("VMI-07 the user intent keeps the flush-on-leaving-WYSIWYG", () => {
  let flushed: string[] = [];
  let cleanup: () => void = () => {};

  beforeEach(() => {
    flushed = [];
    cleanup = useMilkdownEditorStore.getState().registerFlusher(
      "doc-a",
      (reason) => {
        flushed.push(reason);
        return { status: "clean" };
      },
      () => false,
    );
  });

  afterEach(() => {
    cleanup();
  });

  type Action = "set-wysiwyg" | "set-source" | "cycle";
  const rows: { from: ViewMode; action: Action; intent: "user" | "programmatic"; flush: boolean }[] = [];
  for (const from of ["wysiwyg", "source"] as const) {
    for (const action of ["set-wysiwyg", "set-source", "cycle"] as const) {
      for (const intent of ["user", "programmatic"] as const) {
        const target = action === "set-wysiwyg" ? "wysiwyg" : action === "set-source" ? "source" : from === "wysiwyg" ? "source" : "wysiwyg";
        rows.push({ from, action, intent, flush: from === "wysiwyg" && target === "source" });
      }
    }
  }

  it("covers 12 rows, 4 of which flush", () => {
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.flush)).toHaveLength(4);
  });

  it.each(rows)("from $from, $action, $intent intent: flush=$flush", ({ from, action, intent, flush }) => {
    useEditorStore.setState({ viewMode: from });
    const store = useEditorStore.getState();
    if (action === "set-wysiwyg") store.setViewMode("wysiwyg", intent);
    else if (action === "set-source") store.setViewMode("source", intent);
    else store.cycleViewMode(intent);
    expect(flushed).toEqual(flush ? ["view-mode"] : []);
  });
});
