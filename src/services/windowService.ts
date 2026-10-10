import { invoke } from "@tauri-apps/api/core";
import { loggingService } from "./loggingService";

/**
 * The error `create_window` returns while a quit request is live (D74,
 * `quit_guard::window_gate::QUIT_PENDING_REFUSAL`). It is the quit guard
 * keeping a window out of a quit that could not protect it, not a failure.
 */
export const QUIT_PENDING_WINDOW_REFUSAL = "window_refused_quit_pending";

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CreateWindowResponse {
  windowId: string;
}

interface GetWindowGeometryResponse {
  geometry: WindowGeometry | null;
}

export const windowService = {
  /**
   * Create a new mdpro window
   * @param filePath Optional file to open in the new window
   * @returns Window ID of the created window, or `null` when a pending quit
   *   refused it (D74) — logged as a `window.create` cancel, never thrown.
   *   Any other error still rejects.
   */
  async createWindow(filePath?: string): Promise<string | null> {
    try {
      const response = await invoke<CreateWindowResponse>("create_window", {
        filePath: filePath ?? null,
      });
      return response.windowId;
    } catch (error) {
      if (error !== QUIT_PENDING_WINDOW_REFUSAL) throw error;
      loggingService.logEventSync({
        level: "info",
        event: "window.create",
        status: "cancel",
        actionId: loggingService.generateActionId(),
        context: { reason: "quit_pending" },
      });
      return null;
    }
  },

  /**
   * Save window geometry for a file
   */
  async saveWindowGeometry(
    filePath: string,
    geometry: WindowGeometry
  ): Promise<void> {
    await invoke("save_window_geometry", { filePath, geometry });
  },

  /**
   * Get stored window geometry for a file
   * @returns Geometry or null if not stored
   */
  async getWindowGeometry(filePath: string): Promise<WindowGeometry | null> {
    const response = await invoke<GetWindowGeometryResponse>(
      "get_window_geometry",
      {
        filePath,
      }
    );
    return response.geometry;
  },
};
