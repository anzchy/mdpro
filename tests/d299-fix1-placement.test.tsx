/** D299 fix round 1: claimed placement failures must release Recovery's pending row. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {}, emit: async () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

import { RecoveryDialog } from "../src/components/common/RecoveryDialog";
import { useDocument } from "../src/hooks/useDocument";
import { recoverDraft } from "../src/services/draftService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";
import { recoveryPlacementFailed } from "../src/utils/recoveryPlacementFocus";

const B = "d299-fx1-b";
const PATH = "/tmp/d299-fx1-b.md";
const ROW = { id: B, originalPath: PATH, title: "B", lastModified: "2026-10-21", recovered: false, inUseRefused: true };
const CLAIM = { sourceId: B, nonce: "fx1-claim", sessionId: "current-session" };
type Failure = "upsert" | "reload" | "write" | null;
const releases: Array<() => void> = [];

function ClaimedHarness({ failure }: { failure: Failure }) {
  const [rows, setRows] = useState([ROW]);
  const [toast, setToast] = useState("");
  const { upsertAndActivateDocument } = useDocument();
  const onRecover = async (id: string) => {
    const outcome = await recoverDraft(id);
    const mapped = draftRecoveryOutcome(id, { action: "recover", outcome });
    if (!mapped.upsert || outcome.kind !== "ok") return;
    try {
      const placed = await applyRecoveredDocument(id, mapped.upsert, {
        upsertAndActivate: failure === "upsert"
          ? () => { throw new Error("upsert failed"); }
          : upsertAndActivateDocument,
        showToast: setToast,
      }, outcome.result);
      if (placed !== "failed") setRows((old) => old.filter((row) => row.id !== id));
    } catch {
      // Prevent an unhandled test-runner error; the UI assertions detect missing cleanup.
    }
  };
  const remove = (id: string) => setRows((old) => old.filter((row) => row.id !== id));
  return <>
    <RecoveryDialog drafts={rows} onRecover={onRecover} onDiscard={remove} onKeepForLater={remove} />
    <output>{toast}</output>
  </>;
}

beforeEach(() => {
  recoveryPlacementFailed(B);
  invokeMock.mockReset();
  useDocumentStore.setState({
    documents: [{ id: B, path: PATH, content: "disk B", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 6 }],
    activeDocumentId: B,
  });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
});
afterEach(() => {
  for (const release of releases.splice(0)) release();
  recoveryPlacementFailed(B);
});

it.each([
  ["upsert", "Keep for later", 0],
  ["reload", "Discard", 0],
  ["write", "Keep for later", 1],
] as const)("FX-2 claimed %s throw clears pending and leaves the modal operable", async (failure, action, expectedWrites) => {
  if (failure === "reload") {
    releases.push(useMilkdownEditorStore.getState().registerFlusher(B, () => ({ status: "clean" }), () => { throw new Error("discard failed"); }));
  }
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "save_draft") return failure === "write" ? Promise.reject(new Error("disk full")) : Promise.resolve({ success: true });
    return Promise.resolve(null);
  });
  render(<ClaimedHarness failure={failure} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.queryByText("Recovering…")).toBeNull());
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  expect(screen.getByText(/retry/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Recover" })).toHaveAttribute("aria-disabled", "false");
  expect(screen.getByRole("button", { name: "Discard" })).toHaveAttribute("aria-disabled", "false");
  expect(screen.getByRole("button", { name: "Keep for later" })).toHaveAttribute("aria-disabled", "false");
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft")).toHaveLength(expectedWrites);
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: action }));
  expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull();
});

it("FX-2 success twin commits the claimed text and removes the row", async () => {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    return Promise.resolve(null);
  });
  render(<ClaimedHarness failure={null} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(useDocumentStore.getState().getDocumentById(B)?.content).toBe("R unsaved");
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft")).toHaveLength(1);
});

it("FX-1 backend legacy-claim write error keeps Recovery's row and retry control", async () => {
  function ErrorHarness() {
    const [rows, setRows] = useState([ROW]);
    const [toast, setToast] = useState("");
    const onRecover = async (id: string) => {
      const outcome = await recoverDraft(id);
      const mapped = draftRecoveryOutcome(id, { action: "recover", outcome });
      if (mapped.toast) setToast(mapped.toast);
      if (mapped.dropRow) setRows((old) => old.filter((row) => row.id !== id));
    };
    return <>
      <RecoveryDialog drafts={rows} onRecover={onRecover} onDiscard={(id) => setRows((old) => old.filter((row) => row.id !== id))} />
      <output>{toast}</output>
    </>;
  }
  invokeMock.mockImplementation((cmd: string) => cmd === "recover_draft"
    ? Promise.reject({ IoError: { message: "claimed bundle write failed" } })
    : Promise.resolve(null));
  render(<ErrorHarness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.getByText("Failed to recover draft")).toBeVisible());
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Recover" })).toHaveAttribute("aria-disabled", "false");
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft" || cmd === "delete_draft")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull();
});
