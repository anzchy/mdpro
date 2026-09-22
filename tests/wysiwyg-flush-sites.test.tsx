/**
 * D15 WI-3 — every decision point flushes pending WYSIWYG edits before it reads.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260922-163219.md`, cases S-save-immediate,
 * S-saveas-immediate, S-save-table, X-viewmode-set, X-viewmode-cycle, X-switch-set,
 * X-close-doc, X-close-active, X-retention-all, G1, G2. The matrix homes these in
 * `tests/wysiwyg-edit-persistence.test.tsx`; they live here instead so that file stays
 * byte-identical to the WI-2 receipt that fingerprinted it.
 *
 * Real `MilkdownEditor`, real serializer, real stores, real `useDocument`. Only process
 * boundaries are mocked: `@tauri-apps/api/{core,event,window}` and `loggingService`.
 *
 * Matrix §0.7: "no timer advance" — every read below happens inside the same `act` as the
 * keystroke, so the 200 ms debounce can never be what makes a case pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Editor } from "@milkdown/kit/core";
import { MilkdownEditor } from "../src/components/Editor/MilkdownEditor";
import { useDocument } from "../src/hooks/useDocument";
import { performSave } from "../src/services/saveService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { installIntersectionObserverDouble } from "./helpers/intersectionObserverDouble";
import {
  docById,
  makeDoc,
  mountAndWait,
  resetStores,
  sleep,
  typeAtEnd,
} from "./helpers/milkdownEditorHarness";

const LONG_CASE_MS = 60_000;
const SAVED_AT = 1_700_000_000_000;
const A_PATH = "/tmp/a.md";
const DIALOG_PATH = "/tmp/chosen.md";

type DocumentApi = ReturnType<typeof useDocument>;
let api: DocumentApi | null = null;
function Probe() {
  api = useDocument();
  return null;
}

const docA = () => docById("doc-a")!;
const ipcContents = (cmd: string): string[] =>
  invokeMock.mock.calls
    .filter(([c]) => c === cmd)
    .map(([, args]) => String((args as { content?: string }).content));

function twoDocs(aPath: string | null, aContent = "Hello world") {
  return [makeDoc("doc-a", aContent, aPath), makeDoc("doc-b", "Other")];
}

async function mountWithProbe(): Promise<{ instance: Editor; unmount: () => void }> {
  return mountAndWait(
    <>
      <MilkdownEditor />
      <Probe />
    </>,
  );
}

/** Unmount the previous row's editor, let its async destroy finish, reset. */
async function nextRow(unmount: (() => void) | null, docs = twoDocs(A_PATH)): Promise<void> {
  if (unmount) {
    unmount();
    await sleep(100);
  }
  resetStores(docs);
  invokeMock.mockClear();
}

beforeEach(() => {
  api = null;
  installIntersectionObserverDouble();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "save_file") return { success: true, path: A_PATH, savedAt: SAVED_AT };
    if (cmd === "save_file_dialog") return { success: true, path: DIALOG_PATH, savedAt: SAVED_AT };
    return null;
  });
  resetStores(twoDocs(A_PATH));
});

afterEach(() => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
});

