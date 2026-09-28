/**
 * MCP Service
 *
 * Purpose: typed IPC wrappers for the MCP Tauri commands, and the TS side of
 * the MCP status / switch wire contract.
 *
 * Key decisions:
 * - The enum lists (`MCP_PHASES`, `MCP_SERVER_ERRORS`, `MCP_SWITCH_ERRORS`,
 *   `MCP_CONFIGURED_STATES`) are the source of their unions and are pinned to
 *   `tests/fixtures/mcp-status-contract.json`, which Rust also reads.
 * - `setServerEnabled` (ADR-0040) never lets a raw rejection escape: it throws
 *   `McpSwitchFailure` with a list member or `"unknown"`.
 *
 * @coordinates-with src-tauri/src/commands/mcp.rs — `mcp_get_status` and the MCP commands
 * @coordinates-with src/utils/mcpStatusView.ts — consumes `McpStatus`
 * @module services/mcpService
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
 * Every phase Rust's `McpPhase` serialises to (ADR-0040 decision 5). The
 * {@link McpPhase} union is derived from this list, and
 * `tests/mcp-status-contract.test.ts` pins it (and the lists below) to the
 * shared fixture `tests/fixtures/mcp-status-contract.json` that Rust also reads.
 */
export const MCP_PHASES = ["disabled", "starting", "running", "stopping", "failed"] as const;
/** Where the MCP server is in its lifecycle now. */
export type McpPhase = (typeof MCP_PHASES)[number];

/** Every value of Rust's `McpServerError`: why the phase is `failed`. */
export const MCP_SERVER_ERRORS = ["bind_in_use", "bind_failed", "publish_failed", "serve_failed"] as const;
/** Why the server is `failed`; payload-free (no path, no OS text). */
export type McpServerError = (typeof MCP_SERVER_ERRORS)[number];

/**
 * Every error string the live switch command can reject with (ADR-0040,
 * fixture `switchError`, PC-4). {@link setServerEnabled} narrows a rejection to
 * one of these, or to `"unknown"`.
 */
export const MCP_SWITCH_ERRORS = [
  "config_unreadable",
  "exiting",
  "persist_failed",
  "status_unavailable",
] as const;
/** A rejection reason of the live switch command. */
export type McpSwitchError = (typeof MCP_SWITCH_ERRORS)[number];

/**
 * Every value of the on-disk `mcp.serverEnabled` as Rust reports it. It is read
 * fresh on each `mcp_get_status` call, and a missing value reports `enabled`.
 */
export const MCP_CONFIGURED_STATES = ["enabled", "disabled", "unreadable"] as const;
/** The on-disk setting at call time; `unreadable` means the read failed (fail-open). */
export type McpConfigured = (typeof MCP_CONFIGURED_STATES)[number];

/**
 * MCP server status, as serialised by Rust `mcp_get_status` (camelCase keys,
 * snake_case enum values). The only TS declaration of this type (ADR-0039 D-6);
 * `launch` became `phase` + `error` in ADR-0040 decision 5.
 */
export interface McpStatus {
  /** Compatibility field: a port is bound. Independent of `phase`. */
  running: boolean;
  port: number | null;
  binaryPath: string;
  /** Where the server is now (ADR-0040). */
  phase: McpPhase;
  /** Why it failed; always present on the wire, `null` when not failed. */
  error: McpServerError | null;
  /** The on-disk `serverEnabled`, read at call time — can differ from `phase`. */
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

/**
 * True iff `value` is exactly one of {@link MCP_SWITCH_ERRORS}. Anything else —
 * a differently-cased or padded string, an `Error`, an object — is not.
 */
export function isMcpSwitchError(value: unknown): value is McpSwitchError {
  return typeof value === "string" && (MCP_SWITCH_ERRORS as readonly string[]).includes(value);
}

/**
 * The one rejection {@link setServerEnabled} raises. `error` is the narrowed
 * reason: a {@link McpSwitchError}, or `"unknown"` for any other rejection. The
 * message carries only that enum value (no path, no OS text).
 */
export class McpSwitchFailure extends Error {
  readonly error: McpSwitchError | "unknown";

  constructor(error: McpSwitchError | "unknown") {
    super(`mcp_set_server_enabled refused: ${error}`);
    this.name = "McpSwitchFailure";
    this.error = error;
  }
}

/**
 * Turn the MCP server on or off now and persist the choice (ADR-0040
 * decision 1). Resolves to the status Rust returns after the switch — which can
 * be `failed` with `configured: "enabled"` when the setting saved but the
 * server could not start. Rejects only with an {@link McpSwitchFailure}.
 */
export async function setServerEnabled(enabled: boolean): Promise<McpStatus> {
  try {
    return await invoke<McpStatus>("mcp_set_server_enabled", { enabled });
  } catch (rejection: unknown) {
    throw new McpSwitchFailure(isMcpSwitchError(rejection) ? rejection : "unknown");
  }
}

export const mcpService = {
  syncDocuments,
  getStatus,
  setServerEnabled,
  getInstallations,
  installConfig,
  removeConfig,
};
