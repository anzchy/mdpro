/**
 * D37 WI-6 — `McpWriteConfirmDialog` returns focus on close, cases CF-1..CF-8 of
 * `.claude/tdd-guardian/tests-20260930-233000.md` (§"Unit: McpWriteConfirmDialog focus
 * return"; CF-8 from adversary round 1 Gap 4), plus CF-9: the fallback path logs one
 * content-free `ui.mcp_confirm.focus_return` line, and the prior path logs none.
 *
 * `Host` renders a prior element and, while open, the dialog; Approve and Reject advance
 * through `keys` (one key = one prompt; two keys = the keyed swap `McpWriteConfirm`
 * does). CF-8 mounts the REAL `McpWriteConfirm` on a fake webview-window bus.
 * Mocked boundaries: `@tauri-apps/api/{webviewWindow,core}`, `loggingService`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";

type Cb = (event: { payload: unknown }) => void;

const { bus } = vi.hoisted(() => ({
  bus: new Map<string, Set<(event: { payload: unknown }) => void>>(),
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
  invoke: vi.fn(async () => null),
}));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    logUiEvent: vi.fn(),
    logDialogAction: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import type { Mock } from "vitest";
import { McpWriteConfirm } from "../src/components/common/McpWriteConfirm";
import { McpWriteConfirmDialog } from "../src/components/common/McpWriteConfirmDialog";
import { loggingService } from "../src/services/loggingService";
import type { ConfirmRequest } from "../src/utils/mcpConfirmModel";
import { collectionCases } from "./support/collectionCases";

const FOCUS_RETURN_EVENT = "ui.mcp_confirm.focus_return";
const logUi = loggingService.logUiEvent as Mock;

type PriorKind = "input" | "textarea" | "button" | "contenteditable";
type Path = "Approve" | "Reject" | "Escape" | "backdrop";

const PRIORS: Record<PriorKind, { el: ReactElement; role: "textbox" | "button" }> = {
  input: { el: <input aria-label="prior" />, role: "textbox" },
  textarea: { el: <textarea aria-label="prior" />, role: "textbox" },
  button: { el: <button type="button">prior</button>, role: "button" },
  contenteditable: {
    el: <div role="textbox" aria-label="prior" contentEditable suppressContentEditableWarning />,
    role: "textbox",
  },
};

const request = (requestId: string): ConfirmRequest => ({
  requestId,
  documentId: "doc-a",
  documentTitle: "a.md",
  operation: "insert",
  expiresInMs: 60_000,
});

let open: () => void = () => {};
let close: () => void = () => {};
/** React removes the prior element (as an unmounting editor view would). */
let hidePrior: () => void = () => {};

function Host({ prior = "input", keys = ["r1"] }: { prior?: PriorKind; keys?: string[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [priorShown, setPriorShown] = useState(true);
  open = () => setIndex(0);
  close = () => setIndex(null);
  hidePrior = () => setPriorShown(false);
  const advance = () => setIndex((i) => (i === null || i + 1 >= keys.length ? null : i + 1));
  const key = index === null ? null : keys[index];
  return (
    <>
      {priorShown && PRIORS[prior].el}
      <input aria-label="other" />
      {key && (
        <McpWriteConfirmDialog key={key} request={request(key)} onApprove={advance} onReject={advance} />
      )}
    </>
  );
}

/** Render `Host`, focus the prior element, open the dialog; Reject has focus. */
async function openWith(prior: PriorKind = "input", keys?: string[]): Promise<HTMLElement> {
  render(<Host prior={prior} keys={keys} />);
  const el = screen.getByRole(PRIORS[prior].role, { name: "prior" });
  el.focus();
  expect(document.activeElement, "harness: prior focused").toBe(el);
  await act(async () => open());
  expect(document.activeElement, "initial focus is Reject (rule-32 exception)").toBe(
    screen.getByRole("button", { name: "Reject" }),
  );
  return el;
}

async function dismiss(path: Path): Promise<void> {
  const user = userEvent.setup();
  if (path === "Escape") await user.keyboard("{Escape}");
  else if (path === "backdrop") await user.click(screen.getByRole("dialog").parentElement!);
  else await user.click(screen.getByRole("button", { name: path }));
}

beforeEach(() => {
  bus.clear();
  logUi.mockClear();
});

afterEach(() => {
  cleanup();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("McpWriteConfirmDialog focus return (WI-6)", () => {
  it.each(["Approve", "Reject", "Escape"] as const)("CF-1..3 focus returns after %s", async (path) => {
    await openWith();
    await dismiss(path);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "prior" }));
  });

  const kinds = Object.keys(PRIORS) as PriorKind[];
  const paths: Path[] = ["Approve", "Reject", "Escape", "backdrop"];
  it.each(collectionCases("tests/mcp-confirm-focus-return.test.tsx:142", kinds.flatMap((k) => paths.map((p) => [k, p] as const))))(
    "CF-4 round-trip: prior %s × %s",
    async (kind, path) => {
      const prior = await openWith(kind);
      await dismiss(path);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(prior);
    },
  );

  it("CF-5 a disconnected prior element is not focused, and nothing throws", async () => {
    const prior = await openWith();
    await act(async () => hidePrior());
    expect(prior.isConnected, "harness: prior disconnected").toBe(false);
    await dismiss("Reject");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("CF-6 focus moved to another input before close is left alone", async () => {
    await openWith();
    const other = screen.getByRole("textbox", { name: "other" });
    other.focus();
    await act(async () => close());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(other);
  });

  it("CF-7 queued prompts: after r2 closes, focus is back on the prior element (F6)", async () => {
    const prior = await openWith("input", ["r1", "r2"]);
    await dismiss("Approve");
    expect(screen.getByRole("dialog"), "harness: r2 is showing").toBeTruthy();
    expect(document.activeElement, "harness: r2's Reject has focus").toBe(
      screen.getByRole("button", { name: "Reject" }),
    );
    await dismiss("Reject");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(prior);
  });

  it.each(["timedOut", "withdrawn", "cancelled"] as const)(
    "CF-8 the real container: confirm_resolved %s returns focus",
    async (outcome) => {
      render(
        <>
          <input aria-label="prior" />
          <McpWriteConfirm />
        </>,
      );
      await act(async () => {
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      });
      const prior = screen.getByRole("textbox", { name: "prior" });
      prior.focus();
      const deliver = async (name: string, payload: unknown) =>
        act(async () => {
          for (const cb of [...(bus.get(name) ?? [])]) cb({ payload });
          await Promise.resolve();
        });
      await deliver("mcp:confirm_request", request("r1"));
      expect(document.activeElement, "harness: Reject has focus").toBe(
        screen.getByRole("button", { name: "Reject" }),
      );
      await deliver("mcp:confirm_resolved", { requestId: "r1", outcome });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(prior);
    },
  );

  it("CF-9 the fallback path logs one content-free focus_return line", async () => {
    await openWith();
    await act(async () => hidePrior());
    await dismiss("Reject");
    const lines = logUi.mock.calls.filter((c) => c[0] === FOCUS_RETURN_EVENT);
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ outcome: "fallback", target: "none" });
  });

  it("CF-9b the prior path logs no focus_return line", async () => {
    await openWith();
    await dismiss("Approve");
    expect(logUi.mock.calls.filter((c) => c[0] === FOCUS_RETURN_EVENT)).toHaveLength(0);
  });
});
