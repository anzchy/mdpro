/** D299: a Recovery click cannot resolve its row before the claim write is durable. */
import { beforeEach, expect, it, vi } from "vitest";
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
import { recoverDraft } from "../src/services/draftService";
import { discardRecoveryDraft } from "../src/services/draftService";
import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import { draftRecoveryOutcome } from "../src/utils/draftRecoveryOutcome";
import { applyRecoveredDocument } from "../src/utils/recoverIntoOpenTab";

const B = "path-derived-b";
const PATH = "/tmp/b.md";
const CLAIM = { sourceId: B, nonce: "claim-1", sessionId: "session-1" };
const ROW = { id: B, originalPath: PATH, lastModified: "2026-10-20", recovered: false, title: "B" };
const doc = () => useDocumentStore.getState().getDocumentById(B);

function Harness() {
  const [rows, setRows] = useState([ROW]);
  const [toast, setToast] = useState("");
  const onRecover = async (id: string) => {
    const outcome = await recoverDraft(id);
    const mapped = draftRecoveryOutcome(id, { action: "recover", outcome });
    if (mapped.upsert && outcome.kind === "ok") {
      const result = await applyRecoveredDocument(id, mapped.upsert, {
        upsertAndActivate: (next) => {
          useDocumentStore.getState().upsertDocument(next);
          useDocumentStore.getState().setActiveDocument(next.id);
        },
        showToast: setToast,
      }, outcome.result as never);
      if (result !== "failed") setRows((old) => old.filter((row) => row.id !== id));
    }
  };
  return <><RecoveryDialog drafts={rows} onRecover={onRecover} onDiscard={() => {}} /><output>{toast}</output></>;
}

beforeEach(() => {
  invokeMock.mockReset();
  useDocumentStore.setState({ documents: [{ id: B, path: PATH, content: "disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 9 }], activeDocumentId: B });
  useMilkdownEditorStore.setState({ getEditor: () => null, flushers: {}, editorGenerations: {} });
});

it("D299-WI-3 same-id clean Recover writes with its claim before the row resolves", async () => {
  let finishWrite: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "save_draft") return new Promise((resolve) => { finishWrite = resolve; });
    if (cmd === "get_draft") return Promise.resolve(null);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_draft")).toBe(true));
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  expect(doc()?.content).toBe("R unsaved");
  const save = invokeMock.mock.calls.find(([cmd]) => cmd === "save_draft")?.[1] as Record<string, unknown>;
  expect(save).toMatchObject({ documentId: B, content: "R unsaved", claimToken: CLAIM });
  finishWrite?.({ success: true });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
});

it.each([
  ["file-backed", PATH],
  ["untitled", null],
])("Amendment 3: no-target %s Recover writes under the draft id before row removal", async (_label, originalPath) => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  let finishWrite: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath, title: "B", target: null, claimToken: CLAIM });
    if (cmd === "save_draft") return new Promise((resolve) => { finishWrite = resolve; });
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_draft")).toBe(true));
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  const save = invokeMock.mock.calls.find(([cmd]) => cmd === "save_draft")?.[1] as Record<string, unknown>;
  expect(save).toMatchObject({ documentId: B, originalPath, content: "R unsaved", claimToken: CLAIM });
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toHaveLength(0);
  finishWrite?.({ success: true });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
});

it("Amendment 3: failed no-target write keeps the row and offers retry", async () => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: null, claimToken: CLAIM });
    if (cmd === "save_draft") return Promise.reject(new Error("disk full"));
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.getByText(/retry/i)).toBeVisible());
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toHaveLength(0);
});

