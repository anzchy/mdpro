/**
 * Purpose: the typed IPC wrapper for `mcp_confirm_reply` (ADR-0042) — this
 * window's answer to the in-window MCP write confirmation it is showing.
 *
 * Key decisions:
 * - **Wire args are exactly `{ requestId, approved }`.** No window label: Rust
 *   takes it from the calling webview and checks the reply came from the owning
 *   window, so a label in the payload would be a spoofable input (rule 60).
 * - **The verdict is returned, not interpreted.** `ignoredUnknown`,
 *   `ignoredWrongWindow` and `ignoredNotShown` are normal races (the request
 *   already ended), not errors; the caller decides what to do with them.
 * - **Errors are narrowed, never cast** (rule 50): `invoke` often rejects with a
 *   bare string, so the caller always receives a real `Error`. A failed reply
 *   logs `mcp.confirm.reply` (status `fail`) with the request id and the answer
 *   only — never the document title or content.
 *
 * @module src/services/mcpConfirmService
 * @coordinates-with src-tauri/src/commands/mcp_confirm.rs — `mcp_confirm_reply`
 * @coordinates-with src/utils/mcpConfirmModel.ts — `McpConfirmVerdict`
 */

import { invoke } from "@tauri-apps/api/core";

import type { McpConfirmVerdict } from "../utils/mcpConfirmModel";
import { loggingService } from "./loggingService";

/**
 * Answer the confirmation `requestId` shown in this window.
 *
 * @returns the backend's verdict for this reply.
 * @throws {Error} when the command rejects — always an `Error`, whatever Rust threw.
 */
export async function reply(requestId: string, approved: boolean): Promise<McpConfirmVerdict> {
  try {
    return await invoke<McpConfirmVerdict>("mcp_confirm_reply", { requestId, approved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggingService.logEventSync({
      level: "error",
      event: "mcp.confirm.reply",
      status: "fail",
      actionId: loggingService.generateActionId(),
      context: { requestId, approved },
      error: message,
    });
    throw new Error(`mcp_confirm_reply failed: ${message}`);
  }
}

export const mcpConfirmService = { reply };
