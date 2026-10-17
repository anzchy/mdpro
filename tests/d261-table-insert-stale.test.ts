/**
 * D261-WI-1d: `src/utils/tableInsertTrigger.ts#triggerTableInsert(token?)`.
 *
 * Law (exactly-once-or-never): a submit inserts exactly one table into the
 * editor that was in front at capture, iff the token is still current at
 * submit. Otherwise it inserts nothing into any editor, closes the modal,
 * shows "Document changed; table not inserted" and logs one `stale` line with
 * `stage:"table_submit"`.
 *
 * Staleness causes (`it.each` axis, the three bump classes): SWITCH (d1 → d2),
 * AWAY_BACK (d1 → d2 → d1) and REMOUNT (a new Milkdown getter, same document).
 *
 * Real stores, real `loggingService`, a real Milkdown editor
 * (`tests/helpers/scriptedMilkdownRig.ts`) registered through `registerEditor`,
 * and the real `TableInsertModal`. Mocked: `@tauri-apps/api/{core,window}` only.
 */
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { win, logs } = vi.hoisted(() => ({
  win: { label: "A" },
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: win.label }),
}));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string, args: { payload?: Record<string, unknown> } = {}) => {
    if (cmd === "log_event") logs.push(args.payload ?? {});
    return null;
  },
}));

import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { TableInsertModal } from "../src/components/Editor/TableInsertModal";
import { useDocumentStore } from "../src/stores/documentStore";
import { useEditorStore } from "../src/stores/editorStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { useTableInsertStore } from "../src/stores/tableInsertStore";
import { useToastStore } from "../src/stores/toastStore";
import { captureToken } from "../src/utils/menuTargetToken";
import { triggerTableInsert } from "../src/utils/tableInsertTrigger";
import { mountScriptedMilkdownRig, type MilkdownRig } from "./helpers/scriptedMilkdownRig";
import { doc } from "./support/editorGenerationDomain";

const STALE_TOAST = "Document changed; table not inserted";
const SOURCE_TOAST = "Insert Table is available in WYSIWYG mode";

const rigs: MilkdownRig[] = [];

async function mountRig(text: string): Promise<MilkdownRig> {
  const rig = await mountScriptedMilkdownRig(text, { heights: [20] });
  rigs.push(rig);
  useMilkdownEditorStore.getState().registerEditor(() => rig.editor);
  return rig;
}

const tablesIn = (node: PMNode): PMNode[] => {
  const found: PMNode[] = [];
  node.descendants((n) => {
    if (n.type.name === "table") found.push(n);
    return true;
  });
  return found;
};

const staleLines = () =>
  logs.filter((l) => l.event === "ui.menu.select" && (l.context as { reason?: string })?.reason === "stale");

const submit = (rows = 3, cols = 3) => {
  const cb = useTableInsertStore.getState().pendingCallback;
  expect(cb, "the modal was not opened").not.toBeNull();
  return (cb as (r: number, c: number) => boolean | void)(rows, cols);
};

type Cause = "SWITCH" | "AWAY_BACK" | "REMOUNT";

async function applyCause(cause: Cause): Promise<void> {
  switch (cause) {
    case "SWITCH":
      useDocumentStore.getState().setActiveDocument("d2");
      return;
    case "AWAY_BACK":
      useDocumentStore.getState().setActiveDocument("d2");
      useDocumentStore.getState().setActiveDocument("d1");
      return;
    case "REMOUNT":
      await mountRig("hello");
      return;
  }
}

beforeEach(() => {
  win.label = "A";
  logs.length = 0;
  useLoggingStore.setState({ enabled: true, level: "info" });
  useMilkdownEditorStore.setState({ flushers: {} });
  useMilkdownEditorStore.getState().unregisterEditor();
  useEditorStore.getState().setEditorView(null);
  useEditorStore.setState({ viewMode: "wysiwyg" });
  useDocumentStore.setState({ documents: [doc("d1", "hello"), doc("d2", "world")], activeDocumentId: "d1" });
  useTableInsertStore.setState({ pendingCallback: null });
  useToastStore.getState().clearToast();
});

afterEach(async () => {
  cleanup();
  for (const rig of rigs.splice(0)) await rig.editor.destroy();
  document.body.innerHTML = "";
});

