import { vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());
import { registerUnavailableOwnershipCases } from "./support/m1bUnavailableOwnership";
registerUnavailableOwnershipCases("linux");
