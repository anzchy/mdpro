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
 * Sync document state to Rust Shadow Store.
 * Called with debounce on content changes, immediate on open/close/switch.
 */
export async function syncDocuments(payload: SyncDocumentsPayload): Promise<void> {
  await invoke("mcp_sync_documents", { payload });
}

/**
 * MCP server status.
 */
export interface McpStatus {
  running: boolean;
  port: number | null;
  binaryPath: string;
}

/**
 * MCP client types.
 */
export type McpClient = "claude_desktop" | "claude_code" | "codex_cli" | "gemini_cli";

/**
 * MCP installation status for a single client.
 */
export interface McpInstallation {
  client: McpClient;
  installed: boolean;
  configPath: string;
}

/**
 * Get MCP server status.
 */
export async function getStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_get_status");
}

/**
 * Get installation status for all MCP clients.
 */
export async function getInstallations(): Promise<McpInstallation[]> {
  return invoke<McpInstallation[]>("mcp_get_installations");
}

/**
 * Install MCP config to a specific client.
 */
export async function installConfig(client: McpClient): Promise<void> {
  await invoke("mcp_install_config", { client });
}

/**
 * Remove MCP config from a specific client.
 */
export async function removeConfig(client: McpClient): Promise<void> {
  await invoke("mcp_remove_config", { client });
}

export const mcpService = {
  syncDocuments,
  getStatus,
  getInstallations,
  installConfig,
  removeConfig,
};
