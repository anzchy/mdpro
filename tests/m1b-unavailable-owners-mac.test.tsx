import { vi } from "vitest";
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("@tauri-apps/api/core", async () => (await import("./support/tauriCoreMock")).createTauriCoreMock());
import { registerUnavailableOwnershipCases } from "./support/m1bUnavailableOwnership";
registerUnavailableOwnershipCases("macos");
