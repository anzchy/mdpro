/**
 * D173-WI-1 — what the frontend does with the payload the live Rust test
 * `d173_wi1_live_b_alias_release_keeps_delivery` observes after an alias spelling is
 * released: notify reports the real (canonical) path, so a document opened at the
 * canonical spelling records a pending change. A document open at the alias spelling
 * records none: the frontend matches `doc.path === event.path` exactly. That second
 * assertion pins a recorded limit (delegator ruling: alias delivery is D185) and flips
 * when D185 lands.
 *
 * The payload is the committed fixture `tests/fixtures/d173-alias-payload.json`; the
 * live Rust test checks that its routed payload has the fixture's shape.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { bus, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { flush, mountPrompt, resetExternalChangeHarness } from "./support/externalChangeHarness";
import payload from "./fixtures/d173-alias-payload.json";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const ALIAS = "/tmp/d173/alias/a.md";

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({
    documents: [
      makeDoc({ id: "canonical", path: payload.path }),
      makeDoc({ id: "alias", path: ALIAS }),
    ],
    activeDocumentId: "alias",
  });
});

describe("D173-WI-1 — the alias-release payload reaches the canonical spelling only", () => {
  it("records a pending change for the canonical document, and none for the alias (D185 limit)", async () => {
    await mountPrompt();
    await flush(() => bus.emit("file:changed", payload));
    expect(pendingFileChangeFor("canonical")?.event.changeType).toBe("modified");
    expect(pendingFileChangeFor("alias")).toBeUndefined();
  });
});
