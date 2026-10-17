/**
 * D273-WI-1 — keyboard focus in the startup Recovery dialog (ADR-0116
 * Decision 5, rules 32 and 33), through `AppDialogs` and the shared harness.
 *
 * Laws:
 * 1. Focus is never left on `<body>` while Recovery is the top dialog: it
 *    starts on the first row's Recover, follows a removed row to its
 *    neighbour, and comes back from a modal closed over Recovery.
 * 2. Tab and Shift+Tab stay inside the card.
 * 3. When the last row goes, focus returns to what held it at Recovery's
 *    first populated commit, or to the active editor if that is gone.
 *
 * Mock boundaries: webviewWindow `listen` (a fake bus) and core `invoke`
 * (`log_event` dropped, `list_drafts` a controllable list). The active editor
 * is a real ProseMirror view behind a minimal stand-in for Milkdown's
 * `editor.action`, registered in the real `milkdownEditorStore`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";

type Cb = (event: { payload: unknown }) => void;

const { bus, list } = vi.hoisted(() => ({
  bus: { window: new Map() as Map<string, Set<(event: { payload: unknown }) => void>> },
  list: { manual: { value: false }, pending: [] as Array<() => void>, result: { value: null as unknown } },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.window.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.window.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: async (cmd: string) => {
    if (cmd !== "list_drafts") return null;
    if (!list.manual.value) return list.result.value;
    return new Promise((ok) => list.pending.push(() => ok(list.result.value)));
  },
}));

import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { createAppDialogsHarness, dialogFor, draft } from "./support/appDialogsHarness";

const fx = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/mcp-confirm-contract.json"), "utf8"),
) as { events: { request: string; resolved: string }; samples: Array<Record<string, unknown>> };
const replace = fx.samples.find((s) => s.operation === "replace") as Record<string, unknown>;
const req = (id: string, title: string) => ({ ...replace, requestId: id, documentTitle: title });

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.window.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
}

const makeHarness = () => createAppDialogsHarness({ deliver, events: fx.events, request: req });
const THREE = [draft("d1", "One"), draft("d2", "Two"), draft("d3", "Three")];
const card = () => screen.getByRole("dialog", { name: "Recover drafts" });
const recoverOf = (title: string) => {
  const row = within(card()).getByText(title).closest(".recovery-item") as HTMLElement;
  return within(row).getByRole("button", { name: "Recover" });
};
const discardOf = (title: string) => {
  const row = within(card()).getByText(title).closest(".recovery-item") as HTMLElement;
  return within(row).getByRole("button", { name: "Discard" });
};

/** A focusable stand-in for whatever held focus before Recovery showed. */
function outsideButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Outside";
  document.body.appendChild(button);
  return button;
}

/** A real ProseMirror view, registered as the active editor through the real store. */
function mountEditor(): EditorView {
  const schema = new Schema({
    nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Hello")])]);
  const view = new EditorView(host, { state: EditorState.create({ doc }) });
  const editor = { action: (fn: (ctx: { get: () => EditorView }) => unknown) => fn({ get: () => view }) };
  useMilkdownEditorStore.getState().registerEditor(() => editor);
  return view;
}

beforeEach(() => {
  bus.window.clear();
  list.manual.value = false;
  list.pending.length = 0;
  list.result.value = THREE;
});

afterEach(() => {
  useMilkdownEditorStore.getState().unregisterEditor();
  document.body.innerHTML = "";
});

describe("D273-WI-1 Recovery focus (ADR-0116 Decision 5)", () => {
  it("F1 the first populated commit focuses the first row's Recover", async () => {
    const outside = outsideButton();
    act(() => outside.focus());
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await flush();
    expect(recoverOf("One")).toHaveFocus();
  });

  it("F2 Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await flush();
    act(() => discardOf("Three").focus());
    await user.tab();
    expect(recoverOf("One")).toHaveFocus();
    await user.tab({ shift: true });
    expect(discardOf("Three")).toHaveFocus();
  });

  it("F3 recovering a middle row moves focus to the next row's Recover", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await flush();
    await user.click(recoverOf("Two"));
    await flush();
    expect(within(card()).queryByText("Two")).toBeNull();
    expect(recoverOf("Three")).toHaveFocus();
  });

  it("F4 discarding the last row while others remain moves focus to the previous row's Recover", async () => {
    const user = userEvent.setup();
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await flush();
    await user.click(discardOf("Three"));
    await flush();
    expect(recoverOf("Two")).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("F5 the final row's Recover closes the dialog and returns focus to the element captured at first display", async () => {
    list.result.value = [draft("d1", "One")];
    const user = userEvent.setup();
    const outside = outsideButton();
    act(() => outside.focus());
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: [draft("d1", "One")] }));
    await flush();
    await user.click(recoverOf("One"));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(outside).toHaveFocus();
  });

  it("F6 when the captured element is gone, the final row's Discard returns focus to the active editor", async () => {
    list.result.value = [draft("d1", "One")];
    const user = userEvent.setup();
    const view = mountEditor();
    const outside = outsideButton();
    act(() => outside.focus());
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: [draft("d1", "One")] }));
    await flush();
    outside.remove();
    await user.click(discardOf("One"));
    await flush();
    expect(dialogFor("recovery")).toBeNull();
    expect(view.dom).toHaveFocus();
  });

  it("F7 a modal opened over Recovery and closed gives focus back to Recovery's control", async () => {
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await flush();
    act(() => recoverOf("Two").focus());
    act(() => h.set({ reloadMessage: "notes.md changed on disk" }));
    await flush();
    act(() => within(dialogFor("reload") as HTMLElement).getByRole("button", { name: "Ignore" }).focus());
    act(() => h.set({ reloadMessage: null }));
    await flush();
    expect(recoverOf("Two")).toHaveFocus();
  });

  it("F8 a modal opened in the admission gap and closed again: the first populated commit still focuses Recover", async () => {
    list.manual.value = true;
    const h = makeHarness();
    render(<h.Harness />);
    await flush();
    act(() => h.set({ drafts: THREE }));
    await act(async () => {
      for (const next of list.pending.splice(0)) next();
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      h.set({ reloadMessage: "notes.md changed on disk" });
    });
    await flush();
    expect(dialogFor("reload")).not.toBeNull();
    expect((dialogFor("reload") as HTMLElement).contains(document.activeElement)).toBe(true);
    const ignore = within(dialogFor("reload") as HTMLElement).getByRole("button", { name: "Ignore" });
    act(() => ignore.focus());
    expect(ignore).toHaveFocus();
    act(() => h.set({ reloadMessage: null }));
    await flush();
    expect(recoverOf("One")).toHaveFocus();
  });
});
