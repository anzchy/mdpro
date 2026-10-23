import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { history, undoDepth, undo, redo, closeHistory } from "@milkdown/kit/prose/history";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", group: "block" }, text: { group: "inline" } },
});
schema.nodes.paragraph.spec.toDOM = () => ["p", 0];

describe("WYSIWYG find decorations", () => {
  const pluginPath = "../src/plugins/milkdown/find/findPlugin";
  it("marks every match, wraps navigation, and leaves document content untouched", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat cat"))),
      plugins: [find.createFindPlugin()],
    }) });
    const original = view.state.doc.toJSON();
    find.setFindQuery(view, "cat");
    expect([...view.dom.querySelectorAll(".mdpro-find-match")]).toHaveLength(3);
    expect(view.dom.querySelector(".mdpro-find-match.is-current")?.textContent).toBe("cat");
    expect(find.getFindState(view.state).current).toBe(0);
    for (let index = 0; index < 3; index += 1) find.moveFind(view, 1);
    expect(find.getFindState(view.state).current).toBe(0);
    find.moveFind(view, -1);
    expect(find.getFindState(view.state).current).toBe(2);
    expect(view.state.doc.toJSON()).toEqual(original);
    find.closeFind(view);
    expect(view.dom.querySelectorAll(".mdpro-find-match")).toHaveLength(0);
    view.destroy(); host.remove();
  });

  it("updates ranges after ordinary edits while search is open", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat"))),
      plugins: [find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "cat");
    view.dispatch(view.state.tr.insertText("cat ", 1));
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }]);
    view.dispatch(view.state.tr.delete(1, 5));
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }]);
    view.destroy(); host.remove();
  });

  it("keeps the current occurrence when an edit creates an earlier match", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat"))),
      plugins: [find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "cat"); find.moveFind(view, 1);
    view.dispatch(view.state.tr.insertText("cat ", 1));
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 9, to: 12 }]);
    expect(find.getFindState(view.state).current).toBe(2);
    view.destroy(); host.remove();
  });

  it("keeps no-match navigation and search options out of document history", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("Cat cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    const original = view.state.doc.toJSON();
    find.setFindQuery(view, "missing");
    const selection = view.state.selection.toJSON();
    expect(find.moveFind(view, 1)).toBe(false);
    expect(view.state.selection.toJSON()).toEqual(selection);
    find.setFindQuery(view, "cat");
    find.setFindOptions(view, { caseSensitive: true, wholeWord: true });
    expect(find.getFindState(view.state).matches).toEqual([{ from: 5, to: 8 }]);
    expect(view.state.doc.toJSON()).toEqual(original);
    expect(undoDepth(view.state)).toBe(0);
    view.destroy(); host.remove();
  });

  it("scrolls the newly current decoration into view", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const previous = HTMLElement.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
    try {
      const host = document.createElement("div"); document.body.append(host);
      const view = new EditorView(host, { state: EditorState.create({
        schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat"))),
        plugins: [find.createFindPlugin()],
      }) });
      find.setFindQuery(view, "cat"); find.moveFind(view, 1);
      expect(scrolled[scrolled.length - 1]).toBe(view.dom.querySelectorAll(".mdpro-find-match")[1]);
      view.destroy(); host.remove();
    } finally { HTMLElement.prototype.scrollIntoView = previous; }
  });

  it("tracks code-mark changes, undo and redo before replacing a live match", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const rich = new Schema({
      nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] }, text: { group: "inline" } },
      marks: { code: { code: true, toDOM: () => ["code", 0] } },
    });
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema: rich, doc: rich.node("doc", null, rich.node("paragraph", null, rich.text("cat cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "cat");
    view.dispatch(view.state.tr.insertText("cat ", 1));
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }, { from: 9, to: 12 }]);
    view.dispatch(closeHistory(view.state.tr).addMark(5, 8, rich.mark("code")));
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 9, to: 12 }]);
    expect(undo(view.state, view.dispatch, view)).toBe(true);
    expect(find.getFindState(view.state).matches).toHaveLength(3);
    expect(redo(view.state, view.dispatch, view)).toBe(true);
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 9, to: 12 }]);
    expect(find.replaceFind(view, "dog", false)).toBe(true);
    expect(view.state.doc.textContent).toBe("cat cat dog");
    view.destroy(); host.remove();
  });
});
