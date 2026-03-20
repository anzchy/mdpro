import { describe, it, expect } from "vitest";
import { stripFrontmatter } from "../src/services/exportService";
import { parseHeadingsFromContent } from "../src/services/tocService";

describe("stripFrontmatter", () => {
  it("strips standard frontmatter and preserves the body", () => {
    const input = "---\ntitle: Hello\nauthor: Jane\n---\n# Body\n\nParagraph.";
    expect(stripFrontmatter(input)).toBe("# Body\n\nParagraph.");
  });

  it("returns content unchanged when there is no frontmatter", () => {
    const input = "# Just a heading\n\nSome text.";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("only strips the first frontmatter block when --- appears in the body", () => {
    const input = "---\ntitle: Doc\n---\nBody text\n\n---\nHorizontal rule above.";
    expect(stripFrontmatter(input)).toBe("Body text\n\n---\nHorizontal rule above.");
  });

  it("handles frontmatter followed by multiple trailing newlines", () => {
    const input = "---\ntitle: Doc\n---\n\n\nBody starts here.";
    expect(stripFrontmatter(input)).toBe("\n\nBody starts here.");
  });

  it("does not strip a --- block that is not at the very start of the file", () => {
    const input = "Some intro text\n\n---\ntitle: Doc\n---\nMore text.";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("strips empty frontmatter (--- immediately followed by ---)", () => {
    const input = "---\n---\nBody after empty frontmatter.";
    expect(stripFrontmatter(input)).toBe("Body after empty frontmatter.");
  });

  it("strips frontmatter that occupies the entire file, leaving an empty string", () => {
    const input = "---\ntitle: Only frontmatter\n---\n";
    expect(stripFrontmatter(input)).toBe("");
  });

  it("handles CRLF line endings in the frontmatter delimiters", () => {
    const input = "---\r\ntitle: Windows\r\n---\r\nBody text.";
    expect(stripFrontmatter(input)).toBe("Body text.");
  });

  it("does not strip when the opening --- has trailing spaces (not a valid delimiter)", () => {
    const input = "---  \ntitle: Doc\n---\nBody.";
    // Trailing spaces make it not a clean frontmatter delimiter
    expect(stripFrontmatter(input)).toBe(input);
  });
});

describe("tocService.parseHeadingsFromContent — frontmatter not treated as headings", () => {
  it("does not include frontmatter keys as headings when content starts with ---", () => {
    const markdown = "---\ntitle: My Doc\n---\n# Real Heading\n## Section";
    const headings = parseHeadingsFromContent(markdown);

    // Should only find the two ATX headings, not 'title: My Doc' or similar
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe("Real Heading");
    expect(headings[1].text).toBe("Section");
  });
});
