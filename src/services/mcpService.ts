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
  /**
   * True once this window's `file:open-in-window` listener is live, so Rust may
   * route an external open here (ADR-0033 Decision 3). Rust reads a missing key
   * as false.
   */
  routable: boolean;
}

/**
 * Sync document state to Rust Shadow Store.
 * Called with debounce on content changes, immediate on open/close/switch.
 */
export async function syncDocuments(payload: SyncDocumentsPayload): Promise<void> {
  await invoke("mcp_sync_documents", { payload });
}

/**
 * Every launch state Rust's `McpLaunchStatus` serialises to (ADR-0039). The
 * {@link McpLaunch} union is derived from this list, and
 * `tests/mcp-status-contract.test.ts` pins it to the shared fixture
 * `tests/fixtures/mcp-status-contract.json` that the Rust lane also reads.
 */
export const MCP_LAUNCH_STATES = ["starting", "running", "failed", "disabled"] as const;
/** What the launch decided and whether the bind succeeded. Set once per launch. */
export type McpLaunch = (typeof MCP_LAUNCH_STATES)[number];

/**
 * Every value of the on-disk `mcp.serverEnabled` as Rust reports it. It is read
 * fresh on each `mcp_get_status` call, and a missing value reports `enabled`.
 */
export const MCP_CONFIGURED_STATES = ["enabled", "disabled", "unreadable"] as const;
/** The on-disk setting at call time; `unreadable` means the read failed (fail-open). */
export type McpConfigured = (typeof MCP_CONFIGURED_STATES)[number];

/**
 * MCP server status, as serialised by Rust `mcp_get_status` (camelCase keys,
 * lowercase enum values). The only TS declaration of this type (ADR-0039 D-6).
 */
export interface McpStatus {
  /** Compatibility field: a port is bound. Independent of `launch`. */
  running: boolean;
  port: number | null;
  binaryPath: string;
  /** Launch state, fixed once the launch settles (ADR-0039). */
  launch: McpLaunch;
  /** The on-disk `serverEnabled`, read at call time — can differ from `launch`. */
  configured: McpConfigured;
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
