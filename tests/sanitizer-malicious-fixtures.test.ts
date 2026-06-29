/**
 * Fix 4 — table-driven malicious fixtures for the DOMPurify allow-list.
 *
 * The previous additive (`ADD_TAGS`/`ADD_ATTR` + blacklist) config re-admitted
 * external-resource SVG, `srcset`, `xlink:href`, extra URI schemes, and MathML
 * HTML-annotation escape hatches that the Rust profile strips. These assert on
 * the *parsed DOM* of the sanitized output (not source text) so a payload that
 * survives in any executable/loadable form fails the test.
 *
 * jsdom is the Vitest environment, so we parse the sanitized HTML and inspect
 * real nodes/attributes.
 */
import { describe, expect, it } from "vitest";
import { sanitizeRenderedHtml } from "../src/services/sanitizerPolicy";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Collect every attribute value across the tree (lowercased keys). */
function allAttrs(doc: Document): { tag: string; name: string; value: string }[] {
  const out: { tag: string; name: string; value: string }[] = [];
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      out.push({ tag: el.tagName.toLowerCase(), name: attr.name.toLowerCase(), value: attr.value });
    }
  });
  return out;
}

interface Fixture {
  name: string;
  html: string;
  /** Tag names (lowercased) that must NOT appear in the output DOM. */
  forbiddenTags?: string[];
  /** Attribute names (lowercased) that must NOT appear on any node. */
  forbiddenAttrs?: string[];
  /** Substrings that must not appear anywhere in the serialized output. */
  forbiddenSubstrings?: string[];
}

const FIXTURES: Fixture[] = [
  {
    name: "SVG <image href> external load",
    html: '<svg viewBox="0 0 10 10"><image href="http://evil.example/track.png" /></svg>',
    forbiddenTags: ["image"],
    forbiddenSubstrings: ["evil.example"],
  },
  {
    name: "SVG <feImage> external filter load",
    html:
      '<svg viewBox="0 0 10 10"><filter id="f"><feImage href="http://evil.example/x" /></filter></svg>',
    forbiddenTags: ["feimage", "filter"],
    forbiddenSubstrings: ["evil.example"],
  },
  {
    name: "SVG <mask> + <image>",
    html:
      '<svg viewBox="0 0 10 10"><mask id="m"><image href="http://evil.example/x" /></mask><rect width="10" height="10" /></svg>',
    forbiddenTags: ["mask", "image"],
    forbiddenSubstrings: ["evil.example"],
  },
  {
    name: "img srcset responsive external load",
    html: '<img src="local.png" srcset="http://evil.example/2x.png 2x" alt="x">',
    forbiddenAttrs: ["srcset"],
    forbiddenSubstrings: ["evil.example"],
  },
  {
    name: "xlink:href on <use>",
    html: '<svg viewBox="0 0 10 10"><use xlink:href="http://evil.example/sprite#a" /></svg>',
    forbiddenAttrs: ["xlink:href"],
    forbiddenSubstrings: ["evil.example"],
  },
  {
    name: "data: URI on image tag",
    html: '<img src="data:text/html,<script>alert(1)</script>" alt="x">',
    forbiddenSubstrings: ["data:text/html", "<script"],
  },
  {
    name: "MathML annotation-xml encoding text/html escape hatch",
    html:
      '<math><semantics><annotation-xml encoding="text/html">' +
      "<script>alert(1)</script></annotation-xml></semantics></math>",
    forbiddenTags: ["script"],
    forbiddenSubstrings: ["alert(1)"],
  },
];

// Disallowed URI schemes that must be dropped from anchor hrefs.
const BAD_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "ftps://", "callto:", "sms:", "cid:", "xmpp:", "matrix:"];

describe("sanitizeRenderedHtml — malicious fixtures (parsed-DOM assertions)", () => {
  for (const fx of FIXTURES) {
    it(`neutralizes: ${fx.name}`, () => {
      const out = sanitizeRenderedHtml(fx.html);
      const doc = parse(out);

      for (const tag of fx.forbiddenTags ?? []) {
        expect(
          doc.querySelectorAll(tag).length,
          `tag <${tag}> must be stripped; got: ${out}`,
        ).toBe(0);
      }
      const attrs = allAttrs(doc);
      for (const name of fx.forbiddenAttrs ?? []) {
        expect(
          attrs.some((a) => a.name === name),
          `attribute ${name} must be stripped; got: ${out}`,
        ).toBe(false);
      }
      for (const sub of fx.forbiddenSubstrings ?? []) {
        expect(out, `output must not contain ${sub}; got: ${out}`).not.toContain(sub);
      }
    });
  }

  for (const scheme of BAD_SCHEMES) {
    it(`drops href scheme: ${scheme}`, () => {
      const out = sanitizeRenderedHtml(`<a href="${scheme}evil">x</a>`);
      const doc = parse(out);
      const a = doc.querySelector("a");
      const href = a?.getAttribute("href") ?? "";
      expect(href.toLowerCase(), `href with ${scheme} must be dropped; got: ${out}`).not.toContain(
        scheme.replace("//", "").toLowerCase(),
      );
    });
  }
});

describe("sanitizeRenderedHtml — legitimate links/anchors still survive", () => {
  it("keeps in-doc footnote anchors", () => {
    const out = sanitizeRenderedHtml('<a href="#fn1">1</a>');
    expect(parse(out).querySelector("a")?.getAttribute("href")).toBe("#fn1");
  });

  it("keeps http/https/mailto/tel/ftp body links", () => {
    for (const href of [
      "http://example.com/a",
      "https://example.com/b",
      "mailto:me@example.com",
      "tel:+15551234",
      "ftp://example.com/file",
    ]) {
      const out = sanitizeRenderedHtml(`<a href="${href}">x</a>`);
      const got = parse(out).querySelector("a")?.getAttribute("href");
      expect(got, `legit link ${href} must survive; got: ${out}`).toBe(href);
    }
  });

  it("keeps relative image sources", () => {
    const out = sanitizeRenderedHtml('<img src="./pics/diagram.png" alt="d">');
    expect(parse(out).querySelector("img")?.getAttribute("src")).toBe("./pics/diagram.png");
  });

  it("hardens external links with rel=noopener noreferrer (mirrors Rust link_rel)", () => {
    const out = sanitizeRenderedHtml('<a href="https://example.com">x</a>');
    expect(parse(out).querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not add rel to in-doc anchors (no off-document navigation)", () => {
    const out = sanitizeRenderedHtml('<a href="#fn1">1</a>');
    expect(parse(out).querySelector("a")?.getAttribute("rel")).toBeNull();
  });
});
