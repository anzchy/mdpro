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
