// @vitest-environment node
import { expect, it } from "vitest";
import { resolveBindings } from "../src/commands/bindingConflicts";

it("M1b WI-14 releases removed preset headings as custom app chords in v2", () => {
  expect(resolveBindings("macos", 2, { fileSave: "Cmd+Option+3" }).fileSave)
    .toMatchObject({ kind: "bound", chord: "Cmd+Option+3" });
});

it("D267 releases CodeMirror's removed delete-line chord to a custom app binding", () => {
  expect(resolveBindings("windows", 2, {
    fileSave: "Cmd+Shift+K", paragraphCodeFences: "<unassigned>",
  }).fileSave).toMatchObject({ kind: "bound", chord: "Cmd+Shift+K" });
});
