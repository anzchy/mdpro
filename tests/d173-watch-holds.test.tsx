/**
 * D173-WI-1 — the frontend close rule (plan r2 §3). Rust keys each watch hold by
 * (window, raw path) and a generation; every acquisition reply carries `holdGen`.
 * The window releases a path with `release_watch_hold({ path, gen })` once no
 * document in this window holds it and no in-flight open or Save As has reserved
 * it, carrying the latest gen it saw, so a release that races a reopen is `Stale` in
 * Rust. The decision runs after the store change (one documentStore subscription),
 * never from a snapshot taken before the close. `close_document` no longer carries
 * the path and never unwatches.
 *
 * Driven through App's real wiring and `useDocument`'s real entry points
 * (`tests/support/externalChangeHarness.tsx`) and the real `saveActiveDocumentAs`.
 * Mock boundary: the Tauri modules only.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./support/externalChangeIpc")).coreModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import {
  deferred,
  flush,
  ipcCalls,
  mountPrompt,
  onIpc,
  resetExternalChangeHarness,
  view,
} from "./support/externalChangeHarness";
import { saveActiveDocumentAs } from "../src/services/documentSave";
import { useDocumentStore } from "../src/stores/documentStore";
import { useLoggingStore } from "../src/stores/loggingStore";
import type { Document } from "../src/types/document";

const T0 = 1_700_000_000_000;
let pathSeq = 0;
let nextGen = 1;

/** A path no earlier case in this file used, so the module-level gen map cannot leak. */
const freshPath = (name: string) => `/tmp/d173/${name}-${(pathSeq += 1)}.md`;

const docAt = (id: string, path: string, content = "# on disk\n"): Document =>
  makeDoc({ id, path, content });

/** `open_file` answers with a document at the requested path and the next gen. */
function openFileAnswers(idFor: (path: string) => string) {
  onIpc("open_file", async (args) => ({
    document: docAt(idFor(String(args.path)), String(args.path)),
    recoveredDraft: null,
    changedSinceRead: false,
    holdGen: nextGen++,
  }));
}

const releases = () =>
  ipcCalls
    .filter((c) => c.cmd === "release_watch_hold")
    .map((c) => ({ path: c.args.path, gen: c.args.gen }));

async function open(path: string) {
  await flush(() => view.current!.api.openPathOutcome(path));
}

async function close(id: string) {
  await flush(() => view.current!.api.closeDocumentById(id, true));
}

