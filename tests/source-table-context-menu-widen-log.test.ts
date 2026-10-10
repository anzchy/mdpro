/**
 * D49 WI-1.3 LG-INT: the `editor.table.edit-widened` entry reaches the real
 * Tauri `log_event` boundary when the source-mode context menu reformats an
 * overflow table on a real CodeMirror `EditorView` (jsdom).
 *
 * Matrix: `.claude/tdd-guardian/tests-20261009-111653.md` "# WI-1.3" LG-INT,
 * the paired integration case for the `logEventSync` spy in
 * `tests/table-edits-overflow-log.test.ts`. Kept in its own file rather than
 * `source-table-context-menu-overflow.test.ts` so WI-1.2's recorded test file
 * is not edited. Only `@tauri-apps/api/core` `invoke` is mocked;
 * `loggingService`, `shouldLog` and `safeInvoke` are real.
 */

import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

import { tableDetectionExtension } from "../src/plugins/codemirror/sourceTableDetection";
import { dispatchSourceTableAction } from "../src/plugins/codemirror/sourceTableContextMenu";
import { useLoggingStore } from "../src/stores/loggingStore";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke }),
);

const T2 = "| a | b |\n|---|---|\n| 1 | 2 | Z |\n| 3 | 4 |\n";
const WIDE = ["| a   | b   |     |", "| --- | --- | --- |", "| 1   | 2   | Z   |", "| 3   | 4   |     |"];
const DOC = "Intro\n\n" + T2 + "\nOutro\n";
const POS = DOC.indexOf("2 | Z");

type LogCall = [string, { payload: { event: string; context?: unknown } }];

describe("LG-INT: reformat on an overflow document logs edit-widened at the Tauri boundary", () => {
  it("rewrites the table and sends one log_event with the widening counts", () => {
    useLoggingStore.setState({ enabled: true, level: "info" });
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        selection: EditorSelection.cursor(0),
        extensions: [markdown(), tableDetectionExtension()],
      }),
    });
    expect(dispatchSourceTableAction(view, "reformat_table", POS)).toBe(true);
    expect(view.state.doc.toString()).toBe("Intro\n\n" + WIDE.join("\n") + "\n\nOutro\n");
    const calls = (invoke.mock.calls as unknown as LogCall[]).filter(
      ([cmd, a]) => cmd === "log_event" && a.payload.event === "editor.table.edit-widened",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][1].payload.context).toEqual({ action: "reformat_table", fromColCount: 2, toColCount: 3 });
    view.destroy();
  });
});
