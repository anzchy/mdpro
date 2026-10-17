/**
 * M1A-WI-6 R2-1a / R3-4 — the composed Milkdown editor's key handling on linux
 * (slow lane). navigator.platform is set before any import, because
 * prosemirror-keymap and prosemirror-commands read it once at module load.
 */
import { vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
});

vi.mock("@tauri-apps/api/core", async () => ({
  ...(await import("./support/tauriCoreMock")).createTauriCoreMock(),
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { runProbeSuite } from "./support/milkdownProbeSuite";

runProbeSuite("linux", "slow");
