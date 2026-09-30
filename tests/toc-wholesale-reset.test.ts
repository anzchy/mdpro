/**
 * WI-3.5.5 — `tocStore.resetCoordination(documentId)` and the wholesale-path wiring.
 *
 * Matrix: `.claude/tdd-guardian/tests-20260918-214500.md` §R (R0-R5) and §W
 * (W1, W2, W3, W4, W6, W7, W8). W5 — the source-derived partition — lives in
 * `tests/wholesale-path-partition.test.ts`, because it reads the filesystem and shares
 * no fixtures with these behavioural cases.
 *
 * ---------------------------------------------------------------------------
 * Why every §W behavioural case lives in ONE file
 * ---------------------------------------------------------------------------
 * Matrix §0 rule 6 requires each reset case to carry its preservation control **in the
 * same file**: a control in a sibling file can be deleted, skipped or reordered without
 * the reset case noticing, and a reset case with no live control passes trivially on any
 * implementation that resets unconditionally. R0 is the control for R1/R2/W4 and W8 is
 * the control for W6/W7, so R and W are kept together rather than split by hook.
 *
 * ---------------------------------------------------------------------------
 * Deviations from the matrix, recorded rather than silently taken
 * ---------------------------------------------------------------------------
 * 1. **`App.handleRecoverDraft` (W7) and `App.handleImageDrop` (W8) are driven one layer
 *    down.** Both are `useCallback`s inside `src/App.tsx`, and nothing in `tests/` renders
 *    `App` — it pulls in Milkdown, CodeMirror, the Tauri menu bridge and the file watcher,
 *    none of which stand up in jsdom. W7 therefore drives `useDocument().
 *    upsertAndActivateDocument` with the exact `Document` literal `App.tsx:632-641`
 *    builds, which is where the plan puts the wiring ("wire at the hook, not at the
 *    App.tsx caller"). W8's two image-drop arms drive the exact store call the two
 *    branches make. W5 is what keeps that honest: it pins that those call sites still
 *    read `updateDocumentContent(currentDoc.id, nextContent)` and are still classified
 *    `ordinary`, so if App.tsx changes shape this pair goes red.
 * 2. **Heading lists are written as specs, not parsed from markdown.** The matrix writes
 *    `setEntries(headingsOf(content), …)`. Running the real parser here would make these
 *    cases depend on `tocService`'s slugging, which §M already covers; the heading list
 *    is the input to the store either way. The markdown strings the documents carry are
 *    kept consistent with the specs so the fixtures read honestly.
 *
 * Constraints honoured (matrix §0): every case is lane `unit`; no new dependency; mocks
 * only at `@tauri-apps/api/{core,event,window}`, `src/services/loggingService` and the
 * Milkdown `replaceAll` transport. `tocStore`, `documentStore`, `editorStore`, the
 * matcher and both hooks are real. No literal key string is ever asserted (§0 rule 5) —
 * every expectation is distinctness / membership / absence against keys the store minted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";

// --- boundary mocks -------------------------------------------------------

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const eventListeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
    eventListeners.set(name, cb);
    return () => eventListeners.delete(name);
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const logEventSyncMock = vi.fn();
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: (...args: unknown[]) => logEventSyncMock(...args),
    logEvent: async () => undefined,
    generateActionId: () => "test-action-id",
  },
}));

vi.mock("@milkdown/kit/utils", () => ({
  replaceAll: (markdown: string) => () => markdown,
}));

import { asAnchorSlug } from "../src/types/toc";
import type { HeadingKey, ParsedTOCEntry } from "../src/types/toc";
import { useTOCStore } from "../src/stores/tocStore";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useDocument } from "../src/hooks/useDocument";
import { useMcpEvents, processTableActionEvent } from "../src/hooks/useMcpEvents";
import {
  createEditSyncController,
  EDIT_SYNC_DELAY_MS,
} from "../src/plugins/milkdown/editSync/controller";
import type { Document } from "../src/types/document";

// --- heading fixtures -----------------------------------------------------

type Level = 1 | 2 | 3 | 4 | 5 | 6;
interface HeadingSpec {
  level: Level;
  text: string;
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-");
}

function parsed(specs: readonly HeadingSpec[]): ParsedTOCEntry[] {
  return specs.map((spec, index) => ({
    anchorSlug: asAnchorSlug(slugOf(spec.text)),
    level: spec.level,
    text: spec.text,
    lineNumber: index * 2 + 1,
    offset: index * 10,
  }));
}

function keysNow(): HeadingKey[] {
  return useTOCStore.getState().entries.map((e) => e.key);
}

function setEntries(specs: readonly HeadingSpec[], documentId: string | null): void {
  useTOCStore.getState().setEntries(parsed(specs), documentId);
}

const GUIDE_INTRO: readonly HeadingSpec[] = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Intro" },
];
const GUIDE_INTRO_ADDED: readonly HeadingSpec[] = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Intro" },
  { level: 2, text: "Added" },
];
const ABC: readonly HeadingSpec[] = [
  { level: 1, text: "Guide" },
  { level: 2, text: "Intro" },
  { level: 2, text: "Setup" },
];

const DOC_ID = "doc-hash-1";
const DOC_PATH = "/tmp/a.md";
// Carries a table so the MCP `table_action` row has something to actually edit —
// without one, `applyMcpTableAction` returns null, the handler early-returns, and that
// row's "preserves" assertion passes without any edit having happened.
const OLD_CONTENT = "# Guide\n\n## Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
const NEW_CONTENT = "# Guide\n\n## Intro\n\n## Added\n";

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    path: DOC_PATH,
    content: OLD_CONTENT,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  };
}

// --- shared assertions ----------------------------------------------------

/**
 * The annihilation assertion shared by R1, W3, W4, W6, W7 and W1's `yes` rows.
 *
 * The headings handed to the follow-up `setEntries` are byte-identical to the ones the
 * store already held, so a *correct matcher* would preserve every key. Three all-new
 * keys can therefore only come from a genuine reset — which is what makes this stronger
 * than "collapse is empty" (matrix §0 rule 6).
 */
