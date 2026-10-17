/**
 * Purpose: shared harness for the D42 `AppDialogs` cases (WI-3
 * `tests/app-dialogs.test.tsx`, WI-4 `tests/d42-app-dialog-open-order*.test.tsx`;
 * matrix `.claude/tdd-guardian/tests-20261008-131500.md` § "Harness"). A real
 * `useState` parent renders `<AppDialogs …/>` with every prop App passes, and its
 * handlers update that state and append `{ handler, arg }` to `calls`, so a test
 * observes the parent's real transition rather than a mock spy.
 *
 * Key decisions:
 * - `confirmDialog` is built by the **real** `quitDialogModel`, as in App.
 * - **`deliver` is injected**, because the fake Tauri bus is `vi.hoisted` per test
 *   file. The harness never mocks anything itself.
 * - MCP is driven through the bus: `open` delivers a fresh `rN` request, `close`
 *   resolves every queued id, `reopen` queues the next id and then resolves the
 *   head (the queued-replacement shape). Ids are never reused.
 * - For a non-MCP id, `reopen(X)` is `close(X)` then `open(X)` in a second `act`,
 *   because a non-MCP slot cannot change its token while it stays open.
 * - `set(patch)` changes state **without** `act`, so a test can batch several
 *   changes into one commit inside its own `act`. `commits` counts `AppDialogs`
 *   commits through a React `Profiler`, so a batched swap can prove it was one.
 * - **`open("recovery")` flushes the re-list** (D241, ADR-0116): Recovery is
 *   admitted only when a fresh `list_drafts` returns with nothing holding it.
 *   Opened while another modal or an MCP request is up, it stays held, so
 *   `openIds()` still counts it (the harness's input, not the DOM).
 * - `domDialogOrder()` maps every `role="dialog"` to its id and checks each
 *   consecutive pair with `compareDocumentPosition`.
 */
import { Profiler, useState } from "react";
import { act, screen } from "@testing-library/react";
import { AppDialogs, type AppEncodingIssue } from "../../src/components/AppDialogs";
import type { DraftMetadata } from "../../src/services/draftService";
import {
  quitDialogModel,
  type QuitDialogPendingClose,
  type QuitDialogPrompt,
} from "../../src/utils/quitDialogModel";

export type HarnessDialogId = "recovery" | "reload" | "encoding" | "confirm" | "settings" | "mcp";

export const HARNESS_DIALOG_IDS: readonly HarnessDialogId[] = [
  "recovery",
  "reload",
  "encoding",
  "confirm",
  "settings",
  "mcp",
];

/** Each dialog's accessible name, as a user (and `getByRole`) sees it. */
export const DIALOG_NAME: Record<HarnessDialogId, string | RegExp> = {
  recovery: "Recover drafts",
  reload: "Reload file",
  encoding: "Select encoding",
  confirm: "Unsaved changes",
  settings: "Settings",
  mcp: /write confirmation/i,
};

export interface HarnessCall {
  handler: string;
  arg?: string;
}

export interface HarnessState {
  drafts: DraftMetadata[];
  reloadMessage: string | null;
  encodingIssue: AppEncodingIssue | null;
  pendingClose: QuitDialogPendingClose;
  quitPrompt: QuitDialogPrompt | null;
  settingsOpen: boolean;
}

export const CLOSED_STATE: HarnessState = {
  drafts: [],
  reloadMessage: null,
  encodingIssue: null,
  pendingClose: null,
  quitPrompt: null,
  settingsOpen: false,
};

export function draft(id: string, title = `Draft ${id}`): DraftMetadata {
  return { id, originalPath: null, lastModified: "2026-10-08 12:00", recovered: false, title };
}

/** Microtasks `open("recovery")` flushes so its `list_drafts` re-list returns (D241). */
const RELIST_TICKS = 8;

/** The state a plain `open(id)` sets for each non-MCP slot. */
const OPEN_PATCH: Record<Exclude<HarnessDialogId, "mcp">, Partial<HarnessState>> = {
  recovery: { drafts: [draft("d1")] },
  reload: { reloadMessage: "notes.md changed on disk" },
  encoding: { encodingIssue: { path: "/x/notes.md", detected: "GBK" } },
  confirm: { pendingClose: "document" },
  settings: { settingsOpen: true },
};

const CLOSE_PATCH: Record<Exclude<HarnessDialogId, "mcp">, Partial<HarnessState>> = {
  recovery: { drafts: [] },
  reload: { reloadMessage: null },
  encoding: { encodingIssue: null },
  confirm: { pendingClose: null, quitPrompt: null },
  settings: { settingsOpen: false },
};

export interface AppDialogsHarnessOptions {
  /** Delivers a payload on the test file's fake webview bus, inside `act`. */
  deliver: (name: string, payload: unknown) => Promise<void>;
  events: { request: string; resolved: string };
  /** Builds a contract-shaped `mcp:confirm_request` payload. */
  request: (requestId: string, title: string) => unknown;
}

