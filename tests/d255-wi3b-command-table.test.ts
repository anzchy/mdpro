// @vitest-environment node
import { expect, it } from "vitest";
import { rowById } from "../src/commands/commandTable";

const rows = [
  ["format.underline", "both"],
  ["format.image", "both"],
  ["format.clearFormat", "W"],
  ["edit.selectLine", "both"],
  ["edit.selectWord", "both"],
  ["paragraph.increaseHeading", "both"],
  ["paragraph.decreaseHeading", "both"],
] as const;

it.each(rows)("AC-10 %s has enabled v1/v2 availability %s and frontend route", (id, availability) => {
  const row = rowById(id);
  expect(row).toBeDefined();
  for (const platform of ["macos", "windows", "linux"] as const) {
    expect(row!.availability[platform]).toEqual({ v1: availability, v2: availability });
    expect(row!.route[platform]).toBe("frontend");
  }
});

it("AC-10/11 Image has its Mac v1 key and no off-Mac key until M1b", () => {
  const row = rowById("format.image")!;
  expect(row.key.macos.defaults.v1).toBe("Cmd+Ctrl+I");
  expect(row.key.windows.defaults.v1).toBe("<unassigned>");
  expect(row.key.linux.defaults.v1).toBe("<unassigned>");
  expect(row.key.windows.defaults.v2).toBe("<unassigned>");
  expect(row.key.linux.defaults.v2).toBe("<unassigned>");
});