function expectAnnihilated(
  documentId: string,
  before: ReadonlySet<HeadingKey>,
  specs: readonly HeadingSpec[],
  label: string,
): void {
  setEntries(specs, documentId);
  const s = useTOCStore.getState();
  expect(s.collapsedIds.size, `${label}: collapse survived a wholesale replacement`).toBe(0);
  expect(s.activeEntryId, `${label}: the active entry survived a wholesale replacement`).toBeNull();
  for (const entry of s.entries) {
    expect(
      before.has(entry.key),
      `${label}: key for "${entry.text}" was carried across the reset`,
    ).toBe(false);
  }
  expect(
    s.byDocument.has(documentId),
    `${label}: the archive entry was not evicted`,
  ).toBe(false);
}

/** The preservation assertion shared by R0, W1's `no` rows and W8. */
function expectPreserved(
  documentId: string,
  specs: readonly HeadingSpec[],
  preserved: HeadingKey,
  label: string,
): void {
  setEntries(specs, documentId);
  const s = useTOCStore.getState();
  expect(
    s.entries.some((e) => e.key === preserved),
    `${label}: the key was re-minted — an ordinary edit reset coordination`,
  ).toBe(true);
  expect(
    s.collapsedIds.has(preserved),
    `${label}: collapse was dropped by an ordinary edit`,
  ).toBe(true);
}

/** Seed the TOC store for `documentId`, collapse + activate `index`, return all keys. */
function seedCollapsed(
  specs: readonly HeadingSpec[],
  documentId: string,
  index: number,
): { keys: HeadingKey[]; collapsed: HeadingKey; before: Set<HeadingKey> } {
  setEntries(specs, documentId);
  const keys = keysNow();
  const collapsed = keys[index];
  useTOCStore.getState().toggleCollapsed(collapsed);
  useTOCStore.getState().setActiveEntry(collapsed);
  return { keys, collapsed, before: new Set(keys) };
}

// --- boundary wiring ------------------------------------------------------

let preferences: Record<string, unknown>;

function routeInvoke(command: string): unknown {
  switch (command) {
    case "open_file":
    case "open_file_dialog":
      return { document: makeDoc({ content: NEW_CONTENT }), recoveredDraft: null };
    case "create_document":
      return makeDoc({ content: NEW_CONTENT });
    case "reload_file":
      return makeDoc({ content: NEW_CONTENT });
    case "close_document":
      return { success: true, draftDeleted: false };
    case "save_file":
      return { success: true, path: DOC_PATH, savedAt: 1 };
    case "save_file_dialog":
      return { success: true, path: "/tmp/b.md", savedAt: 1 };
    case "get_preferences":
      return preferences;
    default:
      return null;
  }
}

