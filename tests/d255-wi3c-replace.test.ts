import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { history, undo, redo } from "@milkdown/kit/prose/history";

const schema = new Schema({ nodes: {
  doc: { content: "paragraph+" },
  paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
  text: { group: "inline" },
} });
const pluginPath = "../src/plugins/milkdown/find/findPlugin";

describe("WYSIWYG replacement", () => {
  it("replaces only the current eligible match and advances", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "cat"); find.moveFind(view, 1);
    expect(find.replaceFind(view, "dog", false)).toBe(true);
    expect(view.state.doc.textContent).toBe("cat dog cat");
    expect(find.getFindState(view.state).matches).toEqual([{ from: 1, to: 4 }, { from: 9, to: 12 }]);
    expect(find.getFindState(view.state).current).toBe(1);
    view.destroy(); host.remove();
  });

  it("replaces punctuation literally and undoes all matches in one step", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("a.b.c"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    find.setFindQuery(view, ".");
    expect(find.replaceFind(view, "!", true)).toBe(true);
    expect(view.state.doc.textContent).toBe("a!b!c");
    expect(undo(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.textContent).toBe("a.b.c");
    view.destroy(); host.remove();
  });

  it("keeps replacement separate from typing on both sides of history", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    view.dispatch(view.state.tr.insertText("X", 1));
    find.setFindQuery(view, "cat");
    expect(find.replaceFind(view, "dog", true)).toBe(true);
    view.dispatch(view.state.tr.insertText("Y", 5));
    expect(view.state.doc.textContent).toBe("XdogY");
    for (const expected of ["Xdog", "Xcat", "cat"]) {
      expect(undo(view.state, view.dispatch, view)).toBe(true);
      expect(view.state.doc.textContent).toBe(expected);
    }
    for (const expected of ["Xcat", "Xdog", "XdogY"]) {
      expect(redo(view.state, view.dispatch, view)).toBe(true);
      expect(view.state.doc.textContent).toBe(expected);
    }
    view.destroy(); host.remove();
  });

  it("does not corrupt text following a Unicode case-fold expansion", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("İcatZ"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "cat");
    expect(find.replaceFind(view, "dog", false)).toBe(true);
    expect(view.state.doc.textContent).toBe("İdogZ");
    view.destroy(); host.remove();
  });

  it("replaces visible labels while preserving code and link targets", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const rich = new Schema({ nodes: {
      doc: { content: "block+" }, paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
      code_block: { content: "text*", group: "block", code: true, toDOM: () => ["pre", 0] }, text: { group: "inline" },
    }, marks: {
      inlineCode: { code: true, toDOM: () => ["code", 0] },
      link: { attrs: { href: {} }, toDOM: (mark) => ["a", { href: mark.attrs.href }, 0] },
    } });
    const original = rich.node("doc", null, [
      rich.node("paragraph", null, [rich.text("cat "), rich.text("cat", [rich.mark("inlineCode")]), rich.text(" cat", [rich.mark("link", { href: "https://cat.example" })])]),
      rich.node("code_block", null, rich.text("cat")),
    ]);
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({ schema: rich, doc: original, plugins: [history(), find.createFindPlugin()] }) });
    find.setFindQuery(view, "cat");
    expect(find.replaceFind(view, "狗", true)).toBe(true);
    expect(view.state.doc.textContent).toBe("狗 cat 狗cat");
    expect(JSON.stringify(view.state.doc.toJSON())).toContain("https://cat.example");
    expect(undo(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.toJSON()).toEqual(original.toJSON());
    view.destroy(); host.remove();
  });

  it("refuses replacement in a read-only or destroyed view", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat"))),
      plugins: [find.createFindPlugin()],
    }), editable: () => false });
    find.setFindQuery(view, "cat");
    expect(find.replaceFind(view, "dog", false)).toBe(false);
    expect(view.state.doc.textContent).toBe("cat");
    view.destroy();
    expect(find.replaceFind(view, "dog", true)).toBe(false);
    host.remove();
  });

  it("isolates one Replace from adjacent typing in undo and redo", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    view.dispatch(view.state.tr.insertText("X", 1));
    find.setFindQuery(view, "cat");
    expect(find.replaceFind(view, "dog", false)).toBe(true);
    view.dispatch(view.state.tr.insertText("Y", 5));
    for (const expected of ["Xdog", "Xcat", "cat"]) {
      expect(undo(view.state, view.dispatch, view)).toBe(true);
      expect(view.state.doc.textContent).toBe(expected);
    }
    for (const expected of ["Xcat", "Xdog", "XdogY"]) {
      expect(redo(view.state, view.dispatch, view)).toBe(true);
      expect(view.state.doc.textContent).toBe(expected);
    }
    view.destroy(); host.remove();
  });

  it("accepts an empty replacement and refuses an empty query or active composition", async () => {
    const find = await import(/* @vite-ignore */ pluginPath).catch(() => null);
    expect(find).not.toBeNull();
    if (!find) return;
    const host = document.createElement("div"); document.body.append(host);
    const view = new EditorView(host, { state: EditorState.create({
      schema, doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("cat cat"))),
      plugins: [history(), find.createFindPlugin()],
    }) });
    find.setFindQuery(view, "");
    expect(find.replaceFind(view, "dog", true)).toBe(false);
    find.setFindQuery(view, "cat");
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.composing).toBe(true);
    expect(find.replaceFind(view, "dog", true)).toBe(false);
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(find.replaceFind(view, "", false)).toBe(true);
    expect(view.state.doc.textContent).toBe(" cat");
    view.destroy(); host.remove();
  });
});
