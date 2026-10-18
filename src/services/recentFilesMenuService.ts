/**
 * Purpose: the typed frontend wrapper over `sync_recent_files_menu`, the one
 * IPC command that keeps the app-wide Open Recent menu in step with the
 * session list Rust owns (D43, design b). Windows send changes (`seed`,
 * `record`, `refresh`), never a whole list, and display the list Rust returns.
 *
 * Pipeline: `useRecentFiles` (seed / record, `viewMode: null`) and
 *   `useRecentFilesMenuRefresh` (refresh, real mode) → `syncRecentFilesMenu`
 *   → `invoke` → Rust merges, rebuilds the menu, returns the session list.
 *
 * Key decisions:
 * - Total over every outcome, never rejects: browser mode (`!isTauri()`)
 *   resolves `null` without invoking, a rejection resolves `null`, and a reply
 *   that is not a `string[]` resolves `null` (IPC trust boundary). `null`
 *   means "keep your local list".
 * - The `viewMode` key is always sent, `null` included, so the wire shape is
 *   fixed: `{ op, viewMode }`.
 * - A rejection logs one fail-level `ui.recent_files.menu_sync` record whose
 *   context is the op kind only. The error message is not forwarded: it can
 *   carry a path.
 *
 * @coordinates-with src/hooks/useRecentFiles.ts
 * @coordinates-with src/hooks/useRecentFilesMenuRefresh.ts
 * @coordinates-with src-tauri/src/commands/menu.rs — the Rust command
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";
import type { ViewMode } from "../types/editor";

/** A change to the session's Recent Files list, as sent over IPC. */
export type RecentOp =
  | { kind: "seed"; stored: string[] | null; pendingNewestFirst: string[] }
  | { kind: "record"; path: string }
  | { kind: "refresh" };

const COMMAND = "sync_recent_files_menu";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Apply `op` to the session list and rebuild the menu.
 *
 * @returns the session list Rust now holds, or `null` (browser mode, rejected
 *   call, or malformed reply) meaning the caller keeps its local list.
 */
export async function syncRecentFilesMenu(
  op: RecentOp,
  viewMode: ViewMode | null,
): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const reply: unknown = await invoke(COMMAND, { op, viewMode });
    return isStringArray(reply) ? reply : null;
  } catch {
    loggingService.logEventSync({
      level: "error",
      event: "ui.recent_files.menu_sync",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { op: op.kind },
    });
    return null;
  }
}