beforeEach(() => {
  eventListeners.clear();
  logEventSyncMock.mockReset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => routeInvoke(command));
  preferences = { markdown: { autoReformatTablesOnSave: false } };

  useTOCStore.setState({
    entries: [],
    documentId: null,
    activeEntryId: null,
    isVisible: false,
    collapsedIds: new Set<HeadingKey>(),
    byDocument: new Map(),
  });
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  // D35: reset viewMode too, so a row that sets "source" cannot leak into later rows.
  useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
});

/** Render `useDocument` against the store as it stands, then run `fn` inside `act`. */
async function withDocumentHook(
  // `unknown`, not `void | Promise<void>`: most of these helpers resolve to a `Document`
  // or a `SaveResult`, and narrowing the return type would force a `void (...)` wrapper
  // at every call site for no gain.
  fn: (api: ReturnType<typeof useDocument>) => unknown,
): Promise<void> {
  const { result } = renderHook(() => useDocument());
  await act(async () => {
    await fn(result.current);
  });
}

/** Mount `useMcpEvents` and emit a payload through the real `listen` registration. */
async function emitMcp(eventName: string, payload: unknown): Promise<void> {
  renderHook(() => useMcpEvents());
  await act(async () => {});
  const handler = eventListeners.get(eventName);
  expect(handler, `no listener registered for ${eventName}`).toBeTypeOf("function");
  await act(async () => {
    handler!({ payload });
  });
}

function seedDocumentStore(doc: Document = makeDoc()): void {
  useDocumentStore.setState({ documents: [doc], activeDocumentId: doc.id });
}

// ===========================================================================
// §R — resetCoordination
// ===========================================================================

