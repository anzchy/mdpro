import { invoke } from "@tauri-apps/api/core";

export const updaterService = {
  async getAppVersion(): Promise<string> {
    return invoke<string>("get_app_version");
  },
};
