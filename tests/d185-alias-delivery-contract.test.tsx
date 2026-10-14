/**
 * D185-WI-2 — the frontend half of the alias fan-out, a contract guard. The Rust
 * watcher sends one `file:changed` per held spelling of the changed file, every copy
 * with the one timestamp and change type (and, for a rename, the real new path). The
 * frontend is unchanged: it matches `doc.path === event.path` exactly, so each copy
 * reaches the document open at that spelling. Two tabs, one at the real path and one
 * at an alias, both get a pending record. Passes before WI-2 lands: what it pins is
 * that the frontend needs no change for the Rust fan-out to work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { bus, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { flush, mountPrompt, resetExternalChangeHarness } from "./support/externalChangeHarness";
import { useDocumentStore } from "../src/stores/documentStore";
import { pendingFileChangeFor } from "../src/stores/externalChangeStore";
import { useLoggingStore } from "../src/stores/loggingStore";

const REAL = "/private/tmp/d185/real/a.md";
const ALIAS = "/tmp/d185/alias/a.md";
const MOVED = "/private/tmp/d185/real/moved.md";
const STAMP = 1700000000777;

/** The copies the Rust fan-out emits for one routed event. */
function copies(changeType: string, newPath: string | null = null) {
  return [REAL, ALIAS].map((path) => ({ path, changeType, newPath, timestamp: STAMP }));
}

beforeEach(() => {
  resetHarness();
  resetExternalChangeHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
  useDocumentStore.setState({
    documents: [makeDoc({ id: "real", path: REAL }), makeDoc({ id: "alias", path: ALIAS })],
    activeDocumentId: "alias",
  });
});

describe("D185-WI-2 — one fanned-out copy per spelling reaches each tab", () => {
  it.each(["modified", "deleted"])("a %s copy per spelling leaves both documents pending", async (changeType) => {
    await mountPrompt();
    for (const payload of copies(changeType)) await flush(() => bus.emit("file:changed", payload));
    for (const id of ["real", "alias"]) {
      const pending = pendingFileChangeFor(id);
      expect(pending?.event.changeType, id).toBe(changeType);
      expect(pending?.event.timestamp, id).toBe(STAMP);
    }
    expect(pendingFileChangeFor("real")?.path).toBe(REAL);
    expect(pendingFileChangeFor("alias")?.path).toBe(ALIAS);
  });

  it("a renamed copy per spelling gives both documents the real new path", async () => {
    await mountPrompt();
    for (const payload of copies("renamed", MOVED)) await flush(() => bus.emit("file:changed", payload));
    for (const id of ["real", "alias"]) {
      const pending = pendingFileChangeFor(id);
      expect(pending?.event.changeType, id).toBe("renamed");
      expect(pending?.event.newPath, id).toBe(MOVED);
    }
  });

  it("the real-path copy alone still reaches only the real-path tab (exact match)", async () => {
    await mountPrompt();
    await flush(() => bus.emit("file:changed", copies("modified")[0]));
    expect(pendingFileChangeFor("real")?.event.changeType).toBe("modified");
    expect(pendingFileChangeFor("alias")).toBeUndefined();
  });
});
