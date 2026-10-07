// @vitest-environment node
/**
 * WI-5 (D16) — the ONE shared per-window unsaved assessment.
 *
 * `assessWindowUnsaved(reason)` flushes pending WYSIWYG edits first, then reads
 * `useDocumentStore.getState()`. `decideWindowExit` turns that assessment into
 * `proceed` | `prompt`. Three exit paths (window close, app quit, relaunch) must
 * make the SAME call on the same pre-state — the defect this pins is a quit path
 * that reads `isModified` without flushing, or one that looks only at the active
 * document and discards two other dirty tabs.
 *
 * Law:
 *  (1) Monotonic flush — the post-flush decision is never less cautious than the
 *      decision computed from the store alone.
 *  (2) Oracle — with `allowLatched=false`, the result is `prompt` iff the flush
 *      failed or the post-flush store has >= 1 modified document.
 *  (3) Metamorphic — close, quit and relaunch agree on "must the user be asked".
 *  (4) Completeness — `dirtyDocuments` is every modified document, not the active one.
 *
 * Real: documentStore, milkdownEditorStore (flushers registered through the real
 * `registerFlusher` API). Mocked only at boundaries: the Tauri core `invoke` and
 * loggingService, as in `d15-close-guards.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn(async () => null) }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    logEvent: vi.fn(async () => {}),
    generateActionId: vi.fn(() => "test-id"),
  },
}));

import { useDocumentStore } from "../src/stores/documentStore";
import { useMilkdownEditorStore } from "../src/stores/milkdownEditorStore";
import type { Document } from "../src/types/document";
import {
  assessWindowUnsaved,
  decideWindowClose,
  decideWindowExit,
  quitAnswerFor,
  windowCloseDecisionAfterFlush,
} from "../src/utils/dataLossGuards";

type FlusherKind = "none" | "clean" | "written-and-dirties-a" | "failed" | "throws";
const FLUSH_KINDS: FlusherKind[] = [
  "none",
  "clean",
  "written-and-dirties-a",
  "failed",
  "throws",
];

/** "prompt" is the cautious end of every vocabulary; a flush may only move toward it. */
const RANK = {
  proceed: 0,
  clean: 0,
  allow: 0,
  "save-and-close": 0,
  prompt: 1,
  dirty: 1,
} as const;

function doc(id: string, path: string | null, isModified: boolean): Document {
  return {
    id,
    path,
    content: `content-${id}`,
    encoding: "UTF-8",
    lineEnding: "lf",
    isModified,
    lastSaved: null,
    fileSize: null,
  };
}

/**
 * Seed the store with a/b/c (a active) where `modifiedIds` are dirty, and register
 * `kind` as the single flusher on "a" through the real milkdownEditorStore API.
 * Returns the list the flusher records its reasons into.
 */
function seed(modifiedIds: string[], kind: FlusherKind): string[] {
  useDocumentStore.setState({
    documents: [
      doc("a", "/tmp/a.md", modifiedIds.includes("a")),
      doc("b", "/tmp/b.md", modifiedIds.includes("b")),
      doc("c", "/tmp/c.md", modifiedIds.includes("c")),
    ],
    activeDocumentId: "a",
  });
  useMilkdownEditorStore.setState({ flushers: {} });
  const reasons: string[] = [];
  if (kind === "none") return reasons;
  useMilkdownEditorStore.getState().registerFlusher("a", (reason) => {
    reasons.push(reason);
    if (kind === "throws") throw new Error("serializer exploded");
    if (kind === "written-and-dirties-a") {
      useDocumentStore.getState().markDocumentModified("a", true);
      return { status: "written" };
    }
    return { status: kind === "failed" ? "failed" : "clean" };
  });
  return reasons;
}

beforeEach(() => {
  seed([], "none");
});

