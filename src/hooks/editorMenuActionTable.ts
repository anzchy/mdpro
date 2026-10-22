/**
 * Purpose: resolve M3b's `editor.<table id>` wire aliases, enforce the live
 * v1 route/mode/token gates, and write one `ui.menu.select` outcome per click.
 * Unknown aliases preserve the native action table's silent no-op contract.
 *
 * @coordinates-with menuActionTable.ts
 * @coordinates-with ../commands/commandTable.ts
 * @coordinates-with ../utils/editorMenuCommands.ts
 */
import type { Availability, Platform, Route } from "../commands/commandTable.types";
import { assertNever } from "../commands/assertNever";
import { rowByEditorWireAction } from "../commands/commandTable";
import { loggingService } from "../services/loggingService";
import { useEditorStore } from "../stores/editorStore";
import { useToastStore } from "../stores/toastStore";
import { isMacPlatform, isWindowsPlatform } from "../utils/platformLabels";
import { runEditorMenuCommand, type EditorMenuResult } from "../utils/editorMenuCommands";
import { isModalOpen } from "../utils/modalTabActionGuard";
import { isTokenCurrent, type MenuTargetToken } from "../utils/menuTargetToken";

type CancelReason =
  | "missing_token" | "missing_document" | "stale" | "modal_open" | "wrong_mode"
  | "non_frontend" | "unavailable" | NonNullable<EditorMenuResult["reason"]>;

function currentPlatform(): Platform {
  if (isMacPlatform()) return "macos";
  return isWindowsPlatform() ? "windows" : "linux";
}

/** Closed Route union: new variants fail typecheck until handled here. */
function frontendRoute(route: Route): boolean {
  switch (route) {
    case "frontend": return true;
    case "native": return false;
    case "rust-quit": return false;
    case "rust-hide": return false;
    case "unavailable": return false;
  }
  return assertNever(route);
}

/** Closed availability union; only the current version is read. */
function modeAllowed(availability: Availability, mode: string): boolean {
  switch (availability) {
    case "both": return mode === "wysiwyg" || mode === "source";
    case "W": return mode === "wysiwyg";
    case "S": return mode === "source";
    case "none": return false;
  }
  return assertNever(availability);
}

function logOutcome(actionId: string, id: string, reason?: CancelReason): void {
  loggingService.logEventSync({
    level: "info",
    event: "ui.menu.select",
    status: reason ? "cancel" : "success",
    actionId,
    context: reason ? { controlId: `editor.${id}`, reason } : { controlId: `editor.${id}` },
  });
}

/** Returns true when this is a known editor alias, even if refused. */
export function dispatchEditorMenuAction(action: string, token?: MenuTargetToken): boolean {
  const row = rowByEditorWireAction(action);
  if (!row) return false;
  const actionId = loggingService.generateActionId();
  const platform = currentPlatform();
  const mode = useEditorStore.getState().viewMode;
  let reason: CancelReason | undefined;
  if (!frontendRoute(row.route[platform])) reason = "non_frontend";
  else if (!modeAllowed(row.availability[platform].v1, mode)) reason = "wrong_mode";
  else if (!token) reason = "missing_token";
  else if (token.documentId === null) reason = "missing_document";
  else if (!isTokenCurrent(token)) reason = "stale";
  else if (isModalOpen()) reason = "modal_open";
  if (reason) {
    if (reason === "wrong_mode") {
      const required = row.availability[platform].v1 === "S" ? "Source" : "WYSIWYG";
      useToastStore.getState().showToast(`Available in ${required} mode only`);
    }
    logOutcome(actionId, row.id, reason);
    return true;
  }
  const result = runEditorMenuCommand(row.id, token!, actionId);
  if (row.id !== "format.image" || result.status !== "opened") {
    logOutcome(actionId, row.id, result.status === "refused" ? result.reason ?? "unavailable" : undefined);
  }
  return true;
}