describe("a stale submit inserts nothing (S4 over the three causes)", () => {
  it.each<Cause>(["SWITCH", "AWAY_BACK", "REMOUNT"])("%s", async (cause) => {
    const rig = await mountRig("hello");
    const before = rig.view.state.doc;
    const t = captureToken("A");
    triggerTableInsert(t);

    await applyCause(cause);
    logs.length = 0;
    const docsBefore = useDocumentStore.getState().documents.map((d) => [d.id, d.content]);
    submit();

    for (const r of rigs) expect(tablesIn(r.view.state.doc)).toHaveLength(0);
    expect(rig.view.state.doc.eq(before)).toBe(true);
    expect(useDocumentStore.getState().documents.map((d) => [d.id, d.content])).toEqual(docsBefore);
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
    expect(useToastStore.getState().message).toBe(STALE_TOAST);
    const stale = staleLines();
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ event: "ui.menu.select", status: "cancel" });
    expect(stale[0].context).toMatchObject({ windowLabel: "A", reason: "stale", stage: "table_submit" });
  });
});

describe("a current submit inserts exactly one table (S1, positive control)", () => {
  it("inserts one 3-column table into the rig and logs no stale line", async () => {
    const rig = await mountRig("hello");
    triggerTableInsert(captureToken("A"));
    logs.length = 0;
    expect(submit()).not.toBe(false);

    const tables = tablesIn(rig.view.state.doc);
    expect(tables).toHaveLength(1);
    expect(tables[0].childCount).toBeGreaterThanOrEqual(3);
    tables[0].forEach((row) => expect(row.childCount).toBe(3));
    expect(useToastStore.getState().message).toBeNull();
    expect(staleLines()).toHaveLength(0);
  });
});

describe("Source mode keeps today's toast and opens no modal (S2)", () => {
  it("shows the WYSIWYG-only toast, sets no callback, logs no stale line", () => {
    useEditorStore.setState({ viewMode: "source" });
    triggerTableInsert(captureToken("A"));
    expect(useToastStore.getState().message).toBe(SOURCE_TOAST);
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
    expect(staleLines()).toHaveLength(0);
  });

  it("checks the mode before the token: a stale token still gets the mode toast", () => {
    useEditorStore.setState({ viewMode: "source" });
    const t = captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    triggerTableInsert(t);
    expect(useToastStore.getState().message).toBe(SOURCE_TOAST);
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
    expect(staleLines()).toHaveLength(0);
  });
});

describe("the keyboard path mints its own token at modal open (S3)", () => {
  it("(a) no token, then a switch before submit: stale, nothing inserted", async () => {
    const rig = await mountRig("hello");
    triggerTableInsert();
    useDocumentStore.getState().setActiveDocument("d2");
    logs.length = 0;
    submit();
    expect(tablesIn(rig.view.state.doc)).toHaveLength(0);
    expect(useTableInsertStore.getState().pendingCallback).toBeNull();
    expect(useToastStore.getState().message).toBe(STALE_TOAST);
    expect(staleLines()).toHaveLength(1);
  });

  it("(b) opened on d2 after an earlier capture on d1: inserts into d2's editor", async () => {
    await mountRig("hello");
    captureToken("A");
    useDocumentStore.getState().setActiveDocument("d2");
    const d2Rig = await mountRig("world");
    triggerTableInsert();
    logs.length = 0;
    submit();
    expect(tablesIn(d2Rig.view.state.doc)).toHaveLength(1);
    expect(staleLines()).toHaveLength(0);
  });

  it("mints at call time, not once at module load: two opens on different documents both insert", async () => {
    await mountRig("hello");
    triggerTableInsert();
    useTableInsertStore.getState().clearPending();
    useDocumentStore.getState().setActiveDocument("d2");
    const d2Rig = await mountRig("world");
    triggerTableInsert();
    submit();
    expect(tablesIn(d2Rig.view.state.doc)).toHaveLength(1);
    expect(staleLines()).toHaveLength(0);
  });
});

describe("the stale submit through the real modal (S3)", () => {
  it("closes the dialog with no inline error and shows the stale toast", async () => {
    const rig = await mountRig("hello");
    render(createElement(TableInsertModal));
    const t = captureToken("A");
    act(() => triggerTableInsert(t));
    expect(await screen.findByRole("dialog")).toBeTruthy();

    act(() => useDocumentStore.getState().setActiveDocument("d2"));
    await userEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useToastStore.getState().message).toBe(STALE_TOAST);
    expect(tablesIn(rig.view.state.doc)).toHaveLength(0);
  });
});
