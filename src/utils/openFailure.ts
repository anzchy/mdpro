/**
 * Purpose: the open-failure helpers shared by the open entry points. Classifies
 * an `open_file` rejection as a decode failure (which gets the encoding-reopen
 * prompt) or not, holds the one user-facing copy for any other failed open, and
 * reports such a failure with that copy as a toast plus a path-free log line.
 *
 * Key decisions:
 * - `parseEncodingError` moved unchanged out of `useDocument.ts` (D46 WI-1) so
 *   that hook stays under the 300-line budget. It accepts the serialized
 *   `FileError::EncodingError` object form and, as a fallback, any object whose
 *   `message` contains "EncodingError" (payload unknown, so the sentinel
 *   `{ path: "", detected: "unknown" }`). Bare strings are never parsed, and the
 *   payload is returned as-is; defaulting is the caller's job.
 * - `OPEN_FAILED_MESSAGE` is the ⌘O copy and carries no path, so a toast or log
 *   built from it never leaks a file location.
 * - `reportOpenFailure` (D46 WI-2) is the single reporter for a non-encoding
 *   failure of `useDocument.openPathOutcome`, so every external open (`?open=`, drop,
 *   recent files, launch paths, open-in-window) shows the same toast as ⌘O.
 *   It reuses the per-window toast store rather than adding a second channel.
 *   ⌘O does not call it: `openDocumentFromDialog` re-throws and `App.tsx`
 *   shows the same copy itself, so there is exactly one toast per failure.
 * - It also logs one `file.open.report` fail (D46 review, rule 20), so routes
 *   with no log of their own (launch paths, Open Recent) still leave a trace.
 *   The context is `{ reason }` only: a `FileError` variant name from a closed
 *   allowlist, else "unknown". The path, size and message are never logged.
 *
 * @coordinates-with src/hooks/useDocument.ts — the open entry points that classify rejections
 * @coordinates-with src/stores/toastStore.ts — where the report is shown
 * @coordinates-with src/services/loggingService.ts — where the report is logged
 * @coordinates-with src/App.tsx — `handleOpenDialog` shows `OPEN_FAILED_MESSAGE` for ⌘O
 */

import { loggingService } from "../services/loggingService";
import { useToastStore } from "../stores/toastStore";

/** The ⌘O copy shown for any open that fails for a reason other than encoding. */
export const OPEN_FAILED_MESSAGE = "Failed to open file";

/** Serialized `FileError` variant names (src-tauri/src/commands/file.rs). */
const FILE_ERROR_VARIANTS: ReadonlySet<string> = new Set([
  "FileNotFound",
  "PermissionDenied",
  "EncodingError",
  "FileTooLarge",
  "DiskFull",
  "InvalidPath",
  "IoError",
]);

/**
 * The `FileError` variant name of `error`, or "unknown". Only a known variant
 * name can come out, so no path, size or message ever reaches a log line.
 */
function failureReason(error: unknown): string {
  if (typeof error === "string") return FILE_ERROR_VARIANTS.has(error) ? error : "unknown";
  if (error && typeof error === "object" && !(error instanceof Error)) {
    const keys = Object.keys(error);
    if (keys.length === 1 && FILE_ERROR_VARIANTS.has(keys[0])) return keys[0];
  }
  return "unknown";
}

/**
 * Report a failed open: one `OPEN_FAILED_MESSAGE` toast in this window (the store
 * replaces rather than stacks), and one `file.open.report` fail log whose context
 * is only `{ reason }`, the `FileError` variant name. `actionId` ties the log to
 * the caller's open; without one a fresh id is generated.
 */
export function reportOpenFailure(error?: unknown, actionId?: string): void {
  useToastStore.getState().showToast(OPEN_FAILED_MESSAGE);
  loggingService.logEventSync({
    level: "error",
    event: "file.open.report",
    status: "fail",
    actionId: actionId ?? loggingService.generateActionId(),
    context: { reason: failureReason(error) },
  });
}

/** The decode-failure payload when `error` is an encoding error, otherwise null. */
export const parseEncodingError = (error: unknown) => {
  if (!error || typeof error !== "object") return null;
  const maybe = error as { EncodingError?: { path: string; detected: string } };
  if (maybe.EncodingError) return maybe.EncodingError;
  const message = (error as { message?: string }).message;
  if (message && message.includes("EncodingError")) {
    return { path: "", detected: "unknown" };
  }
  return null;
};
