// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    code_block: { content: "text*", group: "block", code: true },
    text: { group: "inline" },
  },
  marks: { strong: {}, code: { code: true }, link: { attrs: { href: {} } } },
});
const text = (value: string, marks: string[] = []) => schema.text(value, marks.map((name) => schema.mark(name, name === "link" ? { href: "https://cat.example" } : undefined)));
const paragraph = (...nodes: ReturnType<typeof text>[]) => schema.node("paragraph", null, nodes);
const doc = (...nodes: ReturnType<typeof paragraph>[]) => schema.node("doc", null, nodes);
const ranges = async (query: string, input: ReturnType<typeof doc>, options = {}) => {
  const model = await import("../src/plugins/milkdown/find/findModel").catch(() => null);
  return model?.findMatches(input, query, { caseSensitive: false, wholeWord: false, ...options }) ?? [];
};

describe("WYSIWYG literal search model", () => {
  it("finds two plain occurrences and never crosses a paragraph", async () => {
    expect(await ranges("cat", doc(paragraph(text("cat cat")), paragraph(text("ca")), paragraph(text("t"))))).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }]);
  });

  it("supports empty, case and whole-word queries", async () => {
    const input = doc(paragraph(text("Cat cat scatter 猫猫")));
    expect(await ranges("", input)).toEqual([]);
    expect(await ranges("cat", input, { caseSensitive: true })).toEqual([{ from: 5, to: 8 }, { from: 10, to: 13 }]);
    expect(await ranges("cat", input, { wholeWord: true })).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }]);
  });

  it("joins text split by formatting and excludes code and link targets", async () => {
    const input = doc(paragraph(text("ca", ["strong"]), text("t "), text("cat", ["code"]), text(" cat", ["link"])), schema.node("code_block", null, text("cat")));
    expect(await ranges("cat", input)).toEqual([{ from: 1, to: 4 }, { from: 9, to: 12 }]);
    expect(JSON.stringify(input)).toContain("https://cat.example");
  });

  it("treats regex metacharacters as literal through query changes", async () => {
    const input = doc(paragraph(text(". [ ( * \\ $ cat")));
    for (const query of [".", "[", "(", "*", "\\", "$"]) {
      const index = input.textContent.indexOf(query);
      expect(await ranges(query, input)).toEqual([{ from: index + 1, to: index + query.length + 1 }]);
    }
    expect(await ranges("cat", input)).toEqual([{ from: 13, to: 16 }]);
  });

  it("excludes shipped inline-code and math names while retaining visible link labels", async () => {
    const rich = new Schema({
      nodes: {
        doc: { content: "block+" }, paragraph: { content: "inline*", group: "block" },
        code_block: { content: "text*", group: "block", code: true },
        math_inline: { content: "text*", group: "inline", inline: true }, text: { group: "inline" },
      },
      marks: { inlineCode: { code: true }, link: { attrs: { href: {} } } },
    });
    const input = rich.node("doc", null, [rich.node("paragraph", null, [
      rich.text("cat "), rich.text("cat", [rich.mark("inlineCode")]), rich.text(" "),
      rich.node("math_inline", null, rich.text("cat")), rich.text(" cat", [rich.mark("link", { href: "https://cat.example" })]),
    ]), rich.node("code_block", null, rich.text("cat"))]);
    expect(await ranges("cat", input)).toEqual([{ from: 1, to: 4 }, { from: 15, to: 18 }]);
  });

  it("keeps source offsets when Unicode case folding expands an earlier character", async () => {
    const input = doc(paragraph(text("İcatZ")));
    expect(await ranges("cat", input)).toEqual([{ from: 2, to: 5 }]);
    expect(await ranges("ος", doc(paragraph(text("ΟΣ"))))).toEqual([{ from: 1, to: 3 }]);
    expect(await ranges("cat", doc(paragraph(text("𐐀cat cat"))), { wholeWord: true })).toEqual([{ from: 7, to: 10 }]);
    expect(await ranges("ss", doc(paragraph(text("sßss"))))).toEqual([{ from: 2, to: 3 }, { from: 3, to: 5 }]);
  });

  it("matches an enumerated punctuation and CJK domain against a literal oracle", async () => {
    const alphabet = ["a", "猫", ".", "[", "*", "\\", "$", "+", "(", ")"];
    for (let seed = 1; seed <= 80; seed += 1) {
      const query = alphabet[seed % alphabet.length] + alphabet[(seed * 7) % alphabet.length];
      const content = `x${query}y${alphabet[(seed * 3) % alphabet.length]}${query}z`;
      const expected: { from: number; to: number }[] = [];
      let from = 0;
      while ((from = content.indexOf(query, from)) !== -1) {
        expected.push({ from: from + 1, to: from + query.length + 1 });
        from += query.length;
      }
      expect(await ranges(query, doc(paragraph(text(content))), { caseSensitive: true })).toEqual(expected);
    }
  });
});