describe("R — resetCoordination", () => {
  it("R0 (control) an identical re-parse with NO reset preserves keys and collapse", () => {
    setEntries(ABC, "doc-a");
    const before = keysNow();
    useTOCStore.getState().toggleCollapsed(before[1]);

    setEntries(ABC, "doc-a");

    expect(keysNow(), "the matcher re-minted keys for an unchanged heading list").toEqual(
      before,
    );
    expect(
      useTOCStore.getState().collapsedIds.has(before[1]),
      "collapse was dropped without any reset — every R/W reset case below is now vacuous",
    ).toBe(true);
  });

  it("R1 a reload under an UNCHANGED document id still resets", () => {
    const { before } = seedCollapsed(ABC, "doc-a", 1);
    const keys = keysNow();
    useTOCStore.getState().toggleCollapsed(keys[0]);
    useTOCStore.getState().toggleCollapsed(keys[2]);
    expect(useTOCStore.getState().collapsedIds.size, "fixture did not collapse three").toBe(3);

    useTOCStore.getState().resetCoordination("doc-a");

    expectAnnihilated("doc-a", before, ABC, "R1");
  });

  it("R2 reset discards, never transfers — reordered and renamed", () => {
    const three: readonly HeadingSpec[] = [
      { level: 2, text: "A" },
      { level: 2, text: "B" },
      { level: 2, text: "C" },
    ];
    const { before } = seedCollapsed(three, "doc-a", 1);

    useTOCStore.getState().resetCoordination("doc-a");

    const shuffled: readonly HeadingSpec[] = [
      { level: 2, text: "C renamed" },
      { level: 2, text: "A" },
      { level: 2, text: "B" },
    ];
    setEntries(shuffled, "doc-a");

    const s = useTOCStore.getState();
    expect(s.collapsedIds.size, "collapse transferred across a reset").toBe(0);
    for (const entry of s.entries) {
      expect(before.has(entry.key), `key for "${entry.text}" was transferred`).toBe(false);
    }
  });

  it("R3 (law R-L2) reset is scoped to one document", () => {
    setEntries(GUIDE_INTRO, "doc-a");
    const aKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(aKeys[1]);

    setEntries(ABC, "doc-b");
    const bKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(bKeys[2]);

    setEntries(GUIDE_INTRO, "doc-a");
    const aBefore = new Set(keysNow());

    useTOCStore.getState().resetCoordination("doc-a");

    setEntries(ABC, "doc-b");
    const s = useTOCStore.getState();
    expect(keysNow(), "doc-b's keys were disturbed by doc-a's reset").toEqual(bKeys);
    expect(s.collapsedIds.has(bKeys[2]), "doc-b's collapse was cleared by doc-a's reset").toBe(
      true,
    );
    expect(s.collapsedIds.size, "doc-b gained collapse state it never had").toBe(1);

    setEntries(GUIDE_INTRO, "doc-a");
    for (const entry of useTOCStore.getState().entries) {
      expect(aBefore.has(entry.key), "doc-a was not annihilated").toBe(false);
    }
  });

  it("R4 (law R-L3) idempotent, tolerant of an unseen id, one log event per call", () => {
    seedCollapsed(ABC, "doc-a", 1);

    useTOCStore.getState().resetCoordination("doc-a");
    const first = useTOCStore.getState();
    const afterFirst = {
      entries: first.entries,
      documentId: first.documentId,
      activeEntryId: first.activeEntryId,
      collapsedIds: [...first.collapsedIds],
      byDocument: [...first.byDocument.entries()],
    };

    useTOCStore.getState().resetCoordination("doc-a");
    const second = useTOCStore.getState();
    expect({
      entries: second.entries,
      documentId: second.documentId,
      activeEntryId: second.activeEntryId,
      collapsedIds: [...second.collapsedIds],
      byDocument: [...second.byDocument.entries()],
    }).toEqual(afterFirst);

    expect(() => useTOCStore.getState().resetCoordination("doc-zzz")).not.toThrow();
    expect(
      useTOCStore.getState().byDocument.has("doc-zzz"),
      "resetting an unseen id created an archive entry",
    ).toBe(false);

    const resetLogs = logEventSyncMock.mock.calls.filter(
      ([payload]) => (payload as { event?: string })?.event === "ui.toc.coordination.reset",
    );
    expect(resetLogs.length, "one ui.toc.coordination.reset per call, no more, no fewer").toBe(
      3,
    );
  });

  it("R5 archive does not grow across 50 open/close cycles", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = `doc-${i}`;
      setEntries(GUIDE_INTRO, id);
      useTOCStore.getState().toggleCollapsed(keysNow()[1]);
      useTOCStore.getState().resetCoordination(id);
      expect(
        useTOCStore.getState().byDocument.size,
        `archive leaked at cycle ${i}`,
      ).toBeLessThanOrEqual(1);
    }
    expect(useTOCStore.getState().byDocument.size, "archive retained retired documents").toBe(0);
  });
});

// ===========================================================================
// §W — wholesale-path wiring
// ===========================================================================

interface DriverRow {
  path: string;
  mustReset: boolean;
  drive: () => Promise<void>;
}

const IMAGE_MD = "\n![a](./a.png)\n";

const INSERT_PAYLOAD = {
  document_id: DOC_ID,
  text: "a paragraph\n",
  position: "end",
  window_label: "main",
};

function appendViaStore(): void {
  // The exact call both `App.handleImageDrop` branches make (pinned by W5).
  const currentDoc = useDocumentStore.getState().getActiveDocument();
  if (!currentDoc) return;
  const nextContent = `${currentDoc.content}${IMAGE_MD}`;
  useDocumentStore.getState().updateDocumentContent(currentDoc.id, nextContent);
}

