// @vitest-environment node
/** Purpose: prove every M4 editor and disabled macOS menu item has its table path. */
import { describe, expect, it } from "vitest";
import { COMMAND_TABLE, rowById } from "../src/commands/commandTable";

const PATHS: Readonly<Record<string, readonly string[]>> = {
  "file.saveAs": ["File", "Save As..."],
  "edit.copyAsMarkdown": ["Edit", "Copy as Markdown"],
  "edit.pasteAsPlainText": ["Edit", "Paste as Plain Text"],
  "edit.selectLine": ["Edit", "Selection", "Select Line"],
  "edit.selectWord": ["Edit", "Selection", "Select Word"],
  "edit.deleteWord": ["Edit", "Selection", "Delete Word"],
  "edit.find": ["Edit", "Find", "Find..."],
  "edit.replace": ["Edit", "Find", "Replace..."],
  "edit.findNext": ["Edit", "Find", "Find Next"],
  "edit.findPrevious": ["Edit", "Find", "Find Previous"],
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
    `paragraph.heading${index + 1}`, ["Paragraph", `Heading ${index + 1}`],
  ])),
  "paragraph.paragraph": ["Paragraph", "Paragraph"],
  "paragraph.increaseHeading": ["Paragraph", "Increase Heading"],
  "paragraph.decreaseHeading": ["Paragraph", "Decrease Heading"],
  "paragraph.table": ["Paragraph", "Table..."],
  "paragraph.codeFences": ["Paragraph", "Code Fences"],
  "paragraph.mathBlock": ["Paragraph", "Math Block"],
  "paragraph.quote": ["Paragraph", "Quote"],
  "paragraph.orderedList": ["Paragraph", "Ordered List"],
  "paragraph.unorderedList": ["Paragraph", "Unordered List"],
  "paragraph.indent": ["Paragraph", "Indent"],
  "paragraph.outdent": ["Paragraph", "Outdent"],
  "format.strong": ["Format", "Bold"],
  "format.emphasis": ["Format", "Italic"],
  "format.underline": ["Format", "Underline"],
  "format.code": ["Format", "Code"],
  "format.strike": ["Format", "Strikethrough"],
  "format.hyperlink": ["Format", "Link..."],
  "format.image": ["Format", "Image..."],
  "format.clearFormat": ["Format", "Clear Format"],
};

describe("M4 macOS command-table tree", () => {
  it("places each editor item once at its planned path and leaves unrelated rows out", () => {
    const actual = Object.fromEntries(
      COMMAND_TABLE.filter((row) => row.id in PATHS).map((row) => [row.id, row.menu.macos]),
    );
    expect(actual).toEqual(PATHS);
    expect(Object.keys(actual)).toHaveLength(Object.keys(PATHS).length);
    expect(rowById("edit.jumpToTop")?.menu.macos).toBe("none");
    expect(rowById("edit.jumpToBottom")?.menu.macos).toBe("none");
  });

  it("keeps the v1 key and D255 Source availability while moving Table", () => {
    expect(rowById("paragraph.table")?.key.macos).toMatchObject({ defaults: { v1: "Cmd+Option+T" } });
    expect(rowById("paragraph.table")?.availability.macos.v1).toBe("W");
    expect(rowById("paragraph.quote")?.availability.macos.v1).toBe("none");
    expect(rowById("edit.selectLine")?.availability.macos.v1).toBe("both");
    expect(rowById("format.strong")?.availability.macos.v1).toBe("both");
  });

  it("assigns a distinct native id to every new path", () => {
    const ids = Object.keys(PATHS).map((id) => rowById(id)?.menuId);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("menu."))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
