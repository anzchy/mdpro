/**
 * D240: an MCP write confirmation that arrived while another modal was open
 * (Insert Link here) mounted on top of it and moved focus to Reject, so the
 * next Enter typed for that modal rejected an unrelated write, and Escape
 * meant for Insert Link rejected it through the shared Escape stack.
 *
 * Fix (option (a), ADR-0108): while any other modal is open, a pending prompt
 * renders nothing, takes no focus and registers no Escape. When the last one
 * closes, the oldest request still live shows. Its deadline is Rust's
 * (arrival + `expiresInMs`), never restarted: one that expires while held
 * ends as Rust's timeout. This window never sends a reply for it.
 *
 * Mock boundary: the Tauri modules only (a webview-window `listen` bus and a
 * recording `invoke`). The real hook, container, dialog, Escape stack, link
 * store, LinkInsertModal and logger run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Cb = (event: { payload: unknown }) => void;

const { bus, core } = vi.hoisted(() => ({
  bus: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  core: { calls: [] as Array<{ cmd: string; args: Record<string, unknown> }> },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    label: "main",
    listen: async (name: string, cb: Cb) => {
      const set = bus.get(name) ?? new Set<Cb>();
      set.add(cb);
      bus.set(name, set);
      return () => void set.delete(cb);
    },
  })),
}));

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    core.calls.push({ cmd, args: { ...args } });
    return null;
  }),
}));

import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { LinkInsertModal } from "../src/components/Editor/LinkInsertModal";
import { useLinkInsertStore } from "../src/stores/linkInsertStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const REQUEST = "mcp:confirm_request";
const RESOLVED = "mcp:confirm_resolved";
const T0 = 1_000_000;
const LIVE_MS = 60_000;

const request = (requestId: string, documentTitle: string, expiresInMs = LIVE_MS) => ({
  requestId,
  documentId: `doc-${requestId}`,
  documentTitle,
  operation: "replace",
  expiresInMs,
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function deliver(name: string, payload: unknown): Promise<void> {
  await act(async () => {
    for (const cb of [...(bus.get(name) ?? [])]) cb({ payload });
    await Promise.resolve();
  });
  await settle();
}

const replies = () => core.calls.filter((c) => c.cmd === "mcp_confirm_reply");
const mcpDialog = () => screen.queryByRole("dialog", { name: /write confirmation/i });
const urlField = () => screen.getByRole("textbox", { name: "URL" });

function Harness() {
  return (
    <>
      <LinkInsertModal />
      <McpWriteConfirm />
    </>
  );
}

const linked: string[] = [];

async function openLink(): Promise<void> {
  act(() => useLinkInsertStore.getState().setPendingCallback((url) => void linked.push(url), "wysiwyg"));
  await settle();
  act(() => urlField().focus());
}

let now = T0;

beforeEach(async () => {
  bus.clear();
  core.calls.length = 0;
  linked.length = 0;
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  useLoggingStore.setState({ enabled: true, level: "info" });
  useLinkInsertStore.setState({ pendingCallback: null, mode: "wysiwyg" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  render(<Harness />);
  await settle();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("D240 an MCP prompt waits while another modal is open", () => {
  it("W1 arriving under Insert Link it renders nothing and leaves focus in the URL field", async () => {
    await openLink();
    await deliver(REQUEST, request("A", "Alpha"));

    expect(mcpDialog()).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(urlField()).toHaveFocus();
  });

  it("W2 Enter in the URL field inserts the link and replies to nothing", async () => {
    const user = userEvent.setup();
    await openLink();
    await user.type(urlField(), "https://example.com");
    await deliver(REQUEST, request("A", "Alpha"));

    await user.keyboard("{Enter}");
    await settle();

    expect(linked).toEqual(["https://example.com"]);
    expect(replies()).toEqual([]);
  });

  it("W3 Escape cancels Insert Link and replies to nothing", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha"));

    await user.keyboard("{Escape}");
    await settle();

    expect(useLinkInsertStore.getState().pendingCallback).toBeNull();
    expect(replies()).toEqual([]);
  });

  it("W4 when Insert Link closes, the held prompt shows with Reject focused", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha"));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    expect(mcpDialog()).toHaveAccessibleDescription(/Alpha/);
    expect(screen.getByRole("button", { name: "Reject" })).toHaveFocus();
    expect(replies()).toEqual([]);
  });

  it("W5 several held prompts show oldest first", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha"));
    await deliver(REQUEST, request("B", "Beta"));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(mcpDialog()).toHaveAccessibleDescription(/Alpha/);

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await settle();
    expect(mcpDialog()).toHaveAccessibleDescription(/Beta/);
    expect(replies()).toEqual([{ cmd: "mcp_confirm_reply", args: { requestId: "A", approved: false } }]);
  });

  it("W6 a prompt Rust times out while held never shows and gets no reply", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha"));
    await deliver(RESOLVED, { requestId: "A", outcome: "timedOut" });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    expect(mcpDialog()).toBeNull();
    expect(replies()).toEqual([]);
  });

  it("W7 a held prompt past its original deadline is skipped without a reply, the next live one shows", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha", 1_000));
    now = T0 + 500;
    await deliver(REQUEST, request("B", "Beta", LIVE_MS));
    now = T0 + 1_001;

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    expect(mcpDialog()).toHaveAccessibleDescription(/Beta/);
    expect(replies()).toEqual([]);
  });

  it("W8 the deadline counts from arrival, not from when the modal closed", async () => {
    const user = userEvent.setup();
    await openLink();
    await deliver(REQUEST, request("A", "Alpha", 1_000));
    now = T0 + 1_000;

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();

    expect(mcpDialog()).toBeNull();
    expect(replies()).toEqual([]);
  });

  it("W9 with no other modal open a prompt still shows at once", async () => {
    await deliver(REQUEST, request("A", "Alpha"));
    expect(mcpDialog()).toHaveAccessibleDescription(/Alpha/);
    expect(screen.getByRole("button", { name: "Reject" })).toHaveFocus();
  });

  it("W10 a queued prompt behind a shown one waits if a modal opens over the shown one", async () => {
    const user = userEvent.setup();
    await deliver(REQUEST, request("A", "Alpha"));
    await deliver(REQUEST, request("B", "Beta"));
    await openLink();
    await deliver(RESOLVED, { requestId: "A", outcome: "timedOut" });

    expect(mcpDialog()).toBeNull();
    expect(urlField()).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(mcpDialog()).toHaveAccessibleDescription(/Beta/);
    expect(replies()).toEqual([]);
  });
});
