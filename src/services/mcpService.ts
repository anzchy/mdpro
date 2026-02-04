/**
 * MCP Service
 *
 * Provides IPC wrappers for MCP-related Tauri commands.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Document state for MCP sync.
 * Matches the Rust `DocumentState` struct.
 */
export interface McpDocumentState {
  id: string;
  title: string;
  path: string | null;
  content: string;
  cursor: number;
  is_dirty: boolean;
  is_active: boolean;
}

/**
 * Payload for syncing documents to Rust Shadow Store.
 */
export interface SyncDocumentsPayload {
  windowLabel: string;
  documents: McpDocumentState[];
  activeDocumentId: string | null;
}

/**
 * Server info returned from Rust.
 */
export interface McpServerInfo {
  port: number;
  token: string;
}

/**
 * Sync document state to Rust Shadow Store.
 * Called with debounce on content changes, immediate on open/close/switch.
 */
export async function syncDocuments(payload: SyncDocumentsPayload): Promise<void> {
  await invoke("mcp_sync_documents", { payload });
}

/**
 * Get MCP server info (for debugging/testing).
 */
export async function getServerInfo(): Promise<McpServerInfo | null> {
  return invoke<McpServerInfo | null>("mcp_get_server_info");
}

export const mcpService = {
  syncDocuments,
  getServerInfo,
};
