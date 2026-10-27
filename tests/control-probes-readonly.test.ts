import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../src/stores/documentStore";
import { loggingService } from "../src/services/loggingService";

const rust = readFileSync(resolve("src-tauri/src/services/control_channel/page.rs"), "utf8");
function probe() {
  const source = rust.match(/const PROBE: &str = r##"([\s\S]*?)"##;/)?.[1];
  if (!source) throw new Error("probe template missing");
  return (window.eval(`(${source})`) as (args: object) => Record<string, unknown>)({});
}

describe("read-only control probe", () => {
  it("reads live dirty state without moving focus or writing to app boundaries", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"><button class="bottom-tab__select" role="tab" aria-selected="true"><span class="bottom-tab__name">a.md</span></button><input id="editor"></div>';
    const editor = document.querySelector<HTMLInputElement>("#editor")!;
    editor.focus();
    const before = probe();
    const dirty = document.createElement("span");
    dirty.className = "bottom-tab__modified";
    dirty.setAttribute("aria-label", "Unsaved changes");
    document.querySelector(".bottom-tab__select")!.append(dirty);
    const after = probe();
    expect([before.dirty, after.dirty, probe().dirty]).toEqual([false, true, true]);
    expect(document.activeElement).toBe(editor);
  });

  it("tracks Source, WYSIWYG, Source in that exact order", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"></div>';
    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    const modes = [probe().mode];
    shell.dataset.viewMode = "wysiwyg";
    modes.push(probe().mode);
    shell.dataset.viewMode = "source";
    modes.push(probe().mode);
    expect(modes).toEqual(["source", "wysiwyg", "source"]);
  });

  it("does not write stores, call IPC, or emit application logs", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"></div>';
    const setState = vi.spyOn(useDocumentStore, "setState");
    const log = vi.spyOn(loggingService, "logEventSync");
    const invoke = vi.fn();
    const previous = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
    const before = { writes: setState.mock.calls.length, logs: log.mock.calls.length, ipc: invoke.mock.calls.length };
    const values = [probe(), probe()];
    expect(values[0]).toEqual(values[1]);
    expect({ writes: setState.mock.calls.length, logs: log.mock.calls.length, ipc: invoke.mock.calls.length }).toEqual(before);
    setState.mockRestore(); log.mockRestore();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: previous });
  });
});
