// @vitest-environment node
/**
 * D32 WI-4 — `buildFileChangeDecisionLog` (matrix cases fl1-fl4).
 *
 * Pure builder for the `file.change.decision` log line. The decision is always
 * computed by the real `decideFileChange`, so the log is checked against what the
 * app actually decided, not against a hand-written expectation of it.
 */
import { describe, expect, it } from "vitest";
import { decideFileChange } from "../src/utils/dataLossGuards";
import { buildFileChangeDecisionLog, type FileChangeLogEvent } from "../src/utils/fileChangeLog";
import type { Document } from "../src/types/document";

const TS = 1700000000777;

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "d1",
    path: "/tmp/b.md",
    content: "x",
    encoding: "utf-8",
    lineEnding: "lf",
    isModified: false,
    lastSaved: null,
    fileSize: null,
    ...overrides,
  };
}

const MODIFIED: FileChangeLogEvent = { path: "/tmp/b.md", changeType: "modified", timestamp: TS };
const DELETED: FileChangeLogEvent = { path: "/tmp/b.md", changeType: "deleted", timestamp: TS };
const RENAMED: FileChangeLogEvent = {
  path: "/tmp/b.md",
  changeType: "renamed",
  newPath: "/tmp/c.md",
  timestamp: TS,
};
const OTHER: FileChangeLogEvent = { path: "/tmp/other.md", changeType: "modified", timestamp: TS };

function build(event: FileChangeLogEvent, doc: Document) {
  return buildFileChangeDecisionLog({
    event,
    activeDoc: doc,
    decision: decideFileChange(event, doc),
    windowLabel: "w2",
    actionId: "a1",
  });
}

function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      allKeys(child, out);
    }
  }
  return out;
}

describe("fl1: the four decision arms, exact payloads", () => {
  const doc = makeDoc({ id: "d1", path: "/tmp/b.md", isModified: false, content: "x" });
  const base = { isModified: false, documentId: "d1", windowLabel: "w2", eventTimestamp: TS };

  it("reload-prompt (modified, same path) -> success", () => {
    expect(build(MODIFIED, doc)).toEqual({
      level: "info",
      event: "file.change.decision",
      status: "success",
      actionId: "a1",
      context: {
        action: "reload-prompt",
        changeType: "modified",
        path: "/tmp/b.md",
        pathMatchesActive: true,
        ...base,
      },
    });
  });

  it("deleted-prompt (deleted, same path) -> success", () => {
    expect(build(DELETED, doc)).toEqual({
      level: "info",
      event: "file.change.decision",
      status: "success",
      actionId: "a1",
      context: {
        action: "deleted-prompt",
        changeType: "deleted",
        path: "/tmp/b.md",
        pathMatchesActive: true,
        ...base,
      },
    });
  });

  it("rename (renamed, same path) -> success, and carries no newPath key", () => {
    expect(build(RENAMED, doc)).toEqual({
      level: "info",
      event: "file.change.decision",
      status: "success",
      actionId: "a1",
      context: {
        action: "rename",
        changeType: "renamed",
        path: "/tmp/b.md",
        pathMatchesActive: true,
        ...base,
      },
    });
  });

  it("ignore (other path) -> cancel, and carries activePath", () => {
    expect(build(OTHER, doc)).toEqual({
      level: "info",
      event: "file.change.decision",
      status: "cancel",
      actionId: "a1",
      context: {
        action: "ignore",
        changeType: "modified",
        path: "/tmp/other.md",
        pathMatchesActive: false,
        activePath: "/tmp/b.md",
        ...base,
      },
    });
  });
});

describe("fl2: pathMatchesActive and activePath presence over a path-pair table", () => {
  const rows: Array<[string, string | null]> = [
    ["/tmp/x.md", "/tmp/x.md"],
    ["/private/tmp/x.md", "/tmp/x.md"],
    ["/tmp/x.md", "/private/tmp/x.md"],
    ["/tmp/x.md/", "/tmp/x.md"],
    ["/tmp/X.md", "/tmp/x.md"],
    ["/tmp/café.md", "/tmp/café.md"],
    ["/tmp/x.md", null],
  ];

  it.each(rows.map((row, i) => [i, ...row] as const))(
    "row %i: (%s, %s) — log agrees with the real decision, no normalisation",
    (i, eventPath, docPath) => {
      const event: FileChangeLogEvent = { path: eventPath, changeType: "modified", timestamp: TS };
      const doc = makeDoc({ path: docPath });
      const decision = decideFileChange(event, doc);
      const context = build(event, doc).context as Record<string, unknown>;

      expect(context.pathMatchesActive).toBe(i === 0);
      expect(context.pathMatchesActive).toBe(decision.action !== "ignore");
      expect("activePath" in context).toBe(!context.pathMatchesActive);
      if ("activePath" in context) expect(context.activePath).toBe(docPath);
      expect(context.path).toBe(eventPath);
    },
  );
});

describe("fl3: no-leak law over arms x doc content", () => {
  const events = [MODIFIED, DELETED, RENAMED, OTHER];
  const contents = ["D32-SECRET-BODY-4b7a", ""];

  for (const event of events) {
    for (const content of contents) {
      it(`${event.changeType} ${event.path} with content ${JSON.stringify(content)}`, () => {
        const doc = makeDoc({ content });
        const decision = decideFileChange(event, doc);
        const payload = build(event, doc);
        const text = JSON.stringify(payload);

        expect(payload.event).toBe("file.change.decision");
        if ("message" in decision) expect(text).not.toContain(decision.message);
        expect(text).not.toContain("D32-SECRET-BODY");
        const keys = allKeys(payload);
        expect(keys).not.toContain("message");
        expect(keys).not.toContain("content");
      });
    }
  }
});

describe("fl4: isModified and documentId passthrough", () => {
  it("clean doc d1 and dirty doc d9 both reload-prompt, with their own fields", () => {
    const a = build(MODIFIED, makeDoc({ id: "d1", isModified: false })).context;
    const b = build(MODIFIED, makeDoc({ id: "d9", isModified: true })).context;

    expect(a).toMatchObject({ action: "reload-prompt", isModified: false, documentId: "d1" });
    expect(b).toMatchObject({ action: "reload-prompt", isModified: true, documentId: "d9" });
  });
});
