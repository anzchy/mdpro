/**
 * WI-5 (plan-20260922-113723): the Source table context menu does nothing for a
 * document whose Source table verdict is "withheld" (ADR-0022) — no table menu,
 * no table parse, and no `preventDefault`, so the native menu still shows.
 *
 * Harness: a real `#source-container` holding a real `EditorView`, stored in
 * `useEditorStore`. `useDocumentStore.activeDocumentId = "doc-A"` and
 * `useEditorStore.activeDocumentId = "doc-Z"` deliberately differ, to kill a
 * read of the wrong id.
 *
 * Boundaries: `posAtCoords` is stubbed on the instance (jsdom has no layout);
 * `parseTableAtOffset` is a PASSTHROUGH spy (it counts, it replaces nothing);
 * `loggingService` crosses IPC and is mocked.
 *
 * K4 is the case that pins the event-time read: the verdict is recorded and
 * the active document switched AFTER mount, as App's effect does in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";

vi.mock("@tauri-apps/api/core", async () => ({ ...(await import("./support/tauriCoreMock")).createTauriCoreMock(), invoke: vi.fn() }));
vi.mock("../src/services/loggingService", () => ({
  loggingService: {
    logEventSync: vi.fn(),
    generateActionId: vi.fn(() => "test-id"),
  },
}));
vi.mock("../src/utils/tableParser/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/tableParser/parse")>();
  return { ...actual, parseTableAtOffset: vi.fn(actual.parseTableAtOffset) };
});

const { parseTableAtOffset } = await import("../src/utils/tableParser/parse");
const { tableDetectionExtension } = await import(
  "../src/plugins/codemirror/sourceTableDetection"
);
const { SourceTableContextMenu } = await import(
  "../src/components/Editor/SourceTableContextMenu"
);
const { useEditorStore, isSourceTablesWithheld } = await import("../src/stores/editorStore");
const { useDocumentStore } = await import("../src/stores/documentStore");

const parseSpy = vi.mocked(parseTableAtOffset);

const SIMPLE_MD = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n";

let container: HTMLDivElement;
let view: EditorView;

function rowLine(): HTMLElement {
  const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"));
  const line = lines.find((el) => el.textContent === "| 1 | 2 | 3 |");
  if (!line) throw new Error("row line not rendered");
  return line;
}

function mountHarness() {
  container = document.createElement("div");
  container.id = "source-container";
  document.body.appendChild(container);
  view = new EditorView({
    state: EditorState.create({
      doc: SIMPLE_MD,
      selection: EditorSelection.cursor(0),
      extensions: [markdown(), tableDetectionExtension()],
    }),
    parent: container,
  });
  view.posAtCoords = (() => SIMPLE_MD.indexOf("2")) as EditorView["posAtCoords"];
  useEditorStore.setState({ editorView: view });
  render(<SourceTableContextMenu />);
}

async function rightClick(): Promise<number> {
  const before = parseSpy.mock.calls.length;
  await userEvent.pointer({ keys: "[MouseRight]", target: rowLine() });
  return parseSpy.mock.calls.length - before;
}

const record = (id: string, verdict: "allowed" | "withheld") =>
  useEditorStore.getState().recordSourceTableVerdict(id, verdict);

beforeEach(() => {
  useEditorStore.setState({ sourceTableVerdicts: {}, activeDocumentId: "doc-Z" });
  useDocumentStore.setState({ documents: [], activeDocumentId: "doc-A" });
});

afterEach(() => {
  view?.destroy();
  container?.remove();
  useEditorStore.setState({ editorView: null });
});

describe("WI-5: SourceTableContextMenu bails on a withheld document", () => {
  it("K1 (i): a withheld active document gets no table menu and no parse", async () => {
    record("doc-A", "withheld");
    mountHarness();
    expect(await rightClick()).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("K1 (ii): with no verdict the menu opens after exactly one parse", async () => {
    mountHarness();
    expect(await rightClick()).toBe(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("K1 (iii): a verdict on editorStore's id does not gate the active document", async () => {
    record("doc-Z", "withheld");
    mountHarness();
    await rightClick();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("K2: withheld leaves the native menu alone; not withheld suppresses it", () => {
    record("doc-A", "withheld");
    mountHarness();
    // fireEvent returns false when the event was prevented; userEvent does not
    // expose that, which is why this case uses fireEvent.
    expect(fireEvent.contextMenu(rowLine())).toBe(true);

    act(() => {
      useEditorStore.setState({ sourceTableVerdicts: {} });
    });
    expect(fireEvent.contextMenu(rowLine())).toBe(false);
  });

  it("K3: the selector gives the exact truth for the arguments the shortcut passes", () => {
    const truth = () =>
      isSourceTablesWithheld(
        useEditorStore.getState(),
        useDocumentStore.getState().activeDocumentId,
      );
    const results: boolean[] = [];

    record("doc-A", "withheld");
    results.push(truth());
    useEditorStore.setState({ sourceTableVerdicts: {} });
    results.push(truth());
    record("doc-Z", "withheld");
    results.push(truth());

    expect(results).toEqual([true, false, false]);
  });

  it("K4: the gate reads the verdict and the active id at event time, not at mount", async () => {
    mountHarness();
    const deltas: number[] = [];

    // 1. the verdict lands after mount.
    act(() => {
      record("doc-A", "withheld");
    });
    deltas.push(await rightClick());
    expect(screen.queryByRole("menu")).toBeNull();

    // 2. switch to a document with no verdict.
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-B");
    });
    deltas.push(await rightClick());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    // 3. switch back to the withheld document.
    act(() => {
      useDocumentStore.getState().setActiveDocumentId("doc-A");
    });
    deltas.push(await rightClick());
    expect(screen.queryByRole("menu")).toBeNull();

    // 4. an "allowed" verdict must not gate.
    act(() => {
      record("doc-C", "allowed");
      useDocumentStore.getState().setActiveDocumentId("doc-C");
    });
    deltas.push(await rightClick());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    expect(deltas).toEqual([0, 1, 0, 1]);
  });
});
