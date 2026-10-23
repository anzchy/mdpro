import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { FindReplaceBar } from "../src/components/Editor/FindReplaceBar";
import { createFindPlugin, getFindState, setFindQuery, type FindState } from "../src/plugins/milkdown/find/findPlugin";
import { defaultAppliedShortcuts } from "../src/commands/appliedKeymap";

const openState: FindState = {
  open: true, replacing: true, query: "cat", caseSensitive: false,
  wholeWord: false, matches: [{ from: 1, to: 4 }], current: 0, focusEpoch: 1,
};

it("keeps Replace above Find and focuses the one active field", () => {
  const mounted = render(<FindReplaceBar state={openState} getView={() => null} appliedShortcuts={null} />);
  const rows = document.querySelectorAll(".mdpro-find-bar__row");
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector("input")).toBe(screen.getByRole("textbox", { name: "Replace" }));
  expect(rows[1].querySelector("input")).toBe(screen.getByRole("textbox", { name: "Find" }));
  expect(screen.getByRole("textbox", { name: "Replace" })).toHaveFocus();
  expect(screen.getByText("1 of 1").getAttribute("aria-live")).toBe("polite");
  mounted.rerender(<FindReplaceBar state={{ ...openState, replacing: false, focusEpoch: 2 }} getView={() => null} appliedShortcuts={null} />);
  expect(screen.getByRole("textbox", { name: "Find" })).toHaveFocus();
  mounted.unmount();
});

it("docks without an overlay and uses tokens, focus pattern 1, and a narrow wrap", () => {
  const css = readFileSync("src/components/Editor/FindReplaceBar.css", "utf8");
  expect(css).toContain("border-top: 1px solid var(--color-border-subtle)");
  expect(css).toContain("box-shadow: 0 0 0 2px var(--color-accent-soft)");
  expect(css).toContain("@media (max-width: 719px)");
  expect(css).toContain("flex-wrap: wrap");
  expect(css).not.toMatch(/position:\s*(fixed|absolute)/);
});

it("handles the off-Mac applied Ctrl+G while the input owns focus", () => {
  const oldPlatform = navigator.platform;
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
  try {
    const schema = new Schema({ nodes: {
      doc: { content: "paragraph+" }, paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] }, text: { group: "inline" },
    } });
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat"))), plugins: [createFindPlugin()],
    }) });
    setFindQuery(view, "cat");
    const mounted = render(<FindReplaceBar state={getFindState(view.state)} getView={() => view} appliedShortcuts={defaultAppliedShortcuts("linux")} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "g", ctrlKey: true });
    expect(getFindState(view.state).current).toBe(1);
    mounted.unmount(); view.destroy(); host.remove();
  } finally { Object.defineProperty(navigator, "platform", { configurable: true, value: oldPlatform }); }
});
