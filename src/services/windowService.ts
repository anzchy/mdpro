import { invoke } from "@tauri-apps/api/core";

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
   * @returns Window ID of the created window
   */
  async createWindow(filePath?: string): Promise<string> {
    const response = await invoke<CreateWindowResponse>("create_window", {
      filePath: filePath ?? null,
    });
    return response.windowId;
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