beforeEach(() => {
  resetHarness();
  useDocumentStore.setState({ documents: [], activeDocumentId: null });
  resetExternalChangeHarness();
  onIpc("release_watch_hold", async () => "backendReleased");
  onIpc("delete_draft", async () => undefined);
  openFileAnswers(() => "p1");
  useLoggingStore.setState({ enabled: true, level: "info" });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("D173-WI-1 — a window releases a watch hold only when nothing in it holds the path", () => {
  it("(a) closing the last tab on a path releases it with the latest gen", async () => {
    const p = freshPath("a");
    nextGen = 41;
    await mountPrompt();
    await open(p);
    expect(releases()).toEqual([]);
    await close("p1");
    expect(releases()).toEqual([{ path: p, gen: 41 }]);
  });

  it("(b) one of two same-path tabs closing does not release; the second does", async () => {
    const p = freshPath("b");
    nextGen = 7;
    await mountPrompt();
    await open(p);
    act(() => useDocumentStore.getState().upsertDocument(docAt("p1b", p)));
    await close("p1");
    expect(releases()).toEqual([]);
    await close("p1b");
    expect(releases()).toEqual([{ path: p, gen: 7 }]);
  });

  it("(c) both same-path tabs closing in one tick release exactly once", async () => {
    const p = freshPath("c");
    nextGen = 9;
    await mountPrompt();
    await open(p);
    act(() => useDocumentStore.getState().upsertDocument(docAt("p1b", p)));
    await flush(() =>
      Promise.all([view.current!.api.closeDocumentById("p1", true), view.current!.api.closeDocumentById("p1b", true)]),
    );
    expect(releases()).toEqual([{ path: p, gen: 9 }]);
  });

  it("(d) a cancelled encoding retry releases the hold its open_file took", async () => {
    const p = freshPath("d");
    nextGen = 5;
    await mountPrompt();
    const controller = new AbortController();
    controller.abort();
    let kind = "";
    await flush(async () => {
      kind = (await view.current!.api.openDocumentWithEncoding(p, "GBK", undefined, controller.signal)).kind;
    });
    expect(kind).toBe("cancelled");
    expect(useDocumentStore.getState().documents).toEqual([]);
    expect(releases()).toEqual([{ path: p, gen: 5 }]);
  });

  it("(e) Save As releases the old path, and the new path's gen is the one a later close sends", async () => {
    const p = freshPath("e");
    const q = freshPath("e-copy");
    nextGen = 11;
    await mountPrompt();
    await open(p);
    onIpc("save_file_dialog", async () => ({
      success: true,
      path: q,
      savedAt: T0 + 5,
      changedSinceRead: false,
      blockedByPendingChange: false,
      holdGen: 12,
    }));
    await flush(() => saveActiveDocumentAs());
    expect(useDocumentStore.getState().getDocumentById("p1")?.path).toBe(q);
    expect(releases()).toEqual([{ path: p, gen: 11 }]);
    await close("p1");
    expect(releases()).toEqual([
      { path: p, gen: 11 },
      { path: q, gen: 12 },
    ]);
  });

  it("(e2) Save As keeps the old path's hold while a sibling tab still holds it", async () => {
    const p = freshPath("e2");
    const q = freshPath("e2-copy");
    nextGen = 21;
    await mountPrompt();
    await open(p);
    act(() => useDocumentStore.getState().upsertDocument(docAt("p1b", p)));
    act(() => {
      view.current!.api.setActiveDocumentById("p1");
    });
    onIpc("save_file_dialog", async () => ({
      success: true,
      path: q,
      savedAt: T0 + 5,
      changedSinceRead: false,
      blockedByPendingChange: false,
      holdGen: 22,
    }));
    await flush(() => saveActiveDocumentAs());
    expect(useDocumentStore.getState().getDocumentById("p1")?.path).toBe(q);
    expect(releases()).toEqual([]);
    await close("p1b");
    expect(releases()).toEqual([{ path: p, gen: 21 }]);
  });

  it("(f) a followed rename releases the old path", async () => {
    const p = freshPath("f");
    const r = freshPath("f-renamed");
    nextGen = 31;
    await mountPrompt();
    await open(p);
    act(() => useDocumentStore.getState().updateDocumentPath("p1", r));
    expect(releases()).toEqual([{ path: p, gen: 31 }]);
  });

  it("(g) a close then a reopen: the close sends the old gen, the next close the new one", async () => {
    const p = freshPath("g");
    nextGen = 51;
    await mountPrompt();
    await open(p);
    await close("p1");
    await open(p);
    await close("p1");
    expect(releases()).toEqual([
      { path: p, gen: 51 },
      { path: p, gen: 52 },
    ]);
  });

  it("(g2) a close while a reopen of the path is in flight releases nothing; the reopen's gen is kept", async () => {
    const p = freshPath("g2");
    nextGen = 61;
    await mountPrompt();
    await open(p);
    const held = deferred<unknown>();
    onIpc("open_file", () => held.promise);
    let reopening: Promise<unknown> = Promise.resolve();
    act(() => {
      reopening = view.current!.api.openPathOutcome(p);
    });
    await close("p1");
    expect(releases()).toEqual([]);
    await flush(async () => {
      held.resolve({ document: docAt("p1", p), recoveredDraft: null, changedSinceRead: false, holdGen: 62 });
      await reopening;
    });
    expect(useDocumentStore.getState().getDocumentById("p1")?.path).toBe(p);
    expect(releases()).toEqual([]);
    await close("p1");
    expect(releases()).toEqual([{ path: p, gen: 62 }]);
  });

  it("(h) a rejected release is logged as file.watch.release fail, never thrown", async () => {
    const p = freshPath("h");
    nextGen = 71;
    onIpc("release_watch_hold", async () => {
      throw new Error("release refused (harness)");
    });
    await mountPrompt();
    await open(p);
    await expect(
      Promise.resolve(act(async () => {
        await view.current!.api.closeDocumentById("p1", true);
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      })),
    ).resolves.toBeUndefined();
    expect(releases()).toEqual([{ path: p, gen: 71 }]);
    const failed = logLines("file.watch.release").filter((l) => l.status === "fail");
    expect(failed).toHaveLength(1);
  });

  it("(i) an open that focuses the existing dirty tab keeps the hold, and a later close sends the newer gen", async () => {
    const p = freshPath("i");
    nextGen = 81;
    await mountPrompt();
    await open(p);
    act(() => useDocumentStore.getState().markDocumentModified("p1", true));
    await open(p);
    expect(useDocumentStore.getState().getDocumentById("p1")?.isModified).toBe(true);
    expect(releases()).toEqual([]);
    await close("p1");
    expect(releases()).toEqual([{ path: p, gen: 82 }]);
  });

  it("(j) close_document no longer carries the path", async () => {
    const p = freshPath("j");
    await mountPrompt();
    await open(p);
    await close("p1");
    const closes = ipcCalls.filter((c) => c.cmd === "close_document");
    expect(closes).toHaveLength(1);
    expect(closes[0].args).not.toHaveProperty("path");
  });

  it("(k) guard: a document whose path this window never acquired releases nothing", async () => {
    const p = freshPath("k");
    act(() => useDocumentStore.getState().upsertDocument(docAt("k1", p)));
    await mountPrompt();
    await close("k1");
    expect(releases()).toEqual([]);
  });
});
