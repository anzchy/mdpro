/**
 * D46 WI-2 — `openDocumentFromPath` reports a non-encoding failure with the ⌘O
 * toast ("Failed to open file"), so an external open of a file over 10 MB is no
 * longer silent.
 *
 * Matrix: `.claude/tdd-guardian/tests-20261003-130127.md`, cases D46-R1..R9.
 *
 * **Law (D46-R3, enumerated domain — fast-check is not a dependency).** For every
 * rejection of `open_file`, exactly one of {EncodingDialog (`encodingIssue` set),
 * one toast emission, a dirty-focus return} happens, and `documentStore.documents`
 * is deep-equal before and after. A resolved open emits no toast.
 *
 * **Toast emissions** = toast-store subscriber calls where `message !== null`
 * (designer finding 5), so two identical reports count as two.
 *
 * **Mocked:** only `@tauri-apps/api/core#invoke` and
 * `@tauri-apps/api/window#getCurrentWindow`. `useDocument`, `useOpenUrlParam`,
 * `useRecentFiles`, every store and the real `loggingService` are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

const { invokeMock, control, win } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  control: {
    /** Answers `open_file`; set per test. */
    openFile: null as null | ((path: string) => Promise<unknown>),
    /** Answers `open_file_dialog`; set per test. */
    dialog: null as null | (() => Promise<unknown>),
  },
  win: { label: "mdpro-abc", close: vi.fn(), destroy: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));

import { useOpenUrlParam } from "../src/hooks/useOpenUrlParam";
import { useDocument } from "../src/hooks/useDocument";
import { useRecentFiles } from "../src/hooks/useRecentFiles";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useToastStore } from "../src/stores/toastStore";
import type { Document } from "../src/types/document";
import { OPEN_FAILED_MESSAGE } from "../src/utils/openFailure";

const MSG = OPEN_FAILED_MESSAGE;
const FTL = { FileTooLarge: { path: "/tmp/big.md", size: 10485761 } };
const T_PATH = "/tmp/t.md";

