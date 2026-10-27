import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rust = readFileSync(resolve("src-tauri/src/services/control_channel/page.rs"), "utf8");

function probe(args: object = {}) {
  const source = rust.match(/const PROBE: &str = r##"([\s\S]*?)"##;/)?.[1];
  if (!source) throw new Error("probe template missing");
  return (window.eval(`(${source})`) as (args: object) => Record<string, unknown>)(args);
}

describe("control probe v1", () => {
  it("uses selected text-node offsets across nodes and for a collapsed range", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false"><div class="cm-content"><div class="cm-line"><span>甲乙</span><span>丙丁</span></div></div></div>';
    const [first, second] = [...document.querySelectorAll(".cm-line span")].map((node) => node.firstChild!);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(first, 1);
    range.setEnd(second, 1);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(probe({ kind: "cm" }).selectedText).toBe("乙丙");
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(probe({ kind: "cm" }).selectedText).toBe("");
    selection.removeAllRanges();
  });

  it("reads a selected custom element without constructing a copy", () => {
    let constructions = 0;
    const name = "x-control-probe-readonly";
    if (!customElements.get(name)) {
      customElements.define(name, class extends HTMLElement {
        constructor() {
          super();
          constructions += 1;
        }
      });
    }
    document.body.innerHTML = '<div class="app-shell" aria-busy="false"><div class="cm-content"><div class="cm-line"></div></div></div>';
    const element = document.createElement(name);
    element.textContent = "文";
    document.querySelector(".cm-line")!.append(element);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNode(element);
    selection.removeAllRanges();
    selection.addRange(range);
    Object.defineProperty(selection, "toString", { configurable: true, value: () => { throw new Error("selection string conversion used"); } });
    expect(constructions).toBe(1);
    expect(probe({ kind: "cm" }).selectedText).toBe("文");
    expect(constructions).toBe(1);
    Reflect.deleteProperty(selection, "toString");
    selection.removeAllRanges();
  });

  it("reads selected DOM text through textContent in both editor kinds", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"><div class="cm-content"><div class="cm-line"><strong>文</strong></div></div><div id="milkdown-container"><div class="ProseMirror"><p><strong>文</strong></p></div></div></div>';
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".cm-line strong")!);
    selection!.removeAllRanges();
    selection!.addRange(range);
    for (const kind of ["cm", "pm"]) {
      const result = probe({ kind });
      expect(result.selectedText).toBe("文");
      expect((result.sources as Record<string, string>).selectedText).toContain("textContent");
    }
    selection!.removeAllRanges();
  });

  it("describes every returned v1 field across probe kinds", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"><div class="bottom-tab bottom-tab--active"><button role="tab" aria-selected="true"><span class="bottom-tab__name">文档.md</span></button></div><div class="cm-content"><div class="cm-line">line</div></div><div id="milkdown-container"><div class="ProseMirror"><p><strong>bold</strong></p></div></div><div class="dialog-card" role="dialog" aria-label="Prompt"></div><input id="md-auto-pair" type="checkbox"></div>';
    (window as Window & { __mdproConsole?: unknown }).__mdproConsole = { entries: [{ sequence: 1, source: "console.error", text: "boom" }], overflow: 0, capacity: 100 };
    for (const kind of [undefined, "cm", "pm", "dialog", "focus"]) {
      const result = probe(kind ? { kind } : {});
      const sources = result.sources as Record<string, string>;
      expect(result.prompts).toEqual([{ type: "confirm", name: "Prompt" }]);
      expect(sources["prompts.name"]).toContain("aria-label");
      expect((result.console as { entries: unknown[] }).entries).toEqual([{ sequence: 1, source: "console.error", text: "boom" }]);
      for (const key of Object.keys((result.console as { entries: object[] }).entries[0])) {
        expect(sources[`console.entries.${key}`], key).toMatch(/^(DOM|Rust|shadow store):?/);
      }
      for (const key of Object.keys(result).filter((key) => key !== "sources")) {
        expect(sources[key], `${kind ?? "base"}.${key}`).toMatch(/^(DOM|Rust|shadow store):?/);
      }
      for (const key of ["tabs.name", "tabs.active", "tabs.dirty", "prompts.type", "prompts.name", "console.entries.sequence", "console.entries.source", "console.entries.text", "console.overflow", "console.capacity"]) {
        expect(sources[key], key).toMatch(/^(DOM|Rust|shadow store):?/);
      }
      expect(sources["console.entries"]).toMatch(/^(DOM|Rust|shadow store):?/);
      for (const key of ["activeDocument", "tabs.name", "prompts.name", ...(kind === "cm" ? ["lastLine"] : []), ...(kind === "pm" ? ["lastBlock", "lastStrong"] : [])]) {
        expect(sources[key], key).toContain("textContent");
      }
      if (kind === "cm" || kind === "pm") expect(sources.selectedText).toContain("Selection.toString");
    }
    // @ts-expect-error The injected buffer is required by an ambient declaration, but test cleanup removes it.
    delete (window as Window & { __mdproConsole?: unknown }).__mdproConsole;
  });

  it("reports readiness and DOM fields with explicit sources and text method", () => {
    document.body.innerHTML = "";
    expect(probe().ready).toBe(false);
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"><div class="bottom-tab bottom-tab--active"><button class="bottom-tab__select" role="tab" aria-selected="true"><span class="bottom-tab__modified" aria-label="Unsaved changes"></span><span class="bottom-tab__name">文档.md</span></button></div></div>';
    const result = probe();
    expect(result).toMatchObject({ probeVersion: 1, ready: true, activeDocument: "文档.md", dirty: true, mode: "source", prompts: [] });
    expect(result.sources).toMatchObject({ windowLabels: "Rust", activeDocument: "DOM:textContent", dirty: "DOM", mode: "DOM" });
  });

  it("keeps hostile kind data inert", () => {
    (window as Window & { __probeAttack?: boolean }).__probeAttack = false;
    const result = probe({ kind: '"</script>` ${window.__probeAttack=true}' });
    expect(result.probeVersion).toBe(1);
    expect((window as Window & { __probeAttack?: boolean }).__probeAttack).toBe(false);
  });

  it("follows pre-mount, busy and ready states and prompt lifecycle", () => {
    document.body.innerHTML = "";
    expect(probe()).toMatchObject({ ready: false, activeDocument: null, dirty: null, mode: null, prompts: [] });
    document.body.innerHTML = '<div class="app-shell" aria-busy="true" data-view-mode="source"><div role="dialog" aria-label="Unsaved changes"></div></div>';
    expect(probe()).toMatchObject({ ready: false, mode: null, prompts: [{ type: "confirm", name: "Unsaved changes" }] });
    document.querySelector(".app-shell")!.setAttribute("aria-busy", "false");
    document.querySelector("[role=dialog]")!.remove();
    const mcp = document.createElement("div");
    mcp.className = "mcp-confirm-dialog";
    mcp.setAttribute("role", "dialog");
    mcp.setAttribute("aria-labelledby", "mcp-title");
    const title = document.createElement("h3");
    title.id = "mcp-title";
    title.textContent = "Approve write";
    mcp.append(title);
    document.body.append(mcp);
    expect(probe()).toMatchObject({ ready: true, mode: "source", prompts: [{ type: "mcp-confirm", name: "Approve write" }] });
    mcp.remove();
    expect(probe().prompts).toEqual([]);
  });
});
