/**
 * AppDialogs Component
 *
 * Purpose: the App-level dialog composition — Recovery, Reload, Encoding, the
 * one "Unsaved changes" ConfirmDialog, Settings, the D290 recreate choice and the per-window MCP write
 * confirmation — extracted from App.tsx (D42 WI-3). Presentational: App owns
 * every piece of state and every handler and passes them in; this component
 * only decides how each input maps onto its dialog's props.
 *
 * Key decisions:
 * - **All handlers stay in App.tsx.** The source-text tests that anchor on
 *   `handleEncodingSelect` / `handleConfirmClose` / `handleCancelClose` and the
 *   d46 suites keep reading App.tsx; `tests/app-dialogs-wiring.test.ts` pins
 *   which App expression each prop here is bound to.
 * - **Every slot stays mounted**, each dialog returning null while closed, as in App
 *   before the move. SettingsDialog keeps its state while closed, and
 *   `McpWriteConfirm`'s `useMcpConfirm` subscription exists before any prompt.
 * - **Open order, not source order (D42, ADR-0062).** All share
 *   `.dialog-backdrop` at z-index 20 with no portal, so later in the DOM paints
 *   on top and takes Escape (ADR-0045). The slots render as keyed fragments in
 *   `dialogRenderOrder(openOrder)`: open dialogs first, most recently opened
 *   last, then every closed slot in canonical order. A dialog that is opening
 *   therefore already renders after every open one before the order catches
 *   up, and React moves keyed slots without remounting them. MCP is not pinned
 *   on top; a covered MCP prompt can time out unseen (ADR-0062's cost).
 * - **Tokens**: ordinary non-MCP slots pass `"open"`; recreate passes its document
 *   and sequence so a newer deletion re-raises it. MCP passes the shown `requestId`, reported by
 *   `McpWriteConfirm`'s `onPromptChange`, so a queued replacement re-raises.
 * - **The open order is adjusted during render** (React's "storing information
 *   from previous renders"), compared before it is set, so it costs no extra
 *   committed render and settles under a StrictMode double render.
 * - One `ui.dialog.stack` log, `{ order }` only, per change of the open order
 *   while two or more dialogs are open — never titles, paths or messages.
 * - **Recovery waits for admission (D241, ADR-0116).** `useRecoveryAdmission`
 *   holds it while another modal is open or a received MCP request is live,
 *   re-lists the drafts, and yields the admitted rows; Recovery's token is
 *   open only while it has rows. It shares a link with `McpWriteConfirm` so
 *   no MCP prompt mounts in the gap before Recovery's commit.
 * - The Sidebar and BottomTabs ConfirmDialogs are not part of this composition.
 *
 * @module components/AppDialogs
 * @coordinates-with src/App.tsx — renders `<AppDialogs/>` once, between BottomTabs and Toast
 * @coordinates-with src/utils/quitDialogModel.ts — supplies `confirmDialog`
 * @coordinates-with src/components/common/McpWriteConfirm.tsx — the MCP prompt container
 * @coordinates-with src/hooks/useRecoveryAdmission.ts — when Recovery shows, and its rows
 * @coordinates-with src/utils/dialogOpenOrder.ts — the pure open-order model
 * @coordinates-with tests/support/appDialogsHarness.tsx — the stateful test parent
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./common/ConfirmDialog";
import { EncodingDialog } from "./common/EncodingDialog";
import { McpWriteConfirm } from "./common/McpWriteConfirm";
import { RecoveryDialog } from "./common/RecoveryDialog";
import { RecreateFileDialog, type RecreateChoice, type RecreateRequest } from "./common/RecreateFileDialog";
import { ReloadDialog } from "./common/ReloadDialog";
import { SettingsDialog } from "./common/SettingsDialog";
import { useRecoveryAdmission } from "../hooks/useRecoveryAdmission";
import type { DraftMetadata } from "../services/draftService";
import { loggingService } from "../services/loggingService";
import {
  dialogRenderOrder,
  nextDialogOpenOrder,
  type AppDialogId,
  type AppDialogTokens,
  type OpenDialogEntry,
} from "../utils/dialogOpenOrder";
import type { QuitDialogModel } from "../utils/quitDialogModel";

/** A file that could not be decoded, as `useDocument` reports it. */
export interface AppEncodingIssue {
  path: string;
  detected: string;
}

export interface AppDialogsProps {
  /** Drafts awaiting recovery; Recovery shows the admitted ones (D241). */
  drafts: DraftMetadata[];
  onRecoverDraft: (draftId: string) => void;
  onDiscardDraft: (draftId: string) => void;
  /** The external-change prompt text; the Reload dialog shows while set. */
  reloadMessage: string | null;
  onReload: () => void;
  onIgnoreReload: () => void;
  recreateRequest?: RecreateRequest | null;
  onRecreateChoice?: (choice: RecreateChoice) => void;
  /** The undecodable file; the Encoding dialog shows while set. */
  encodingIssue: AppEncodingIssue | null;
  onEncodingSelect: (encoding: string) => void;
  onEncodingCancel: () => void;
  /** What the one "Unsaved changes" dialog is about, from `quitDialogModel`. */
  confirmDialog: QuitDialogModel;
  onConfirmClose: () => void;
  onCancelClose: () => void;
  settingsOpen: boolean;
  onSettingsClose: () => void;
}

