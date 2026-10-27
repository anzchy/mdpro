import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async () =>
  (await import("./support/tauriCoreMock")).createTauriCoreMock({ invoke: async () => null }),
);

import { ConfirmDialog } from "../src/components/common/ConfirmDialog";
import { McpWriteConfirmDialog } from "../src/components/common/McpWriteConfirmDialog";
import type { ConfirmRequest } from "../src/utils/mcpConfirmModel";

const rust = readFileSync(resolve("src-tauri/src/services/control_channel/page.rs"), "utf8");
const source = rust.match(/const PROBE: &str = r##"([\s\S]*?)"##;/)?.[1];
function prompts() {
  if (!source) throw new Error("probe script missing");
  const probe = window.eval(`(${source})`) as (args: object) => { prompts: Array<{ type: string; name: string }> };
  return probe({}).prompts;
}

const request: ConfirmRequest = {
  requestId: "r1",
  documentId: "d1",
  documentTitle: "draft.md",
  operation: "replace",
  expiresInMs: 60000,
};

describe("control probe prompt lifecycle", () => {
  it("reads real ConfirmDialog and MCP confirmation names through open and close", () => {
    document.body.innerHTML = '<div class="app-shell" aria-busy="false" data-view-mode="source"></div>';
    expect(prompts()).toEqual([]);

    const confirm = render(<ConfirmDialog open={false} title="Unsaved changes" message="Save?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(prompts()).toEqual([]);
    confirm.rerender(<ConfirmDialog open title="Unsaved changes" message="Save?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(prompts()).toEqual([{ type: "confirm", name: "Unsaved changes" }]);
    confirm.rerender(<ConfirmDialog open={false} title="Unsaved changes" message="Save?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(prompts()).toEqual([]);
    confirm.unmount();

    const mcp = render(<McpWriteConfirmDialog request={request} onApprove={() => {}} onReject={() => {}} />);
    expect(prompts()).toEqual([{ type: "mcp-confirm", name: "MCP write confirmation" }]);
    mcp.unmount();
    expect(prompts()).toEqual([]);
  });
});