it("last refused row offers Keep for later, leaves bytes untouched and unmounts the dialog", async () => {
  function RefusalHarness() {
    const [rows, setRows] = useState([ROW]);
    const [toast, setToast] = useState("");
    const recover = async (id: string) => {
      const outcome = await recoverDraft(id);
      const mapped = draftRecoveryOutcome(id, { action: "recover", outcome });
      if (mapped.toast) setToast(mapped.toast);
      if (mapped.allowKeep) setRows((old) => old.map((row) => row.id === id ? { ...row, inUseRefused: true } : row));
    };
    return <><RecoveryDialog drafts={rows} onRecover={recover} onDiscard={() => {}} onKeepForLater={(id) => setRows((old) => old.filter((row) => row.id !== id))} /><output>{toast}</output></>;
  }
  invokeMock.mockImplementation((cmd: string) => cmd === "recover_draft"
    ? Promise.reject("OpenInWindow") : Promise.resolve(null));
  render(<RefusalHarness />);
  const user = userEvent.setup();
  expect(screen.queryByRole("button", { name: "Keep for later" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep for later" })).toBeVisible());
  expect(screen.getByText(/another window/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep for later" }));
  expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull();
  const keepLogs = invokeMock.mock.calls.filter(([cmd, args]) => cmd === "log_event" && args?.payload?.context?.controlId === "dialog.recovery.keep_for_later");
  expect(keepLogs).toHaveLength(1);
  expect(keepLogs[0][1].payload.actionId).toBeTruthy();
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft" || cmd === "discard_recovery_draft")).toHaveLength(0);
  useDocumentStore.getState().updateDocumentContent(B, "editing works");
  expect(doc()?.content).toBe("editing works");
});

it("a target closed and reopened during the Recover IPC is not overwritten", async () => {
  let answerRecover: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return new Promise((resolve) => { answerRecover = resolve; });
    if (cmd === "get_draft") return Promise.resolve(null);
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(answerRecover).toBeDefined());
  useDocumentStore.getState().closeDocument(B);
  useDocumentStore.getState().upsertDocument({ id: B, path: PATH, content: "new disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 13 });
  answerRecover?.({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("new disk text");
  const recovered = useDocumentStore.getState().documents.find((entry) => entry.id !== B && entry.content === "R unsaved");
  expect(recovered).toBeDefined();
  expect(invokeMock.mock.calls.some(([cmd, args]) => cmd === "save_draft" && args.documentId === recovered?.id && args.claimToken?.nonce === CLAIM.nonce)).toBe(true);
});

it("an in-place clean reload during the Recover IPC is not overwritten", async () => {
  let answerRecover: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return new Promise((resolve) => { answerRecover = resolve; });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(answerRecover).toBeDefined());
  useDocumentStore.getState().upsertDocument({ ...doc()!, content: "new disk text", isModified: false });
  answerRecover?.({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("new disk text");
  expect(useDocumentStore.getState().documents.some((entry) => entry.id !== B && entry.content === "R unsaved")).toBe(true);
});

it("no-target reply cannot overwrite a same-id dirty tab opened during its await", async () => {
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  let answerRecover: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return new Promise((resolve) => { answerRecover = resolve; });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(answerRecover).toBeDefined());
  useDocumentStore.getState().upsertDocument({ id: B, path: PATH, content: "new B edit", encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: 10 });
  answerRecover?.({ content: "R unsaved", originalPath: PATH, title: "B", target: null, claimToken: CLAIM });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("new B edit");
  const recovered = useDocumentStore.getState().documents.find((entry) => entry.id !== B && entry.content === "R unsaved");
  expect(recovered).toBeDefined();
  expect(invokeMock.mock.calls.some(([cmd, args]) => cmd === "save_draft" && args.documentId === recovered?.id)).toBe(true);
});

it("switching to another tab during Recover does not make the unchanged target stale", async () => {
  const other = { id: "other", path: "/tmp/other.md", content: "O", encoding: "UTF-8" as const, lineEnding: "lf" as const, isModified: false, lastSaved: null, fileSize: 1 };
  useDocumentStore.setState((state) => ({ documents: [...state.documents, other], activeDocumentId: B }));
  let answerRecover: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return new Promise((resolve) => { answerRecover = resolve; });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(answerRecover).toBeDefined());
  useDocumentStore.getState().setActiveDocument("other");
  answerRecover?.({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("R unsaved");
  expect(useDocumentStore.getState().documents).toHaveLength(2);
  expect(useDocumentStore.getState().getDocumentById("other")?.content).toBe("O");
});

it("D299-WI-6 dirty same-id B opens a durable new Y before any autosave", async () => {
  useDocumentStore.setState({
    documents: [{ id: B, path: PATH, content: "B unsaved edit", encoding: "UTF-8", lineEnding: "lf", isModified: true, lastSaved: null, fileSize: 14 }],
    activeDocumentId: B,
  });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("B unsaved edit");
  const recovered = useDocumentStore.getState().documents.find((entry) => entry.id !== B && entry.content === "R unsaved");
  expect(recovered).toBeDefined();
  expect(recovered?.isModified).toBe(true);
  const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft" || cmd === "delete_draft");
  expect(calls[0]).toEqual(["save_draft", expect.objectContaining({ documentId: recovered?.id, content: "R unsaved", claimToken: CLAIM })]);
  expect(calls[1]).toEqual(["delete_draft", { documentId: B, claimToken: CLAIM }]);
});

it("guarded Discard refusal keeps the row and reveals Keep for later", async () => {
  function DiscardHarness() {
    const [rows, setRows] = useState([ROW]);
    const [toast, setToast] = useState("");
    const onDiscard = async (id: string) => {
      const outcome = await discardRecoveryDraft(id);
      const mapped = draftRecoveryOutcome(id, { action: "discard", outcome });
      if (mapped.toast) setToast(mapped.toast);
      if (mapped.allowKeep) setRows((old) => old.map((row) => row.id === id ? { ...row, inUseRefused: true } : row));
    };
    return <><RecoveryDialog drafts={rows} onRecover={() => {}} onDiscard={onDiscard} onKeepForLater={(id) => setRows((old) => old.filter((row) => row.id !== id))} /><output>{toast}</output></>;
  }
  invokeMock.mockImplementation((cmd: string) => cmd === "discard_recovery_draft"
    ? Promise.reject("ShadowStoreUnavailable") : Promise.resolve(null));
  render(<DiscardHarness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep for later" })).toBeVisible());
  expect(screen.getByText(/Could not check open windows/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep for later" }));
  expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull();
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toHaveLength(0);
});

it.each([
  ["OwnedByLiveWindow", "owned by another live window"],
  ["OpenInWindow", "open in another window"],
  ["NotFound", null],
])("dialog Discard handles %s with the correct row and toast", async (wire, phrase) => {
  function DiscardRow() {
    const [rows, setRows] = useState([ROW]);
    const [toast, setToast] = useState("");
    const onDiscard = async (id: string) => {
      const outcome = await discardRecoveryDraft(id);
      const mapped = draftRecoveryOutcome(id, { action: "discard", outcome });
      if (mapped.toast) setToast(mapped.toast);
      if (mapped.dropRow) setRows((old) => old.filter((row) => row.id !== id));
      if (mapped.allowKeep) setRows((old) => old.map((row) => row.id === id ? { ...row, inUseRefused: true } : row));
    };
    return <><RecoveryDialog drafts={rows} onRecover={() => {}} onDiscard={onDiscard} onKeepForLater={(id) => setRows((old) => old.filter((row) => row.id !== id))} /><output>{toast}</output></>;
  }
  invokeMock.mockImplementation((cmd: string) => cmd === "discard_recovery_draft"
    ? Promise.reject(wire === "NotFound" ? { NotFound: { document_id: B } } : wire)
    : Promise.resolve(null));
  render(<DiscardRow />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Discard" }));
  if (phrase) {
    await waitFor(() => expect(screen.getByText(new RegExp(phrase, "i"))).toBeVisible());
    expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep for later" })).toBeVisible();
  } else {
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
    expect(screen.queryByText(/Draft is in use|Could not check/)).toBeNull();
  }
});

it("claimed alias recovery uses Rust's other-id target and rekeys after the write", async () => {
  const T = "path-derived-target";
  const storedPath = "/real/b.md";
  useDocumentStore.setState({ documents: [{ id: T, path: storedPath, content: "disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 9 }], activeDocumentId: T });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: "/alias/b.md", title: "B", target: { id: T, storedPath }, claimToken: CLAIM });
    if (cmd === "get_draft") return Promise.resolve(null);
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  const target = useDocumentStore.getState().getDocumentById(T);
  expect(target?.content).toBe("R unsaved");
  expect(target?.path).toBe(storedPath);
  expect(target?.isModified).toBe(true);
  expect(useDocumentStore.getState().getDocumentById(B)).toBeUndefined();
  const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft" || cmd === "delete_draft");
  expect(calls[0]).toEqual(["save_draft", expect.objectContaining({ documentId: T, originalPath: storedPath, claimToken: CLAIM })]);
  expect(calls[1]).toEqual(["delete_draft", { documentId: B, claimToken: CLAIM }]);
});

it("another pending draft under an other-id target opens a fresh tab", async () => {
  const T = "path-derived-target";
  useDocumentStore.setState({ documents: [{ id: T, path: PATH, content: "disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 9 }], activeDocumentId: T });
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: T, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "get_draft") return Promise.resolve({ content: "other pending" });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(useDocumentStore.getState().getDocumentById(T)?.content).toBe("disk text");
  const fresh = useDocumentStore.getState().documents.find((entry) => entry.id !== T);
  expect(fresh?.content).toBe("R unsaved");
  expect(fresh?.id).not.toBe(B);
  expect(invokeMock.mock.calls.some(([cmd, args]) => cmd === "save_draft" && args.documentId === fresh?.id)).toBe(true);
});

it("a second Recover click while the first waits cannot issue a competing claim", async () => {
  let answerRecover: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return new Promise((resolve) => { answerRecover = resolve; });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    return Promise.resolve(null);
  });
  render(<Harness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Recover" }));
  await user.click(screen.getByRole("button", { name: "Recover" }));
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "recover_draft")).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  answerRecover?.({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("R unsaved");
});

it("a target replaced during the draft collision check is not overwritten", async () => {
  const T = "other-id-target";
  useDocumentStore.setState({ documents: [{ id: T, path: PATH, content: "disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 9 }], activeDocumentId: T });
  let answerCheck: ((value: unknown) => void) | undefined;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: T, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "get_draft") return new Promise((resolve) => { answerCheck = resolve; });
    if (cmd === "save_draft") return Promise.resolve({ success: true });
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(answerCheck).toBeDefined());
  useDocumentStore.getState().closeDocument(T);
  useDocumentStore.getState().upsertDocument({ id: T, path: PATH, content: "reopened disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 18 });
  answerCheck?.(null);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(useDocumentStore.getState().getDocumentById(T)?.content).toBe("reopened disk text");
  expect(useDocumentStore.getState().documents.some((entry) => entry.id !== T && entry.content === "R unsaved")).toBe(true);
});

it("closing and reopening the target during its destination write keeps R in a fresh tab", async () => {
  let finishWrite: ((value: unknown) => void) | undefined;
  let first = true;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: B, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "save_draft") {
      if (first) { first = false; return new Promise((resolve) => { finishWrite = resolve; }); }
      return Promise.resolve({ success: true });
    }
    if (cmd === "delete_draft") return Promise.resolve(true);
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(finishWrite).toBeDefined());
  useDocumentStore.getState().closeDocument(B);
  useDocumentStore.getState().upsertDocument({ id: B, path: PATH, content: "new disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 13 });
  finishWrite?.({ success: true });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recover drafts" })).toBeNull());
  expect(doc()?.content).toBe("new disk text");
  const recovered = useDocumentStore.getState().documents.find((entry) => entry.id !== B && entry.content === "R unsaved");
  expect(recovered).toBeDefined();
  const saves = invokeMock.mock.calls.filter(([cmd]) => cmd === "save_draft");
  expect(saves).toHaveLength(2);
  expect(saves[1][1]).toMatchObject({ documentId: recovered?.id, content: "R unsaved", claimToken: CLAIM });
});

it.each([
  ["same-id", B],
  ["re-key", "other-id-target"],
])("a failed %s target write keeps the source claim and retry row", async (_label, targetId) => {
  if (targetId !== B) {
    useDocumentStore.setState({ documents: [{ id: targetId, path: PATH, content: "disk text", encoding: "UTF-8", lineEnding: "lf", isModified: false, lastSaved: null, fileSize: 9 }], activeDocumentId: targetId });
  }
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "recover_draft") return Promise.resolve({ content: "R unsaved", originalPath: PATH, title: "B", target: { id: targetId, storedPath: PATH }, claimToken: CLAIM });
    if (cmd === "get_draft") return Promise.resolve(null);
    if (cmd === "save_draft") return Promise.reject(new Error("disk full"));
    return Promise.resolve(null);
  });
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Recover" }));
  await waitFor(() => expect(screen.getByText(/retry/i)).toBeVisible());
  expect(screen.getByRole("dialog", { name: "Recover drafts" })).toBeVisible();
  expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "delete_draft")).toHaveLength(0);
});