/** The open token every non-MCP slot passes while it is open. */
const OPEN_TOKEN = "open";
/** Below this many open dialogs there is no stack to log. */
const MIN_STACK_TO_LOG = 2;

function sameOrder(a: readonly OpenDialogEntry[], b: readonly OpenDialogEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.id === b[i].id && e.token === b[i].token);
}

export function AppDialogs({
  drafts,
  onRecoverDraft,
  onDiscardDraft,
  reloadMessage,
  onReload,
  onIgnoreReload,
  recreateRequest = null,
  onRecreateChoice = () => {},
  encodingIssue,
  onEncodingSelect,
  onEncodingCancel,
  confirmDialog,
  onConfirmClose,
  onCancelClose,
  settingsOpen,
  onSettingsClose,
}: AppDialogsProps) {
  const [mcpRequestId, setMcpRequestId] = useState<string | null>(null);
  const [keptIds, setKeptIds] = useState<Set<string>>(() => new Set());
  const { rows: recoveryRows, mcpLink } = useRecoveryAdmission(drafts.filter((draft) => !keptIds.has(draft.id)));
  const latestDrafts = new Map(drafts.map((draft) => [draft.id, draft]));
  const [openOrder, setOpenOrder] = useState<OpenDialogEntry[]>([]);
  const tokens: AppDialogTokens = {
    recovery: recoveryRows.length > 0 ? OPEN_TOKEN : null,
    reload: reloadMessage ? OPEN_TOKEN : null,
    recreate: recreateRequest ? `${recreateRequest.documentId}:${recreateRequest.seq}` : null,
    encoding: encodingIssue ? OPEN_TOKEN : null,
    confirm: confirmDialog.open ? OPEN_TOKEN : null,
    settings: settingsOpen ? OPEN_TOKEN : null,
    mcp: mcpRequestId,
  };
  // Adjust the carried order during render; compare first, because
  // `nextDialogOpenOrder` returns a new array on every call.
  const computed = nextDialogOpenOrder(openOrder, tokens);
  const current = sameOrder(computed, openOrder) ? openOrder : computed;
  if (current !== openOrder) setOpenOrder(current);
  const openIds = current.map((entry) => entry.id);
  const orderKey = openIds.join(",");

  const lastOrderKey = useRef("");
  useEffect(() => {
    if (orderKey === lastOrderKey.current) return;
    lastOrderKey.current = orderKey;
    const order = orderKey === "" ? [] : orderKey.split(",");
    if (order.length >= MIN_STACK_TO_LOG) loggingService.logUiEvent("ui.dialog.stack", { order });
  }, [orderKey]);

  const slot = (id: AppDialogId): ReactNode => {
    switch (id) {
      case "recovery":
        return <RecoveryDialog drafts={recoveryRows.map((row) => ({ ...row, inUseRefused: latestDrafts.get(row.id)?.inUseRefused }))} onRecover={onRecoverDraft} onDiscard={onDiscardDraft} onKeepForLater={(id) => setKeptIds((old) => new Set(old).add(id))} />;
      case "reload":
        return (
          <ReloadDialog
            open={Boolean(reloadMessage)}
            message={reloadMessage ?? ""}
            onReload={onReload}
            onIgnore={onIgnoreReload}
          />
        );
      case "recreate":
        return <RecreateFileDialog request={recreateRequest} onChoice={onRecreateChoice} />;
      case "encoding":
        return (
          <EncodingDialog
            open={Boolean(encodingIssue)}
            path={encodingIssue?.path ?? ""}
            onSelect={onEncodingSelect}
            onCancel={onEncodingCancel}
          />
        );
      case "confirm":
        return (
          <ConfirmDialog
            open={confirmDialog.open}
            title="Unsaved changes"
            message={confirmDialog.message}
            confirmLabel="Discard changes"
            destructive
            cancelLabel="Keep editing"
            onConfirm={onConfirmClose}
            onCancel={onCancelClose}
          />
        );
      case "settings":
        return <SettingsDialog open={settingsOpen} onClose={onSettingsClose} />;
      case "mcp":
        // ADR-0042: this window's MCP write-confirmation prompt. Every window
        // renders App, so each owns its prompt.
        return <McpWriteConfirm onPromptChange={setMcpRequestId} recoveryLink={mcpLink} />;
      default: {
        const unreachable: never = id;
        return unreachable;
      }
    }
  };

  return (
    <>
      {dialogRenderOrder(openIds).map((id) => (
        <Fragment key={id}>{slot(id)}</Fragment>
      ))}
    </>
  );
}