function doc(id: string, path: string | null, over: Partial<Document> = {}): Document {
  return {
    id,
    path,
    content: `content of ${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...over,
  };
}

async function answer(cmd: unknown, args: unknown): Promise<unknown> {
  if (cmd === "open_file") {
    if (!control.openFile) throw new Error("test did not set control.openFile");
    return control.openFile((args as { path: string }).path);
  }
  if (cmd === "open_file_dialog") {
    if (!control.dialog) throw new Error("test did not set control.dialog");
    return control.dialog();
  }
  return null;
}

const rejectOpenWith = (error: unknown) => {
  control.openFile = () => Promise.reject(error);
};

function recordToastEmissions(): { emissions: string[]; stop: () => void } {
  const emissions: string[] = [];
  const stop = useToastStore.subscribe((s) => {
    if (s.message !== null) emissions.push(s.message);
  });
  return { emissions, stop };
}

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([c]) => c === command);
}

type Payload = { event: string; status: string; context?: Record<string, unknown> } & Record<
  string,
  unknown
>;

function logPayloads(event?: string): Payload[] {
  return callsFor("log_event")
    .map(([, args]) => (args as { payload: Payload }).payload)
    .filter((p) => event === undefined || p.event === event);
}

const activeIds = () => [
  useDocumentStore.getState().activeDocumentId,
  useEditorStore.getState().activeDocumentId,
];

function seed(documents: Document[], activeId: string | null) {
  useDocumentStore.setState({ documents, activeDocumentId: activeId });
  useEditorStore.setState({ activeDocumentId: activeId });
}

function useUrlHarness() {
  const { openDocumentFromPath } = useDocument();
  const { updateRecentFiles } = useRecentFiles();
  useOpenUrlParam({
    preferencesLoaded: true,
    defaultViewMode: "source",
    openDocumentFromPath: (p: string, a?: string) => openDocumentFromPath(p, a),
    setViewMode: (m) => useEditorStore.getState().setViewMode(m),
    updateRecentFiles,
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** R1/R2/R6 setup: `?open=` names a file over 10 MB and `open_file` rejects `FileTooLarge`. */
async function openOverLimitViaUrl() {
  window.history.replaceState({}, "", "/?open=%2Ftmp%2Fbig.md");
  rejectOpenWith(FTL);
  const view = renderHook(() => useUrlHarness());
  await flush();
  await flush();
  return view;
}

function resetAll() {
  useToastStore.getState().clearToast();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  useEditorStore.setState({ activeDocumentId: null, viewMode: "source" });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {} });
}

beforeEach(() => {
  control.openFile = null;
  control.dialog = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(answer);
  win.close.mockReset();
  win.destroy.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  useLoggingStore.setState({ enabled: true, level: "debug" });
  resetAll();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  resetAll();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("D46 — external open (?open=) of a file over 10 MB", () => {
  it("D46-R1 shows the toast, creates nothing, logs one fail, clears the query, keeps the window", async () => {
    await openOverLimitViaUrl();

    expect(useToastStore.getState().message).toBe("Failed to open file");
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(useDocumentStore.getState().activeDocumentId).toBeNull();
    expect(useEditorStore.getState().activeDocumentId).toBeNull();
    const fails = logPayloads("file.open.url_param").filter((p) => p.status === "fail");
    expect(fails).toHaveLength(1);
    expect(window.location.search).toBe("");
    expect(callsFor("set_preferences")).toHaveLength(0);
    // Supplement: the window stays open.
    expect(win.close).not.toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
  });

  it("D46-R2 one failed external open gives exactly one toast emission", async () => {
    const rec = recordToastEmissions();
    try {
      await openOverLimitViaUrl();
      expect(rec.emissions).toEqual([MSG]);
    } finally {
      rec.stop();
    }
  });

  it("D46-R6 privacy: no path in the toast, and the logs carry only the basename", async () => {
    await openOverLimitViaUrl();

    const message = useToastStore.getState().message;
    expect(message).toBe(OPEN_FAILED_MESSAGE);
    expect(message).not.toContain("/");
    expect(message).not.toContain("big.md");

    const payloads = logPayloads();
    expect(payloads.length).toBeGreaterThan(0);
    expect(JSON.stringify(payloads)).not.toContain("/tmp/big.md");
    expect(payloads.some((p) => p.context?.fileBasename === "big.md")).toBe(true);
    for (const p of payloads) {
      const { fileBasename: _basename, ...rest } = p.context ?? {};
      const stripped = JSON.stringify({ ...p, context: rest });
      expect(stripped, `${p.event}/${p.status}`).not.toContain("big.md");
    }
  });
});

describe("D46 — useDocument.openDocumentFromPath directly", () => {
  it("D46-R3 exactly one signal, documents conserved, over rejection × store state", async () => {
    type Row = [label: string, error: unknown, encoding: null | { path: string; detected: string }];
    const rows: Row[] = [
      ["FileNotFound", { FileNotFound: { path: "/p" } }, null],
      ["PermissionDenied", { PermissionDenied: { path: "/p" } }, null],
      ["FileTooLarge", FTL, null],
      ["InvalidPath", { InvalidPath: { path: "/p" } }, null],
      ["IoError", { IoError: { message: "boom" } }, null],
      ["DiskFull", "DiskFull", null],
      ["null", null, null],
      ["undefined", undefined, null],
      ["plain string", "plain", null],
      ["Error ENOENT", new Error("ENOENT"), null],
      [
        "EncodingError object",
        { EncodingError: { path: T_PATH, detected: "GBK" } },
        { path: T_PATH, detected: "GBK" },
      ],
      ["EncodingError message", new Error("EncodingError: x"), { path: T_PATH, detected: "unknown" }],
    ];
    type Column = [label: string, documents: () => Document[], active: string | null];
    const columns: Column[] = [
      ["(a) empty", () => [], null],
      ["(b) clean t + active doc-b", () => [doc("t", T_PATH), doc("doc-b", "/tmp/b.md")], "doc-b"],
      [
        "(c) dirty t + active doc-b",
        () => [doc("t", T_PATH, { isModified: true, content: "mine" }), doc("doc-b", "/tmp/b.md")],
        "doc-b",
      ],
    ];

    let cells = 0;
    for (const [rowLabel, error, encoding] of rows) {
      for (const [colLabel, documents, active] of columns) {
        const label = `${rowLabel} × ${colLabel}`;
        resetAll();
        seed(documents(), active);
        rejectOpenWith(error);
        const before = structuredClone(useDocumentStore.getState().documents);
        const { result, unmount } = renderHook(() => useDocument());
        const rec = recordToastEmissions();
        let returned: Document | null = null;
        try {
          await act(async () => {
            returned = await result.current.openDocumentFromPath(T_PATH);
          });
        } finally {
          rec.stop();
        }
        const issue = result.current.encodingIssue;
        const signals = rec.emissions.length + (issue ? 1 : 0) + (returned !== null ? 1 : 0);
        expect(signals, `${label}: signals`).toBe(1);
        expect(useDocumentStore.getState().documents, `${label}: documents`).toEqual(before);

        const dirtyColumn = colLabel.startsWith("(c)");
        if (encoding === null) {
          expect(rec.emissions, `${label}: emissions`).toEqual([MSG]);
          expect(issue, `${label}: encodingIssue`).toBeNull();
          expect(returned, `${label}: returned`).toBeNull();
          expect(activeIds(), `${label}: active`).toEqual([active, active]);
        } else if (!dirtyColumn) {
          expect(rec.emissions, `${label}: emissions`).toEqual([]);
          expect(issue, `${label}: encodingIssue`).toEqual(encoding);
          expect(returned, `${label}: returned`).toBeNull();
          expect(activeIds(), `${label}: active`).toEqual([active, active]);
        } else {
          expect(rec.emissions, `${label}: emissions`).toEqual([]);
          expect(issue, `${label}: encodingIssue`).toBeNull();
          expect(returned, `${label}: returned`).toEqual(before.find((d) => d.id === "t"));
          expect(activeIds(), `${label}: active`).toEqual(["t", "t"]);
        }
        unmount();
        cells += 1;
      }
    }
    expect(cells).toBe(36);
  });

  it("D46-R4 the dirty-focus exit returns the dirty doc and shows no toast", async () => {
    seed([doc("t", T_PATH, { isModified: true, content: "mine" }), doc("doc-b", "/tmp/b.md")], "doc-b");
    rejectOpenWith(new Error("EncodingError: x"));
    const { result } = renderHook(() => useDocument());
    const rec = recordToastEmissions();
    let returned: Document | null = null;
    await act(async () => {
      returned = await result.current.openDocumentFromPath(T_PATH);
    });
    rec.stop();

    expect(returned).toEqual(doc("t", T_PATH, { isModified: true, content: "mine" }));
    expect(rec.emissions).toEqual([]);
    expect(result.current.encodingIssue).toBeNull();
    expect(activeIds()).toEqual(["t", "t"]);
  });

  it("D46-R5 control: a written open and a focused-dirty open never toast", async () => {
    control.openFile = async (path) => ({ document: doc("d1", path), recoveredDraft: null });

    // (i) empty store → written.
    const first = renderHook(() => useDocument());
    const rec1 = recordToastEmissions();
    await act(async () => {
      await first.result.current.openDocumentFromPath("/tmp/ok.md");
    });
    rec1.stop();
    expect(rec1.emissions, "(i) emissions").toEqual([]);
    expect(useDocumentStore.getState().documents.map((d) => d.id), "(i) documents").toEqual(["d1"]);
    expect(activeIds(), "(i) active").toEqual(["d1", "d1"]);
    first.unmount();

    // (ii) dirty d1 at the same path → focused-dirty, content kept.
    resetAll();
    seed([doc("d1", "/tmp/ok.md", { isModified: true, content: "mine" })], null);
    const second = renderHook(() => useDocument());
    const rec2 = recordToastEmissions();
    await act(async () => {
      await second.result.current.openDocumentFromPath("/tmp/ok.md");
    });
    rec2.stop();
    expect(rec2.emissions, "(ii) emissions").toEqual([]);
    expect(useDocumentStore.getState().documents.map((d) => d.content), "(ii) content").toEqual(["mine"]);
    expect(activeIds(), "(ii) active").toEqual(["d1", "d1"]);
  });

  it("D46-R7 two failures in a row: two emissions, one visible message, one timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rejectOpenWith(FTL);
    const { result } = renderHook(() => useDocument());
    const rec = recordToastEmissions();
    try {
      await act(async () => {
        await result.current.openDocumentFromPath("/tmp/big.md");
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      await act(async () => {
        await result.current.openDocumentFromPath("/tmp/big.md");
      });
      act(() => {
        vi.advanceTimersByTime(2999); // t = 3999
      });
      expect(useToastStore.getState().message, "t=3999").toBe(MSG);
      act(() => {
        vi.advanceTimersByTime(1); // t = 4000
      });
      expect(useToastStore.getState().message, "t=4000").toBeNull();
      expect(rec.emissions).toEqual([MSG, MSG]);
    } finally {
      rec.stop();
    }
  });

  it("D46-R8 a malformed IPC success (no document) counts as a failed open", async () => {
    control.openFile = async () => ({});
    const { result } = renderHook(() => useDocument());
    const before = useDocumentStore.getState().documents;
    const rec = recordToastEmissions();
    let returned: Document | null = doc("sentinel", null);
    await act(async () => {
      returned = await result.current.openDocumentFromPath("/tmp/odd.md");
    });
    rec.stop();

    expect(returned).toBeNull();
    expect(rec.emissions).toEqual([MSG]);
    expect(useDocumentStore.getState().documents).toEqual(before);
    expect(result.current.encodingIssue).toBeNull();
  });
});

describe("D46 — ⌘O stays on its own path", () => {
  it("D46-R9 openDocumentFromDialog re-throws and never toasts", async () => {
    const { result } = renderHook(() => useDocument());
    const rec = recordToastEmissions();
    try {
      // (i) cancel.
      control.dialog = async () => null;
      let out: Document | null = doc("sentinel", null);
      await act(async () => {
        out = await result.current.openDocumentFromDialog();
      });
      expect(out, "(i) cancel").toBeNull();
      expect(rec.emissions, "(i) emissions").toEqual([]);

      // (ii) non-encoding rejection: the same reference is re-thrown.
      control.dialog = () => Promise.reject(FTL);
      let caught: unknown = null;
      await act(async () => {
        await result.current.openDocumentFromDialog().catch((e: unknown) => {
          caught = e;
        });
      });
      expect(caught, "(ii) rethrow").toBe(FTL);
      expect(rec.emissions, "(ii) emissions").toEqual([]);

      // (iii) encoding rejection: EncodingDialog, no toast.
      control.dialog = () => Promise.reject({ EncodingError: { path: "/a.md", detected: "GBK" } });
      out = doc("sentinel", null);
      await act(async () => {
        out = await result.current.openDocumentFromDialog();
      });
      expect(out, "(iii) returned").toBeNull();
      expect(result.current.encodingIssue, "(iii) encodingIssue").toEqual({
        path: "/a.md",
        detected: "GBK",
      });
      expect(rec.emissions, "(iii) emissions").toEqual([]);
    } finally {
      rec.stop();
    }
  });
});

// D46-LOG — the reported failure leaves a frontend log line on the external route.
describe("D46 — the reported failure is logged without the path", () => {
  it("D46-R10 the R1 route logs exactly one file.open.report fail, reason FileTooLarge, same actionId", async () => {
    await openOverLimitViaUrl();

    const reports = logPayloads("file.open.report");
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("fail");
    expect(reports[0].level).toBe("error");
    expect(reports[0].context).toEqual({ reason: "FileTooLarge" });
    const urlFail = logPayloads("file.open.url_param").find((p) => p.status === "fail");
    expect(reports[0].actionId).toBe(urlFail?.actionId);
    const json = JSON.stringify(reports[0]);
    expect(json).not.toContain("/");
    expect(json).not.toContain("10485761");
  });
});