function driverRows(): DriverRow[] {
  return [
    {
      path: "MCP write_document",
      mustReset: true,
      drive: () =>
        emitMcp("mcp:write_document", {
          document_id: DOC_ID,
          content: NEW_CONTENT,
          window_label: "main",
        }),
    },
    {
      path: "MCP create_document",
      mustReset: true,
      drive: () =>
        emitMcp("mcp:create_document", {
          document_id: DOC_ID,
          content: NEW_CONTENT,
          window_label: "main",
        }),
    },
    {
      path: "File reload (App.handleReloadFile -> replaceDocument)",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.replaceDocument(makeDoc({ content: NEW_CONTENT }))),
    },
    {
      path: "Close active document",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.closeActiveDocument(true)),
    },
    {
      path: "Close by id (tab X)",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.closeDocumentById(DOC_ID, true)),
    },
    {
      path: "Open an already-open path",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.openDocumentFromPath(DOC_PATH)),
    },
    {
      path: "Open via dialog onto an open path",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.openDocumentFromDialog()),
    },
    {
      path: "Reopen with a different encoding",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.openDocumentWithEncoding(DOC_PATH, "GBK")),
    },
    {
      path: "Draft recovery over an open id",
      mustReset: true,
      drive: () =>
        withDocumentHook((api) =>
          api.upsertAndActivateDocument(makeDoc({ content: NEW_CONTENT, isModified: true })),
        ),
    },
    {
      path: "New document colliding with an open id",
      mustReset: true,
      drive: () => withDocumentHook((api) => api.createDocument()),
    },
    // D35 / ADR-0044 (2026-09-30): the single "MCP insert_content" row (mustReset: false)
    // is split by the insert's three partitions. An insert into the document that is
    // active in WYSIWYG is now a wholesale replace (prepareWholesaleReplace, TOC reset
    // included, locked decision (a)); source-mode and non-active inserts stay ordinary.
    {
      path: "MCP insert_content (WYSIWYG-active)",
      mustReset: true,
      drive: () => {
        useEditorStore.setState({ viewMode: "wysiwyg", editorView: null });
        return emitMcp("mcp:insert_content", INSERT_PAYLOAD);
      },
    },
    {
      path: "MCP insert_content (source-active)",
      mustReset: false,
      drive: () => {
        useEditorStore.setState({ viewMode: "source", editorView: null });
        return emitMcp("mcp:insert_content", INSERT_PAYLOAD);
      },
    },
    {
      path: "MCP insert_content (non-active)",
      mustReset: false,
      drive: () => {
        useDocumentStore.setState((st) => ({
          documents: [...st.documents, makeDoc({ id: "doc-other", path: "/tmp/o.md" })],
          activeDocumentId: "doc-other",
        }));
        useEditorStore.setState({ viewMode: "wysiwyg" });
        return emitMcp("mcp:insert_content", INSERT_PAYLOAD);
      },
    },
    {
      path: "MCP table_action",
      mustReset: false,
      drive: async () => {
        const beforeContent = useDocumentStore.getState().getDocumentById(DOC_ID)?.content;
        processTableActionEvent(
          {
            document_id: DOC_ID,
            action: "add_row",
            payload: { tableIndex: 0, after: 0 },
            window_label: "main",
          },
          {
            currentWindowLabel: "main",
            updateDocumentContent: (id, content) =>
              useDocumentStore.getState().updateDocumentContent(id, content),
          },
        );
        expect(
          useDocumentStore.getState().getDocumentById(DOC_ID)?.content,
          "the table edit was rejected — this row would pass without editing anything",
        ).not.toBe(beforeContent);
      },
    },
    {
      path: "Editor keystroke",
      mustReset: false,
      drive: () =>
        withDocumentHook((api) => api.updateActiveDocumentContent(`${OLD_CONTENT}typed`)),
    },
    {
      path: "Save",
      mustReset: false,
      drive: () => withDocumentHook((api) => api.saveActiveDocument()),
    },
    {
      path: "Save As",
      mustReset: false,
      drive: () => withDocumentHook((api) => api.saveActiveDocumentAs()),
    },
    {
      path: "Image drop (both branches make this store call)",
      mustReset: false,
      drive: async () => {
        appendViaStore();
      },
    },
  ];
}

describe("W1 — the wholesale/ordinary partition, behaviourally", () => {
  for (const row of driverRows()) {
    it(`${row.mustReset ? "resets" : "preserves"}: ${row.path}`, async () => {
      seedDocumentStore();
      const { collapsed, before } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

      await row.drive();

      if (row.mustReset) {
        expectAnnihilated(DOC_ID, before, GUIDE_INTRO, row.path);
      } else {
        expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, row.path);
      }
    });
  }
});

