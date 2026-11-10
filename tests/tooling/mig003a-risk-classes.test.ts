// @vitest-environment node
/** MIG003a: the advisory classes describe changed paths without changing the code gate. */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { classifyPaths, classifyRiskClasses } from "../../scripts/ci/change-scope.mjs";
import { job, jobIds, entry, scalar } from "../support/workflowBlocks";

// This suite exercises pure classifiers. A child-process call would make a table case fail.
vi.mock("node:child_process", () => ({ spawnSync: vi.fn(() => { throw Error("risk classification must not spawn"); }) }));

const only = (...names: Array<"deps" | "editor" | "pipeline" | "ci" | "ipc" | "platform">) =>
  Object.fromEntries(["deps", "editor", "pipeline", "ci", "ipc", "platform"].map((name) => [name, names.includes(name as typeof names[number])])) as ReturnType<typeof classifyRiskClasses>;

describe("MIG003a risk classes", () => {
  it.each([
    ["package.json", only("deps")], ["pnpm-lock.yaml", only("deps")],
    ["patches/a.patch", only("deps")], ["patches/nested/a.patch", only("deps")],
    ["src-tauri/Cargo.toml", only("deps", "platform")],
    ["src-tauri/Cargo.lock", only("deps", "platform")],
    ["scripts/deps/check.mjs", only("deps")],
  ])("classifies dependency row path %s", (file, expected) => {
    expect(classifyRiskClasses([file])).toEqual(expected);
  });

  it.each([
    ["src/plugins/other.ts", only("editor")], ["src/components/Editor/View.tsx", only("editor")],
    ["src/services/editor/port.ts", only("editor", "ipc")],
    ["src/utils/cursorSync/position.ts", only("editor")],
    ["src/utils/milkdownFocusCarry.ts", only("editor")],
    ["src/utils/focusActiveMilkdownAtEnd.ts", only("editor")],
    ["src/utils/editorMenuCommands.ts", only("editor")],
  ])("classifies editor row path %s", (file, expected) => {
    expect(classifyRiskClasses([file])).toEqual(expected);
  });

  const pipelineCases: Array<[string, ReturnType<typeof classifyRiskClasses>]> = [
    ["src/plugins/milkdown/commonmarkPreset.ts", only("editor", "pipeline")],
    ["src/plugins/milkdown/gfmPreset.ts", only("editor", "pipeline")],
    ["src/plugins/milkdown/linkDefinitions/a.ts", only("editor", "pipeline")],
    ["src/plugins/milkdown/listSpread/a.ts", only("editor", "pipeline")],
    ["src/plugins/milkdown/emptyParagraph/a.ts", only("editor", "pipeline")],
    ["src/plugins/milkdown/table/a.ts", only("editor", "pipeline")],
    ...["sanitizerPolicy", "exportService", "mathRender", "highlightSyntax"].map((name) =>
      [`src/services/${name}.ts`, only("editor", "pipeline", "ipc")] as [string, ReturnType<typeof classifyRiskClasses>]),
  ];
  it.each(pipelineCases)("classifies pipeline row path %s", (file, expected) => {
    expect(classifyRiskClasses([file])).toEqual(expected);
  });

  it.each([
    [".github/workflows/ci.yml", only("ci")], ["scripts/ci/check.mjs", only("ci")],
    ["scripts/heavy-lock.sh", only("ci")], ["vitest.config.ts", only("ci")],
    ["vitest.workers.ts", only("ci")], ["tests/ci-inventory.json", only("ci")],
    ["tests/webkit/case.test.ts", only("ci")],
  ])("classifies CI row path %s", (file, expected) => {
    expect(classifyRiskClasses([file])).toEqual(expected);
  });

  it.each([
    ["src-tauri/src/commands/save.rs", only("ipc", "platform")],
    ["src-tauri/src/lib.rs", only("ipc", "platform")],
    ["src-tauri/capabilities/default.json", only("ipc", "platform")],
    ["src/services/fileService.ts", only("ipc")],
    ["src-tauri/src/menu.rs", only("platform")],
  ])("classifies IPC and platform row path %s", (file, expected) => {
    expect(classifyRiskClasses([file])).toEqual(expected);
  });

  it("keeps prose and unmatched code outside advisory classes, and unions overlapping paths", () => {
    expect(classifyRiskClasses(["docs/adr/0001-a.md", "progress.md"])).toEqual(only());
    expect(classifyRiskClasses(["src/文字.ts", "src/App.tsx"])).toEqual(only());
    expect(classifyPaths(["src/文字.ts"])).toBe("code");
    expect(classifyRiskClasses(["patches/a.patch", "src/services/editor/port.ts", ".github/workflows/ci.yml"]))
      .toEqual(only("deps", "editor", "ci", "ipc"));
    expect(classifyRiskClasses(["src/pluginsx/foo.ts", "patchesx/a.patch", "src/services/foo/bar.tsx"])).toEqual(only("ipc"));
  });
});

describe("MIG003a workflow outputs", () => {
  it("publishes exactly six advisory outputs from scope alone", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/ci.yml"), "utf8");
    const outputs = entry(job(text, "scope"), "outputs")?.body ?? null;
    expect(["deps", "editor", "pipeline", "ci", "ipc", "platform"].map((name) =>
      [name, scalar(outputs, name)])).toEqual([
      ["deps", "${{ steps.scope.outputs.deps }}"], ["editor", "${{ steps.scope.outputs.editor }}"],
      ["pipeline", "${{ steps.scope.outputs.pipeline }}"], ["ci", "${{ steps.scope.outputs.ci }}"],
      ["ipc", "${{ steps.scope.outputs.ipc }}"], ["platform", "${{ steps.scope.outputs.platform }}"],
    ]);
    expect((outputs ?? "").trim().split("\n").map((line) => line.trim().split(":")[0]))
      .toEqual(["code", "deps", "editor", "pipeline", "ci", "ipc", "platform"]);
    for (const id of jobIds(text).filter((id) => id !== "scope"))
      expect(job(text, id), id).not.toMatch(/steps\.scope\.outputs\.(?:deps|editor|pipeline|ci|ipc|platform)\b|needs\.scope\.outputs\.(?:deps|editor|pipeline|ci|ipc|platform)\b/);
  });
});