describe("WI5-A assessWindowUnsaved / decideWindowExit", () => {
  it("A1 a clean store with no flusher gives proceed and an empty list", () => {
    useDocumentStore.setState({
      documents: [doc("a", "/tmp/a.md", false), doc("b", "/tmp/b.md", false)],
      activeDocumentId: "a",
    });
    useMilkdownEditorStore.setState({ flushers: {} });

    const assessment = assessWindowUnsaved("app-quit");

    expect(assessment).toEqual({ flushFailed: false, dirtyDocuments: [] });
    expect(decideWindowExit(assessment, { allowLatched: false })).toBe("proceed");
    expect(quitAnswerFor("proceed")).toBe("clean");
  });

  it("A2 two dirty inactive tabs are both reported, in store order, as {id,path} only", () => {
    useDocumentStore.setState({
      documents: [
        doc("a", "/tmp/a.md", false),
        doc("b", "/tmp/b.md", true),
        doc("c", null, true),
      ],
      activeDocumentId: "a",
    });
    useMilkdownEditorStore.setState({ flushers: {} });

    const assessment = assessWindowUnsaved("app-quit");

    expect(assessment.dirtyDocuments).toEqual([
      { id: "b", path: "/tmp/b.md" },
      { id: "c", path: null },
    ]);
    for (const entry of assessment.dirtyDocuments) {
      expect(Object.keys(entry)).toEqual(["id", "path"]);
    }
    expect(decideWindowExit(assessment, { allowLatched: false })).toBe("prompt");
    expect(quitAnswerFor("prompt")).toBe("dirty");
  });

  it("A3 a failed flush on a clean store gives prompt, and the store is not mutated", () => {
    seed([], "failed");

    const assessment = assessWindowUnsaved("app-quit");

    expect(assessment.flushFailed).toBe(true);
    expect(assessment.dirtyDocuments).toEqual([]);
    expect(decideWindowExit(assessment, { allowLatched: false })).toBe("prompt");
    expect(useDocumentStore.getState().documents.map((d) => d.isModified)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("A4 the flush runs BEFORE the read, and carries the caller's reason", () => {
    const reasons = seed([], "written-and-dirties-a");

    const quitAssessment = assessWindowUnsaved("app-quit");

    expect(quitAssessment.flushFailed).toBe(false);
    expect(quitAssessment.dirtyDocuments).toEqual([{ id: "a", path: "/tmp/a.md" }]);
    expect(decideWindowExit(quitAssessment, { allowLatched: false })).toBe("prompt");
    expect(reasons).toEqual(["app-quit"]);

    assessWindowUnsaved("relaunch");
    expect(reasons).toEqual(["app-quit", "relaunch"]);
  });

  it("A5 allowLatched wins over dirty documents and over a failed flush", () => {
    const assessment = {
      flushFailed: true,
      dirtyDocuments: [{ id: "a", path: null }],
    };

    expect(decideWindowExit(assessment, { allowLatched: true })).toBe("proceed");
    expect(decideWindowExit(assessment, { allowLatched: false })).toBe("prompt");
  });

  it("A6 decideWindowClose keeps its 3-row contract unchanged", () => {
    expect(decideWindowClose({ allowWindowClose: true, hasUnsavedChanges: true })).toBe("allow");
    expect(decideWindowClose({ allowWindowClose: true, hasUnsavedChanges: false })).toBe("allow");
    expect(decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: true })).toBe("prompt");
    expect(decideWindowClose({ allowWindowClose: false, hasUnsavedChanges: false })).toBe(
      "save-and-close",
    );
  });

  it("A7 windowCloseDecisionAfterFlush maps the shared rule onto the close vocabulary", () => {
    seed([], "none");
    expect(windowCloseDecisionAfterFlush({ allowWindowClose: false })).toBe("save-and-close");

    seed(["b"], "none");
    expect(windowCloseDecisionAfterFlush({ allowWindowClose: false })).toBe("prompt");

    seed(["b"], "none");
    expect(windowCloseDecisionAfterFlush({ allowWindowClose: true })).toBe("allow");
  });
});

describe("WI5-P1 the three exit paths agree over the whole pre-state domain", () => {
  it("each path matches the oracle, the paths agree, and a flush never un-prompts", () => {
    let unsavedRows = 0;
    let cleanRows = 0;
    let flushFlippedRows = 0;

    for (const kind of FLUSH_KINDS) {
      for (const modifiedCount of [0, 1, 2]) {
        for (const activeDirty of [true, false]) {
          if (modifiedCount === 0 && activeDirty) continue; // not realisable
          const modifiedIds =
            modifiedCount === 0
              ? []
              : modifiedCount === 1
                ? activeDirty
                  ? ["a"]
                  : ["b"]
                : activeDirty
                  ? ["a", "b"]
                  : ["b", "c"];

          for (const allowLatched of [true, false]) {
            const row = `flush=${kind} modified=[${modifiedIds}] allowLatched=${allowLatched}`;

            // (a) the oracle, computed independently of the code under test
            const flushDirties =
              kind === "written-and-dirties-a" || kind === "failed" || kind === "throws";
            const unsaved = flushDirties || modifiedCount > 0;

            // The pre-flush decision, from the store alone — the monotonicity baseline.
            const preFlushClose = decideWindowClose({
              allowWindowClose: allowLatched,
              hasUnsavedChanges: modifiedCount > 0,
            });
            const preFlushQuit = quitAnswerFor(
              decideWindowExit(
                {
                  flushFailed: false,
                  dirtyDocuments: modifiedIds.map((id) => ({ id, path: `/tmp/${id}.md` })),
                },
                { allowLatched: false },
              ),
            );

            // Each path re-seeds: the flusher mutates the store, so the paths must
            // each observe the same PRE-state rather than each other's leftovers.
            seed(modifiedIds, kind);
            const close = windowCloseDecisionAfterFlush({ allowWindowClose: allowLatched });

            seed(modifiedIds, kind);
            const quit = quitAnswerFor(
              decideWindowExit(assessWindowUnsaved("app-quit"), { allowLatched: false }),
            );

            // The relaunch path as WI-8 will consume it: it reads `flushFailed` and
            // `dirtyDocuments` off the same assessment and blocks or saves.
            // (WI-8 rewires the real `prepareForRelaunch` onto this; until then the
            // real hook does not flush, so it is not called here.)
            seed(modifiedIds, kind);
            const relaunchAssessment = assessWindowUnsaved("relaunch");
            const relaunchActed =
              relaunchAssessment.flushFailed || relaunchAssessment.dirtyDocuments.length > 0;

            // (a) oracle
            expect(quit, row).toBe(unsaved ? "dirty" : "clean");
            expect(close, row).toBe(
              allowLatched ? "allow" : unsaved ? "prompt" : "save-and-close",
            );
            expect(relaunchActed, row).toBe(unsaved);

            // (b) the three paths agree when nothing is latched
            if (!allowLatched) {
              expect(close === "prompt", `${row}: close vs quit`).toBe(quit === "dirty");
              expect(close === "prompt", `${row}: close vs relaunch`).toBe(relaunchActed);
            }

            // (c) monotonic: the flush never moved a decision away from prompt
            expect(RANK[close], `${row}: close moved away from prompt`).toBeGreaterThanOrEqual(
              RANK[preFlushClose],
            );
            expect(RANK[quit], `${row}: quit moved away from prompt`).toBeGreaterThanOrEqual(
              RANK[preFlushQuit],
            );

            // (d) non-vacuity bookkeeping
            if (unsaved) unsavedRows += 1;
            else cleanRows += 1;
            if (modifiedCount === 0 && flushDirties) flushFlippedRows += 1;
          }
        }
      }
    }

    expect(unsavedRows, "non-vacuity: some rows are unsaved").toBeGreaterThan(0);
    expect(cleanRows, "non-vacuity: some rows are clean").toBeGreaterThan(0);
    expect(
      flushFlippedRows,
      "non-vacuity: the flush alone flipped some rows",
    ).toBeGreaterThan(0);
  });
});
