/**
 * D32 WI-6 — `useFileChangeDecisionLog` arms, wiring and failure handling.
 * Matrix `.claude/tdd-guardian/tests-20260926-124422.md`, cases dh6-dh10.
 * Only the Tauri core/window modules are doubled; decideFileChange,
 * loggingService and useLoggingStore are real.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", async () => (await import("./helpers/fileWatcherLogHarness")).eventModule);
vi.mock("@tauri-apps/api/core", async () => (await import("./helpers/fileWatcherLogHarness")).coreModule);
vi.mock("@tauri-apps/api/window", async () => (await import("./helpers/fileWatcherLogHarness")).windowModule);

import { logLines, makeDoc, resetHarness, setWindowThrows } from "./helpers/fileWatcherLogHarness";
import { useFileChangeDecisionLog } from "../src/hooks/useFileChangeDecisionLog";
import type { FileChangedEvent } from "../src/hooks/useFileWatcher";
import type { Document } from "../src/types/document";
import { decideFileChange } from "../src/utils/dataLossGuards";
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

function hasKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
}

beforeEach(() => {
  resetHarness();
  useLoggingStore.setState({ enabled: true, level: "info" });
});

describe("dh6: logged action equals the real decision over the changeType domain", () => {
  const cases: Array<[FileChangedEvent, string]> = [
    [{ path: "/tmp/b.md", changeType: "modified", timestamp: TS }, "reload-prompt"],
    [{ path: "/tmp/b.md", changeType: "deleted", timestamp: TS }, "deleted-prompt"],
    [{ path: "/tmp/b.md", changeType: "renamed", newPath: "/tmp/c.md", timestamp: TS }, "rename"],
    [{ path: "/tmp/b.md", changeType: "renamed", timestamp: TS }, "reload-prompt"],
  ];

  it.each(cases)("%o -> %s, with no message", (e, expected) => {
    const d = docA();
    const { unmount } = mount({ e, d });
    unmount();

    const lines = logLines(DECISION);
    expect(lines).toHaveLength(1);
    expect(ctx(0).action).toBe(expected);
    expect(ctx(0).action).toBe(decideFileChange(e, d).action);
    expect(JSON.stringify(lines[0])).not.toContain("externally");
    expect(hasKeyDeep(lines[0], "message")).toBe(false);
  });
});

describe("dh7: a new event on the same doc re-logs", () => {
  it("logs a second line carrying the new eventTimestamp", () => {
    const e = eventA();
    const d = docA();
    const { rerender } = mount({ e, d });
    rerender({ e: { ...e, timestamp: 1700000009999 }, d });

    expect(logLines(DECISION)).toHaveLength(2);
    expect(ctx(1).eventTimestamp).toBe(1700000009999);
  });
});

describe("dh8: wiring (source text) — in useExternalChangePrompt since D171", () => {
  const src = readFileSync(resolve(__dirname, "../src/hooks/useExternalChangePrompt.ts"), "utf8");
  const app = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");

  it("calls the hook exactly once with (fileChangeEvent, activeDocument), after useFileWatcher(", () => {
    const calls = [...src.matchAll(/useFileChangeDecisionLog\(\s*fileChangeEvent\s*,\s*activeDocument\s*\)/g)];
    expect(calls).toHaveLength(1);
    const watcherIdx = src.indexOf("useFileWatcher(");
    expect(watcherIdx).toBeGreaterThanOrEqual(0);
    expect(calls[0].index).toBeGreaterThan(watcherIdx);
  });

  it("keeps a single `const decision = decideFileChange(`, and none left in App.tsx", () => {
    expect((src.match(/const decision = decideFileChange\(/g) ?? []).length).toBe(1);
    expect(app).not.toMatch(/decideFileChange\(/);
  });

  it("imports the hook from ./useFileChangeDecisionLog", () => {
    expect(src).toMatch(/import\s*\{[^}]*\buseFileChangeDecisionLog\b[^}]*\}\s*from\s*"\.\/useFileChangeDecisionLog"/);
  });
});

describe("dh9: getCurrentWindow throws inside the decision hook", () => {
  it("does not throw, and logs one line with windowLabel 'unknown'", () => {
    setWindowThrows(true);
    let hook: ReturnType<typeof mount> | undefined;
    expect(() => {
      hook = mount({ e: eventA(), d: docA() });
    }).not.toThrow();
    expect(hook).toBeDefined();
    expect((hook as unknown as { result: { error?: unknown } }).result.error).toBeUndefined();

    const lines = logLines(DECISION);
    expect(lines).toHaveLength(1);
    expect(lines[0].context).toEqual({
      action: "reload-prompt",
      changeType: "modified",
      path: "/tmp/b.md",
      pathMatchesActive: true,
      isModified: false,
      documentId: "d1",
      windowLabel: "unknown",
      eventTimestamp: 1700000000777,
    });
  });
});

describe("dh10: Save As on the active doc re-logs through decisionLogKey", () => {
  it("logs reload-prompt then ignore for the same doc id and the same event object", () => {
    const e = eventA();
    const { rerender } = mount({ e, d: docA() });
    rerender({ e, d: makeDoc({ id: "d1", path: "/tmp/saved-as.md", isModified: false }) });

    const lines = logLines(DECISION);
    expect(lines).toHaveLength(2);
    expect(ctx(0)).toMatchObject({ action: "reload-prompt", pathMatchesActive: true, documentId: "d1" });
    expect(lines[1].status).toBe("cancel");
    expect(ctx(1)).toMatchObject({
      action: "ignore",
      pathMatchesActive: false,
      activePath: "/tmp/saved-as.md",
      documentId: "d1",
      eventTimestamp: 1700000000777,
    });
  });
});
