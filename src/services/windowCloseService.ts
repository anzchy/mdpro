/** The native close-ordering step; app commands need no window-plugin capability. */
import { invoke } from "@tauri-apps/api/core";

export const windowCloseService = {
  stage(windowLabel: string): Promise<void> {
    return invoke("window_close_order", { windowLabel, operation: "stage" });
  },
  restore(windowLabel: string): Promise<void> {
    return invoke("window_close_order", { windowLabel, operation: "restore" });
  },
};