describe("S — save flushes before it reads (L-S1, L-S2)", () => {
  it("S-save-immediate an edit typed just before ⌘S is in the saved bytes", async () => {
    const { instance } = await mountWithProbe();
    await act(async () => {
      typeAtEnd(instance, "SAVED");
      await api!.saveActiveDocument();
    });
    expect(ipcContents("save_file")).toHaveLength(1);
    expect(ipcContents("save_file")[0]).toContain("SAVED");
    expect(docA().isModified).toBe(false);
    expect(docA().content).toContain("SAVED");
  });

  it("S-saveas-immediate an untitled document routed to Save As carries the edit", async () => {
    resetStores(twoDocs(null));
    const { instance } = await mountWithProbe();
    await act(async () => {
      typeAtEnd(instance, "ASNEW");
      await api!.saveActiveDocument();
    });
    expect(ipcContents("save_file_dialog")).toHaveLength(1);
    expect(ipcContents("save_file_dialog")[0]).toContain("ASNEW");
    expect(docA().isModified).toBe(false);
    expect(docA().content).toContain("ASNEW");
  });

  type Entry = { name: string; path: string | null; ipc: string; direct: boolean };
  const ENTRIES: Entry[] = [
    { name: "save(path)", path: A_PATH, ipc: "save_file", direct: false },
    { name: "save(null path)", path: null, ipc: "save_file_dialog", direct: false },
    { name: "saveAs(direct)", path: A_PATH, ipc: "save_file_dialog", direct: true },
  ];

  it(
    "S-save-table both save laws hold over every save entry point",
    async () => {
      let unmount: (() => void) | null = null;
      const hitIpcs = new Set<string>();
      for (const [i, entry] of ENTRIES.entries()) {
        const row = `entry=${entry.name}/outcome=pending-edit`;
        await nextRow(unmount, twoDocs(entry.path));
        const mounted = await mountWithProbe();
        unmount = mounted.unmount;
        const token = `T${i + 1}`;
        await act(async () => {
          typeAtEnd(mounted.instance, token);
          if (entry.direct) await api!.saveActiveDocumentAs();
          else await api!.saveActiveDocument();
        });
        const payloads = ipcContents(entry.ipc);
        expect(payloads, row).toHaveLength(1);
        expect(payloads[0], row).toContain(token);
        expect(docA().isModified, row).toBe(false);
        expect(docA().content, row).toContain(token);
        hitIpcs.add(entry.ipc);
      }
      expect(hitIpcs, "non-vacuity: both save IPCs exercised").toEqual(
        new Set(["save_file", "save_file_dialog"]),
      );

      for (const entry of ENTRIES) {
        const row = `entry=${entry.name}/outcome=failed`;
        await nextRow(unmount, [
          { ...makeDoc("doc-a", "BASE", entry.path), isModified: true },
          makeDoc("doc-b", "Other"),
        ]);
        unmount = null;
        const { unmount: probeUnmount } = await mountProbeOnly();
        useMilkdownEditorStore.getState().registerFlusher("doc-a", () => ({ status: "failed" }));
        const showToast = vi.fn();
        if (entry.direct) {
          await expect(api!.saveActiveDocumentAs(), row).rejects.toThrow(/./);
        } else {
          await performSave(undefined, {
            markSaveInProgress: vi.fn(),
            saveActiveDocument: api!.saveActiveDocument,
            updateRecentFiles: vi.fn(),
            showToast,
          });
          const toasts = showToast.mock.calls.map(([m]) => String(m));
          expect(toasts.some((m) => m.startsWith("Save failed:")), row).toBe(true);
          expect(toasts, row).not.toContain("Saved");
        }
        expect(ipcContents("save_file"), row).toEqual([]);
        expect(ipcContents("save_file_dialog"), row).toEqual([]);
        expect(docA().isModified, row).toBe(true);
        expect(docA().content, row).toBe("BASE");
        probeUnmount();
      }
    },
    LONG_CASE_MS,
  );
});

async function mountProbeOnly(): Promise<{ unmount: () => void }> {
  const { unmount } = render(<Probe />);
  await sleep(0);
  expect(api, "useDocument probe never rendered").not.toBeNull();
  return { unmount };
}

