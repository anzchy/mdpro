/**
 * D32 WI-6 — `file.change.decision` logging in `useFileChangeDecisionLog`.
 * Matrix `.claude/tdd-guardian/tests-20260926-124422.md`, cases dh1-dh5.
 * Only the Tauri core/window modules are doubled; decideFileChange,
 * loggingService and useLoggingStore are real.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import { logLines, makeDoc, resetHarness } from "./helpers/fileWatcherLogHarness";
import { useFileChangeDecisionLog } from "../src/hooks/useFileChangeDecisionLog";
import type { FileChangedEvent } from "../src/hooks/useFileWatcher";
import type { Document } from "../src/types/document";
import { useLoggingStore } from "../src/stores/loggingStore";

const DECISION = "file.change.decision";
const TS = 1700000000777;

type Props = { e: FileChangedEvent | null; d: Document | null };

const eventA = (): FileChangedEvent => ({ path: "/tmp/b.md", changeType: "modified", timestamp: TS });
const docA = (overrides: Partial<Document> = {}) =>
  makeDoc({ id: "d1", path: "/tmp/b.md", isModified: false, ...overrides });

function mount(initialProps: Props) {
  return renderHook(({ e, d }: Props) => useFileChangeDecisionLog(e, d), { initialProps });
}

const ctx = (i: number) => logLines(DECISION)[i].context as Record<string, unknown>;

beforeEach(() => {
  resetHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("dh1: clean active doc matching the event", () => {
  it("logs exactly one reload-prompt line with the full context", () => {
    mount({ e: eventA(), d: docA() });

    const lines = logLines(DECISION);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", event: DECISION, status: "success" });
    expect(lines[0].context).toEqual({
      action: "reload-prompt",
      changeType: "modified",
      path: "/tmp/b.md",
      pathMatchesActive: true,
      isModified: false,
      documentId: "d1",
      windowLabel: "main",
      eventTimestamp: 1700000000777,
    });
  });
});

describe("dh2: key-preserving rerenders are idempotent", () => {
  it("stays at one line across 5 rerenders with new content, isModified toggles and cloned events", () => {
    const e = eventA();
    const { rerender } = mount({ e, d: docA() });
    const contents = ["a", "ab", "abc", "abcd", "abcde"];
    contents.forEach((content, i) => {
      rerender({ e: structuredClone(e), d: docA({ content, isModified: i % 2 === 0 }) });
    });

    expect(logLines(DECISION)).toHaveLength(1);
  });
});

describe("dh3: tab away and back re-logs with the same eventTimestamp (H6)", () => {
  it("logs reload-prompt/d1, ignore/d2, reload-prompt/d1", () => {
    const e = eventA();
    const { rerender } = mount({ e, d: docA() });
    rerender({ e, d: makeDoc({ id: "d2", path: "/tmp/c.md" }) });
    rerender({ e, d: docA() });

    const lines = logLines(DECISION);
    expect(lines).toHaveLength(3);
    expect(ctx(0)).toMatchObject({ action: "reload-prompt", documentId: "d1" });
    expect(lines[0].status).toBe("success");
    expect(lines[1].status).toBe("cancel");
    expect(ctx(1)).toMatchObject({
      action: "ignore",
      documentId: "d2",
      pathMatchesActive: false,
      activePath: "/tmp/c.md",
    });
    expect(ctx(2)).toMatchObject({ action: "reload-prompt", documentId: "d1" });
    for (let i = 0; i < 3; i++) expect(ctx(i).eventTimestamp).toBe(1700000000777);
  });
});

describe("dh4: null event or null doc", () => {
  it.each<[string, Props]>([
    ["null event", { e: null, d: docA() }],
    ["null doc", { e: eventA(), d: null }],
    ["both null", { e: null, d: null }],
  ])("%s logs nothing", (_label, props) => {
    mount(props);
    expect(logLines(DECISION)).toHaveLength(0);
  });

  it("null -> event -> null (Ignore clears the event) logs exactly one line", () => {
    const d = docA();
    const { rerender } = mount({ e: null, d });
    rerender({ e: eventA(), d });
    rerender({ e: null, d });

    expect(logLines(DECISION)).toHaveLength(1);
    expect(ctx(0)).toMatchObject({ action: "reload-prompt", documentId: "d1" });
  });
});

describe("dh5: dirty doc", () => {
  it("still gets reload-prompt and logs isModified:true", () => {
    mount({ e: eventA(), d: docA({ isModified: true }) });

    expect(logLines(DECISION)).toHaveLength(1);
    expect(ctx(0)).toMatchObject({ action: "reload-prompt", isModified: true });
  });
});
