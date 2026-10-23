// @vitest-environment node
import { expect, it } from "vitest";
import { rowByPrefField } from "../src/commands/commandTable";
import { rowStateOf } from "../src/components/common/settings/shortcuts/rowState";

it("M1b WI-13 shows a stored duplicate as suppressed throughout the run, even after repair is saved", () => {
  const row = rowByPrefField("fileSave")!;
  const read = () => rowStateOf({
    row, platform: "macos", version: 2,
    local: { fileSave: "Cmd+S" }, saved: { fileSave: "Cmd+S" },
    applied: { fileSave: { state: "suppressed", reason: "customDuplicate" } } as never,
    conflicts: new Set(),
  });
  expect(read).not.toThrow();
  expect(read()).toMatchObject({ kind: "configurable", value: "Cmd+S", suppressed: "customDuplicate" });
});