describe("W2/W3 — the MCP write handler's guards", () => {
  it("W2 does not reset for another window's document", async () => {
    seedDocumentStore();
    const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

    await emitMcp("mcp:write_document", {
      document_id: DOC_ID,
      content: NEW_CONTENT,
      window_label: "other-window",
    });

    expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, "W2");
  });

  it("W3 resets the event's document, not the active one", async () => {
    // doc-2 is archived with collapse state; doc-1 is active with its own.
    setEntries(GUIDE_INTRO, "doc-2");
    const twoKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(twoKeys[1]);
    const twoBefore = new Set(twoKeys);

    setEntries(ABC, "doc-1");
    const oneKeys = keysNow();
    useTOCStore.getState().toggleCollapsed(oneKeys[1]);

    useDocumentStore.setState({
      documents: [
        makeDoc({ id: "doc-1", path: "/tmp/one.md" }),
        makeDoc({ id: "doc-2", path: "/tmp/two.md" }),
      ],
      activeDocumentId: "doc-1",
    });

    await emitMcp("mcp:write_document", {
      document_id: "doc-2",
      content: NEW_CONTENT,
      window_label: "main",
    });

    const s = useTOCStore.getState();
    expect(s.documentId, "the active document was switched by a background write").toBe("doc-1");
    expect(keysNow(), "doc-1's keys were disturbed").toEqual(oneKeys);
    expect(s.collapsedIds.has(oneKeys[1]), "doc-1's collapse was cleared").toBe(true);

    expectAnnihilated("doc-2", twoBefore, GUIDE_INTRO, "W3");
  });
});

describe("W4 — close then reopen the same path does not inherit", () => {
  const arms: Array<[string, (api: ReturnType<typeof useDocument>) => Promise<void>]> = [
    ["closeActiveDocument", async (api) => void (await api.closeActiveDocument(true))],
    ["closeDocumentById (tab X)", async (api) => void (await api.closeDocumentById(DOC_ID, true))],
  ];

  for (const [name, close] of arms) {
    it(`${name} evicts the archive entry`, async () => {
      seedDocumentStore();
      const { before } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

      await withDocumentHook((api) => close(api));

      expectAnnihilated(DOC_ID, before, GUIDE_INTRO, name);
    });
  }
});

describe("W6 — reopen-in-place resets, through all four open arms", () => {
  const arms: Array<[string, (api: ReturnType<typeof useDocument>) => Promise<unknown>]> = [
    ["openDocumentFromPath", (api) => api.openDocumentFromPath(DOC_PATH)],
    ["openDocumentFromDialog", (api) => api.openDocumentFromDialog()],
    ["openDocumentWithEncoding", (api) => api.openDocumentWithEncoding(DOC_PATH, "GBK")],
    ["createDocument", (api) => api.createDocument()],
  ];

  for (const [name, open] of arms) {
    it(`${name} resets coordination for the reopened id`, async () => {
      seedDocumentStore(makeDoc({ content: OLD_CONTENT }));
      const { before } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

      await withDocumentHook(async (api) => {
        await open(api);
      });

      expect(
        useDocumentStore.getState().getDocumentById(DOC_ID)?.content,
        `${name}: the fixture did not actually replace the buffer in place`,
      ).toBe(NEW_CONTENT);

      expectAnnihilated(DOC_ID, before, GUIDE_INTRO_ADDED, name);
    });
  }
});

describe("W7 — draft recovery over an already-open document resets", () => {
  it("upsertAndActivateDocument with the shape App.handleRecoverDraft builds", async () => {
    seedDocumentStore(makeDoc({ content: OLD_CONTENT }));
    const { before } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

    // The literal from App.tsx:632-641, with the draft id colliding with the open id.
    const recovered: Document = {
      id: DOC_ID,
      path: DOC_PATH,
      content: "# Guide\n\n## Intro\n\n## Recovered\n",
      encoding: "UTF-8",
      lineEnding: "lf",
      isModified: true,
      lastSaved: null,
      fileSize: null,
    };

    await withDocumentHook((api) => api.upsertAndActivateDocument(recovered));

    expectAnnihilated(
      DOC_ID,
      before,
      [
        { level: 1, text: "Guide" },
        { level: 2, text: "Intro" },
        { level: 2, text: "Recovered" },
      ],
      "W7",
    );
  });
});