export function createAppDialogsHarness(options: AppDialogsHarnessOptions) {
  const calls: HarnessCall[] = [];
  const counters = { commits: 0 };
  let current: HarnessState = CLOSED_STATE;
  let setState: ((update: (prev: HarnessState) => HarnessState) => void) | null = null;
  const mcpQueue: string[] = [];
  let nextMcp = 1;

  const record = (handler: string, arg?: string) => {
    calls.push(arg === undefined ? { handler } : { handler, arg });
  };
  const patch = (next: Partial<HarnessState>) => {
    if (!setState) throw new Error("appDialogsHarness: render <Harness /> first");
    setState((prev) => ({ ...prev, ...next }));
  };

  function Harness({ initial }: { initial?: Partial<HarnessState> }) {
    const [state, set] = useState<HarnessState>(() => ({ ...CLOSED_STATE, ...initial }));
    setState = set;
    current = state;
    const confirmDialog = quitDialogModel({
      pendingClose: state.pendingClose,
      quitPrompt: state.quitPrompt,
    });
    const closeConfirm = (handler: string) => () => {
      record(handler);
      set((prev) => ({ ...prev, ...CLOSE_PATCH.confirm }));
    };
    const dropDraft = (handler: string) => (draftId: string) => {
      record(handler, draftId);
      set((prev) => ({ ...prev, drafts: prev.drafts.filter((d) => d.id !== draftId) }));
    };
    return (
      <Profiler id="AppDialogs" onRender={() => void (counters.commits += 1)}>
        <AppDialogs
          drafts={state.drafts}
          onRecoverDraft={dropDraft("recoverDraft")}
          onDiscardDraft={dropDraft("discardDraft")}
          reloadMessage={state.reloadMessage}
          onReload={() => {
            record("reloadFile");
            set((prev) => ({ ...prev, reloadMessage: null }));
          }}
          onIgnoreReload={() => {
            record("ignoreReload");
            set((prev) => ({ ...prev, reloadMessage: null }));
          }}
          encodingIssue={state.encodingIssue}
          onEncodingSelect={(encoding) => {
            record("encodingSelect", encoding);
            set((prev) => ({ ...prev, encodingIssue: null }));
          }}
          onEncodingCancel={() => {
            record("encodingCancel");
            set((prev) => ({ ...prev, encodingIssue: null }));
          }}
          confirmDialog={confirmDialog}
          onConfirmClose={closeConfirm("confirmClose")}
          onCancelClose={closeConfirm("cancelClose")}
          settingsOpen={state.settingsOpen}
          onSettingsClose={() => {
            record("settingsClose");
            set((prev) => ({ ...prev, settingsOpen: false }));
          }}
        />
      </Profiler>
    );
  }

  const resolve = (requestId: string) =>
    options.deliver(options.events.resolved, { requestId, outcome: "approved" });
  const requestNext = async () => {
    const id = `r${nextMcp}`;
    nextMcp += 1;
    mcpQueue.push(id);
    await options.deliver(options.events.request, options.request(id, `Doc ${id}`));
    return id;
  };

  async function open(id: HarnessDialogId): Promise<void> {
    if (id === "mcp") {
      if (mcpQueue.length === 0) await requestNext();
      return;
    }
    if (id === "recovery") {
      // D241: Recovery shows only once its re-list returns, so flush it.
      await act(async () => {
        patch(OPEN_PATCH[id]);
        for (let i = 0; i < RELIST_TICKS; i += 1) await Promise.resolve();
      });
      return;
    }
    act(() => patch(OPEN_PATCH[id]));
  }

  async function close(id: HarnessDialogId): Promise<void> {
    if (id === "mcp") {
      while (mcpQueue.length > 0) await resolve(mcpQueue.shift() as string);
      return;
    }
    act(() => patch(CLOSE_PATCH[id]));
  }

  async function reopen(id: HarnessDialogId): Promise<void> {
    if (id === "mcp") {
      await requestNext();
      if (mcpQueue.length > 1) await resolve(mcpQueue.shift() as string);
      return;
    }
    await close(id);
    await open(id);
  }

  /** Ids open in the harness's own model; MCP is open while a request is queued. */
  function openIds(): HarnessDialogId[] {
    const s = current;
    const open: Record<HarnessDialogId, boolean> = {
      recovery: s.drafts.length > 0,
      reload: Boolean(s.reloadMessage),
      encoding: Boolean(s.encodingIssue),
      confirm: s.pendingClose !== null || s.quitPrompt !== null,
      settings: s.settingsOpen,
      mcp: mcpQueue.length > 0,
    };
    return HARNESS_DIALOG_IDS.filter((id) => open[id]);
  }

  return {
    Harness,
    calls,
    counters,
    open,
    close,
    reopen,
    openIds,
    /** Patch state without `act`: wrap one or more calls in the test's own `act`. */
    set: patch,
    /** The shown MCP request id, or null. */
    mcpHead: (): string | null => mcpQueue[0] ?? null,
    /** The id-safe open patch for `id`, for batching with `set`. */
    openPatch: (id: Exclude<HarnessDialogId, "mcp">) => OPEN_PATCH[id],
    closePatch: (id: Exclude<HarnessDialogId, "mcp">) => CLOSE_PATCH[id],
  };
}

export type AppDialogsHarness = ReturnType<typeof createAppDialogsHarness>;

/** The dialog element for `id`, or null. */
export function dialogFor(id: HarnessDialogId): HTMLElement | null {
  return screen.queryByRole("dialog", { name: DIALOG_NAME[id] });
}

/**
 * Every `role="dialog"` in document order, mapped to its id. Throws if a dialog
 * has no known id, or if a consecutive pair is not in document order.
 */
export function domDialogOrder(): HarnessDialogId[] {
  const dialogs = screen.queryAllByRole("dialog");
  for (let i = 1; i < dialogs.length; i += 1) {
    const following = dialogs[i - 1].compareDocumentPosition(dialogs[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!following) throw new Error(`domDialogOrder: dialog ${i} does not follow dialog ${i - 1}`);
  }
  return dialogs.map((el) => {
    const id = HARNESS_DIALOG_IDS.find((candidate) => dialogFor(candidate) === el);
    if (!id) throw new Error(`domDialogOrder: unknown dialog ${el.getAttribute("aria-label") ?? "?"}`);
    return id;
  });
}