describe("X — view-mode and tab transitions flush first (L-V1, L-D1, L-D2)", () => {
  it("X-viewmode-set typing then ⌃2 with no timer advance", async () => {
    const { instance } = await mountAndWait();
    await act(async () => {
      typeAtEnd(instance, "VM");
      useEditorStore.getState().setViewMode("source");
      expect(docA().content).toContain("VM");
    });
  });

  it("X-viewmode-cycle typing then cycleViewMode with no timer advance", async () => {
    const { instance } = await mountAndWait();
    await act(async () => {
      typeAtEnd(instance, "VM");
      useEditorStore.getState().cycleViewMode();
      expect(docA().content).toContain("VM");
    });
  });

  it(
    "X-switch-set setActiveDocument / setActiveDocumentId keep the edit on the old doc",
    async () => {
      let unmount: (() => void) | null = null;
      const switches: Array<[string, () => void]> = [
        ["setActiveDocument", () => useDocumentStore.getState().setActiveDocument("doc-b")],
        ["setActiveDocumentId", () => useDocumentStore.getState().setActiveDocumentId("doc-b")],
      ];
      for (const [name, doSwitch] of switches) {
        await nextRow(unmount);
        const mounted = await mountAndWait();
        unmount = mounted.unmount;
        await act(async () => {
          typeAtEnd(mounted.instance, "TS");
          doSwitch();
          expect(docA().content, name).toContain("TS");
          expect(docById("doc-b")!.content, name).toBe("Other");
          expect(useDocumentStore.getState().activeDocumentId, name).toBe("doc-b");
        });
      }
    },
    LONG_CASE_MS,
  );

  it("X-close-doc closing a background tab keeps the active tab's pending edit", async () => {
    resetStores([makeDoc("doc-a", "Hello world"), makeDoc("doc-b", "Other"), makeDoc("doc-c", "C")]);
    const { instance } = await mountAndWait();
    await act(async () => {
      typeAtEnd(instance, "KEEP");
      useDocumentStore.getState().closeDocument("doc-c");
      expect(docA().content, "synchronously").toContain("KEEP");
    });
    await sleep(400);
    expect(docA().content, "after settle").toContain("KEEP");
    expect(docById("doc-c")).toBeUndefined();
  });

  it("X-close-active the edit reaches the doc before the emission that removes it", async () => {
    const { instance } = await mountAndWait();
    const emissions: Array<{ present: boolean; hasBye: boolean }> = [];
    const unsubscribe = useDocumentStore.subscribe((state) => {
      const a = state.documents.find((d) => d.id === "doc-a");
      emissions.push({ present: Boolean(a), hasBye: Boolean(a?.content.includes("BYE")) });
    });
    try {
      await act(async () => {
        typeAtEnd(instance, "BYE");
        useDocumentStore.getState().closeDocument("doc-a");
      });
    } finally {
      unsubscribe();
    }
    const removedAt = emissions.findIndex((e) => !e.present);
    const byeAt = emissions.findIndex((e) => e.present && e.hasBye);
    expect(removedAt, "doc-a was never removed").toBeGreaterThanOrEqual(0);
    expect(byeAt, "doc-a never held BYE while open").toBeGreaterThanOrEqual(0);
    expect(byeAt).toBeLessThan(removedAt);
    expect(useDocumentStore.getState().activeDocumentId).toBe("doc-b");
    expect(docById("doc-b")!.content).toBe("Other");
  });
});

type Site = {
  name: string;
  aPath: string | null;
  /** Runs the site and returns the text found where the site reads. */
  run: () => Promise<string>;
};

const lastIpc = (cmd: string) => {
  const xs = ipcContents(cmd);
  return xs[xs.length - 1] ?? "<no IPC>";
};
const SITES: Site[] = [
  { name: "save", aPath: A_PATH, run: async () => (await api!.saveActiveDocument(), lastIpc("save_file")) },
  {
    name: "save-as (routed)",
    aPath: null,
    run: async () => (await api!.saveActiveDocument(), lastIpc("save_file_dialog")),
  },
  {
    name: "save-as (direct)",
    aPath: A_PATH,
    run: async () => (await api!.saveActiveDocumentAs(), lastIpc("save_file_dialog")),
  },
  { name: "setViewMode", aPath: A_PATH, run: async () => (useEditorStore.getState().setViewMode("source"), docA().content) },
  { name: "cycleViewMode", aPath: A_PATH, run: async () => (useEditorStore.getState().cycleViewMode(), docA().content) },
  {
    name: "setActiveDocument",
    aPath: A_PATH,
    run: async () => (useDocumentStore.getState().setActiveDocument("doc-b"), docA().content),
  },
  {
    name: "setActiveDocumentId",
    aPath: A_PATH,
    run: async () => (useDocumentStore.getState().setActiveDocumentId("doc-b"), docA().content),
  },
  {
    name: "closeDocument (other tab)",
    aPath: A_PATH,
    run: async () => (useDocumentStore.getState().closeDocument("doc-b"), docA().content),
  },
];

describe("X-retention-all — flush-before-transition at every decision point", () => {
  it(
    "X-retention-all the token is present where each site reads",
    async () => {
      let unmount: (() => void) | null = null;
      for (const [i, site] of SITES.entries()) {
        await nextRow(unmount, twoDocs(site.aPath));
        const mounted = await mountWithProbe();
        unmount = mounted.unmount;
        const token = `R${i}`;
        let seen = "";
        await act(async () => {
          typeAtEnd(mounted.instance, token);
          seen = await site.run();
        });
        expect(seen, `site=${site.name}`).toContain(token);
      }
    },
    LONG_CASE_MS,
  );
});