describe("W8 (control) — ordinary paths preserve", () => {
  const RAGGED = "# Guide\n\n## Intro\n\n| a | b |\n| - | - |\n| 1 | 22222 |\n";

  it("saveActiveDocument with auto-reformat ON rewrites the table and keeps the key", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    preferences = { markdown: { autoReformatTablesOnSave: true } };
    seedDocumentStore(makeDoc({ content: RAGGED }));
    const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

    await withDocumentHook((api) => api.saveActiveDocument());

    const saved = useDocumentStore.getState().getDocumentById(DOC_ID)?.content;
    expect(saved, "the table was not reformatted — this arm is passing vacuously").not.toBe(
      RAGGED,
    );
    expect(saved, "the reformat ate the heading").toContain("## Intro");

    expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, "W8 saveActiveDocument");
    vi.unstubAllGlobals();
  });

  it("saveActiveDocumentAs keeps the key", async () => {
    seedDocumentStore();
    const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

    await withDocumentHook((api) => api.saveActiveDocumentAs());

    expect(useDocumentStore.getState().getDocumentById(DOC_ID)?.path).toBe("/tmp/b.md");
    expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, "W8 saveActiveDocumentAs");
  });

  it("image drop (both App branches) keeps the key", async () => {
    seedDocumentStore();
    const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);

    appendViaStore();
    appendViaStore();

    expect(useDocumentStore.getState().getDocumentById(DOC_ID)?.content).toContain("![a]");
    expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, "W8 handleImageDrop");
  });
});

// ===========================================================================
// W8-e — the WYSIWYG serialize write (D15 WI-2) is an ordinary site
// ===========================================================================
//
// Matrix `tests-20260922-163219.md` W8-e / W8-e-table. The edit-sync controller is the
// sixteenth W5 site; this is its behavioural case. Heading lists are specs, as in the
// rest of this file (deviation 2): `expectPreserved` re-runs `setEntries` with the
// headings the edited content carries, which is the "re-parse" step.

const GUIDE_INTRO_SOURCE = OLD_CONTENT;

describe("W8-e — the WYSIWYG edit-sync controller write preserves coordination", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("W8-e controller flush write preserves heading coordination", () => {
    seedDocumentStore();
    const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);
    const controller = createEditSyncController({
      documentId: DOC_ID,
      getMarkdown: () => GUIDE_INTRO_SOURCE + "\nmore text\n",
      baselineMarkdown: GUIDE_INTRO_SOURCE,
      delayMs: EDIT_SYNC_DELAY_MS,
    });

    controller.onDocChanged({ userEdit: true });
    const result = controller.flush("save");

    expect(result).toEqual({ status: "written" });
    expect(useDocumentStore.getState().getDocumentById(DOC_ID)?.content).toContain("more text");
    expectPreserved(DOC_ID, GUIDE_INTRO, collapsed, "W8 WYSIWYG serialize");
    controller.destroy("test-teardown");
  });

  const shapes = [
    {
      name: "append",
      edited: GUIDE_INTRO_SOURCE + "\nmore text\n",
      specs: GUIDE_INTRO,
    },
    {
      name: "insert-above",
      edited: "## New\n\n" + GUIDE_INTRO_SOURCE,
      specs: [{ level: 2, text: "New" }, ...GUIDE_INTRO] as readonly HeadingSpec[],
    },
  ] as const;
  const paths = ["flush", "timer", "destroy"] as const;

  for (const path of paths) {
    for (const shape of shapes) {
      it(`W8-e-table ${path}/${shape.name} preserves coordination`, () => {
        const label = `W8-e ${path}/${shape.name}`;
        vi.useFakeTimers();
        seedDocumentStore();
        const { collapsed } = seedCollapsed(GUIDE_INTRO, DOC_ID, 1);
        const controller = createEditSyncController({
          documentId: DOC_ID,
          baselineMarkdown: GUIDE_INTRO_SOURCE,
          delayMs: EDIT_SYNC_DELAY_MS,
          getMarkdown: () => shape.edited,
        });

        controller.onDocChanged({ userEdit: true });
        if (path === "flush") controller.flush("save");
        else if (path === "timer") vi.advanceTimersByTime(EDIT_SYNC_DELAY_MS);
        else controller.destroy("unmount");

        const doc = useDocumentStore.getState().getDocumentById(DOC_ID);
        expect(doc?.content, `${label}: no write happened`).toBe(shape.edited);
        expect(doc?.isModified, `${label}: not dirty`).toBe(true);

        expectPreserved(DOC_ID, shape.specs, collapsed, label);
        if (shape.name === "insert-above") {
          expect(
            useTOCStore.getState().entries.length,
            `${label}: the heading list did not grow, so no shift was exercised`,
          ).toBe(GUIDE_INTRO.length + 1);
        }
        controller.destroy("test-teardown");
      });
    }
  }
});
