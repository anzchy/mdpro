/**
 * D32 WI-4 — `buildFileChangeReceivedLog` (fl5, fl6) and `decisionLogKey` (fl7, fl8).
 */
import { describe, expect, it } from "vitest";
import type { FileChangeAction } from "../src/utils/dataLossGuards";
import {
  buildFileChangeReceivedLog,
  decisionLogKey,
  type FileChangeLogEvent,
  type FileChangeReceivedOutcome,
} from "../src/utils/fileChangeLog";

const TS = 1700000000777;
const OUTCOMES: FileChangeReceivedOutcome[] = [
  "other-path",
  "save-suppressed",
  "scheduled",
  "delivered",
];
const ACTIONS: Array<FileChangeAction["action"]> = [
  "ignore",
  "rename",
  "reload-prompt",
  "deleted-prompt",
];

describe("fl5: the four received outcomes, exact payloads", () => {
  const event: FileChangeLogEvent = {
    path: "/private/tmp/b.md",
    changeType: "modified",
    timestamp: TS,
  };
  const expectedStatus = {
    "other-path": "cancel",
    "save-suppressed": "cancel",
    scheduled: "start",
    delivered: "success",
  } as const;

  it.each(OUTCOMES)("%s", (outcome) => {
    const payload = buildFileChangeReceivedLog({
      event,
      activePath: "/tmp/b.md",
      outcome,
      windowLabel: "w2",
      actionId: "a1",
    });
    expect(payload).toEqual({
      level: "info",
      event: "file.change.received",
      status: expectedStatus[outcome],
      actionId: "a1",
      context: {
        outcome,
        path: "/private/tmp/b.md",
        changeType: "modified",
        eventTimestamp: TS,
        windowLabel: "w2",
        ...(outcome === "other-path" ? { activePath: "/tmp/b.md" } : {}),
      },
    });
  });
});

describe("fl6: activePath presence law, and no newPath", () => {
  const events: FileChangeLogEvent[] = [
    { path: "/private/tmp/b.md", changeType: "modified", timestamp: TS },
    { path: "/private/tmp/b.md", changeType: "deleted", timestamp: TS },
    { path: "/private/tmp/b.md", changeType: "renamed", newPath: "/tmp/c.md", timestamp: TS },
  ];
  const baseKeys = ["changeType", "eventTimestamp", "outcome", "path", "windowLabel"];

  for (const outcome of OUTCOMES) {
    for (const event of events) {
      it(`${outcome} x ${event.changeType}`, () => {
        const payload = buildFileChangeReceivedLog({
          event,
          activePath: "/tmp/b.md",
          outcome,
          windowLabel: "w2",
          actionId: "a1",
        });
        const expected =
          outcome === "other-path" ? [...baseKeys, "activePath"].sort() : [...baseKeys].sort();
        expect(Object.keys(payload.context ?? {}).sort()).toEqual(expected);
        expect(payload.context).not.toHaveProperty("newPath");
        expect(JSON.stringify(payload)).not.toContain("/tmp/c.md");
      });
    }
  }
});

describe("fl7: decisionLogKey determinism and content independence", () => {
  const events: FileChangeLogEvent[] = [
    { path: "/tmp/b.md", changeType: "modified", timestamp: TS },
    { path: "/tmp/b.md", changeType: "deleted", timestamp: TS },
    { path: "/tmp/b.md", changeType: "renamed", newPath: "/tmp/c.md", timestamp: TS },
  ];

  for (const event of events) {
    for (const docId of ["d1", "d2"]) {
      for (const action of ACTIONS) {
        it(`${event.changeType} / ${docId} / ${action}`, () => {
          const first = decisionLogKey(event, docId, action);
          const again = decisionLogKey(structuredClone(event), docId, action);
          expect(typeof first).toBe("string");
          expect(first.length).toBeGreaterThan(0);
          expect(again).toBe(first);
        });
      }
    }
  }
});

describe("fl8: decisionLogKey injectivity over a tuple grid, incl. separator collisions", () => {
  it("32 grid tuples + 6 adversarial tuples give 38 distinct keys", () => {
    type Tuple = [number, string, string, string, FileChangeAction["action"]];
    const tuples: Tuple[] = [];
    for (const ts of [1, 2])
      for (const path of ["/a", "/b"])
        for (const changeType of ["modified", "deleted"])
          for (const docId of ["d1", "d2"])
            for (const action of ["ignore", "reload-prompt"] as const)
              tuples.push([ts, path, changeType, docId, action]);
    for (const sep of ["|", ":", "\u0000"]) {
      tuples.push([1, `/a${sep}d1`, "modified", "x", "ignore"]);
      tuples.push([1, "/a", "modified", `d1${sep}x`, "ignore"]);
    }
    const distinct = new Set(tuples.map((t) => JSON.stringify(t)));
    expect(distinct.size).toBe(38);

    const keys = new Set(
      tuples.map(([timestamp, path, changeType, docId, action]) =>
        decisionLogKey({ path, changeType, timestamp }, docId, action),
      ),
    );
    expect(keys.size).toBe(distinct.size);
  });
});

describe("fl9: decisionLogKey separates adjacent fields a naive join would merge", () => {
  const key = (changeType: string, docId: string, action: FileChangeAction["action"]) =>
    decisionLogKey({ path: "/a", changeType, timestamp: 1 }, docId, action);

  it.each(["|", ":", "\u0000"])("changeType/docId boundary with separator %j", (sep) => {
    expect(key(`modified${sep}d1`, "x", "ignore")).not.toBe(
      key("modified", `d1${sep}x`, "ignore"),
    );
  });

  it.each(["|", ":", "\u0000"])("docId/action boundary with separator %j", (sep) => {
    // `action` is a closed union at compile time, but the key is built from
    // whatever string arrives; the cast lets the separator sit in `action`.
    const shifted = `ignore${sep}reload-prompt` as FileChangeAction["action"];
    expect(key("modified", `d1${sep}ignore`, "reload-prompt")).not.toBe(
      key("modified", "d1", shifted),
    );
  });

  it("docId/action boundary using only real actions", () => {
    expect(key("modified", "d1|reload-prompt", "ignore")).not.toBe(
      key("modified|d1", "reload-prompt", "ignore"),
    );
  });
});
