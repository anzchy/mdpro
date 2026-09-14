/**
 * Tests for WYSIWYG security helpers (issues #7 and #10)
 *
 * #7 — pasted HTML must be sanitized through DOMPurify before ProseMirror
 *       parses it, stripping XSS vectors such as event handlers and
 *       javascript: hrefs.
 *
 * #10 — clicks on links with javascript: or data: protocols must be blocked
 *        in the Milkdown editor container.
 */

import { describe, expect, it } from "vitest";
import { sanitizePastedHtml } from "../src/components/Editor/MilkdownEditor";
import { isSafeHref } from "../src/services/linkSafety";
import { ALLOWED_URI_SCHEMES } from "../src/services/sanitizerPolicy";

// ---------------------------------------------------------------------------
// sanitizePastedHtml — issue #7
// ---------------------------------------------------------------------------

describe("sanitizePastedHtml", () => {
  it("returns plain text unchanged", () => {
    const result = sanitizePastedHtml("Hello world");
    expect(result).toBe("Hello world");
  });

  it("preserves safe inline markup: bold and italic", () => {
    const html = "<strong>bold</strong> and <em>italic</em>";
    const result = sanitizePastedHtml(html);
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("preserves safe block elements: p, ul, li", () => {
    const html = "<p>Para</p><ul><li>item</li></ul>";
    const result = sanitizePastedHtml(html);
    expect(result).toContain("<p>Para</p>");
    expect(result).toContain("<ul><li>item</li></ul>");
  });

  it("strips onerror event handler from img tag (#7)", () => {
    const html = '<img src="x" onerror="alert(1)">';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
    // The img element itself may survive (src=x is harmless); onerror must not
  });

  it("strips onclick event handler from anchor tag", () => {
    const html = '<a href="https://example.com" onclick="alert(1)">link</a>';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("alert");
  });

  it("strips javascript: href from anchor tag (#7)", () => {
    const html = '<a href="javascript:alert(1)">click me</a>';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("javascript:");
  });

  it("strips script tags entirely", () => {
    const html = "<p>text</p><script>alert(1)</script>";
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("strips data: src on img (potential data-URI XSS)", () => {
    const html = '<img src="data:text/html,<script>alert(1)</script>">';
    const result = sanitizePastedHtml(html);
    // DOMPurify blocks data: URIs that contain HTML/script content
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("preserves safe https:// href on anchor", () => {
    const html = '<a href="https://example.com">link</a>';
    const result = sanitizePastedHtml(html);
    expect(result).toContain("https://example.com");
    expect(result).toContain("link");
  });

  it("handles empty string without throwing", () => {
    expect(() => sanitizePastedHtml("")).not.toThrow();
    expect(sanitizePastedHtml("")).toBe("");
  });

  it("handles plain-text clipboard content (no tags)", () => {
    const text = "just plain text with no markup";
    const result = sanitizePastedHtml(text);
    expect(result).toBe(text);
  });

  it("strips inline event handlers: onload, onmouseover", () => {
    const html = '<img src="x" onload="steal()" onmouseover="xss()">';
    const result = sanitizePastedHtml(html);
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onmouseover");
    expect(result).not.toContain("steal");
    expect(result).not.toContain("xss");
  });
});

// ---------------------------------------------------------------------------
// isSafeHref — issue #10
// ---------------------------------------------------------------------------

describe("isSafeHref", () => {
  it("allows https:// links", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
  });

  it("allows http:// links", () => {
    expect(isSafeHref("http://example.com")).toBe(true);
  });

  it("allows mailto: links", () => {
    expect(isSafeHref("mailto:user@example.com")).toBe(true);
  });

  it("allows relative fragment links (#anchor)", () => {
    expect(isSafeHref("#section")).toBe(true);
  });

  it("allows relative path links (./foo.md)", () => {
    expect(isSafeHref("./foo.md")).toBe(true);
  });

  it("blocks javascript: protocol (#10)", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
  });

  it("blocks javascript: with mixed case", () => {
    expect(isSafeHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("JAVASCRIPT:void(0)")).toBe(false);
  });

  // W2-05 — PRESERVED. Above/below the boundary, two different mechanisms:
  //
  // Below (this block): **leading** whitespace, including a leading \t. Handled
  // since the original implementation by `trim()`, so it has always passed. It
  // is therefore NOT interior-control-char coverage and must not be counted as
  // the regression test for the interior-control-char defect.
  //
  // Further below (W2-01..W2-04): **interior** control chars. The WHATWG URL
  // parser strips U+0009/U+000A/U+000D from *anywhere* in the input, so these
  // reach the sink as `javascript:` while sailing past a prefix check. Those
  // are the real regression cases.
  it("blocks javascript: with leading whitespace (bypass attempt)", () => {
    expect(isSafeHref("  javascript:alert(1)")).toBe(false);
    expect(isSafeHref("\tjavascript:alert(1)")).toBe(false);
  });

  // --- W2-01..W2-04: interior control characters (the actual exploit class) ---

  it("W2-01: blocks javascript: split by an interior TAB", () => {
    expect(isSafeHref("java\tscript:alert(1)")).toBe(false);
  });

  it("W2-02: blocks javascript: split by an interior LF or CR", () => {
    expect(isSafeHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeHref("java\rscript:alert(1)")).toBe(false);
  });

  it("W2-03: blocks mixed-case javascript: split by an interior TAB", () => {
    // Case-folding and control-stripping must BOTH happen before the scheme is
    // extracted; an implementation that orders them wrongly passes W2-01.
    expect(isSafeHref("JaVa\tScRiPt:alert(1)")).toBe(false);
  });

  it("W2-04: blocks data: split by an interior TAB", () => {
    // Proves the hole is in the mechanism, not in the `javascript` literal.
    expect(isSafeHref("da\tta:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks data: protocol (#10)", () => {
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks data: with mixed case", () => {
    expect(isSafeHref("Data:text/html,evil")).toBe(false);
  });

  it("blocks vbscript: protocol", () => {
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
  });

  it("returns false for empty href", () => {
    expect(isSafeHref("")).toBe(false);
  });

  // --- W2-06: named non-allowlisted schemes ---------------------------------
  // NOTE: this case does NOT prove the denylist->allowlist shape change. A
  // 12-entry denylist covering this list plus W2-16's corpus passes it. W2-17
  // is the shape proof. Do not "strengthen" this by adding more literal rows —
  // more rows is the mechanism that created the gap in the first place.
  it.each([
    "file:///etc/passwd",
    "blob:https://x/y",
    "about:blank",
    "filesystem:https://x/",
    "sms:+1",
    "callto:x",
    "xmpp:x",
    "intent://x",
    "chrome://settings",
  ])("W2-06: rejects non-allowlisted scheme %s", (href) => {
    expect(isSafeHref(href)).toBe(false);
  });

  // --- W2-07: non-parser-reachable control characters (hardening) -----------
  // DO NOT OVER-CLAIM: these are fail-closed hardening, NOT exploitable
  // bypasses. The WHATWG URL parser strips only U+0009/U+000A/U+000D. NUL,
  // U+0001, U+007F and interior space are NOT removed by it, so
  // "java\u{0000}script:x" never resolves to javascript:x — it resolves to a
  // percent-encoded relative path under the document origin. They are asserted
  // because they cost nothing, fail closed, and pin the strip set against a
  // future narrowing.
  it.each([
    "java\u{0000}script:x",
    "java\u{0001}script:x",
    "java\u{007f}script:x",
    "java script:x",
  ])("W2-07: rejects control-char-obfuscated scheme %j", (href) => {
    expect(isSafeHref(href)).toBe(false);
  });

  it("W2-08: rejects a relative filename whose space-stripped form looks like a scheme", () => {
    // Accepted collateral of stripping U+0020 for scheme inspection.
    //
    // DO NOT DELETE — this case is what keeps W2-16 from becoming a tautology.
    // This input is the only one in the suite that is `false` here while the
    // WHATWG URL parser would resolve it to a harmless relative path. Against
    // an implementation that simply delegates to the URL parser, every other
    // candidate in W2-16's corpus agrees with the parser by construction, so
    // W2-16 would hold trivially and prove nothing about this function's own
    // normalization. This case is the disagreement that gives W2-16 teeth. It
    // looks over-aggressive; it is load-bearing. Removing it silently neuters
    // the property test.
    expect(isSafeHref("my file:x.md")).toBe(false);
  });

  // --- W2-09: every allowlisted scheme is accepted --------------------------
  // Iterates the IMPORTED constant rather than re-listing it, so a scheme added
  // on the Rust side (and mirrored into sanitizerPolicy.ts) cannot silently
  // leave isSafeHref behind. Parity with markdown.rs itself is already pinned
  // by tests/sanitizer-rust-js-parity.test.ts:64-66 — not duplicated here.
  const SCHEME_SAMPLE_URLS: Record<string, string | undefined> = {
    http: "http://example.com",
    https: "https://example.com",
    mailto: "mailto:user@example.com",
    tel: "tel:+15551234",
    ftp: "ftp://ftp.example.com/pub",
  };

  it.each(ALLOWED_URI_SCHEMES)("W2-09: permits allowlisted scheme %s", (scheme) => {
    const sample = SCHEME_SAMPLE_URLS[scheme];
    expect(sample, `no sample URL for allowlisted scheme "${scheme}"`).toBeDefined();
    expect(isSafeHref(sample ?? "")).toBe(true);
  });

  it("W2-10: permits an allowlisted scheme in uppercase or with leading whitespace", () => {
    // Guards the ACCEPT path's case-folding. Comparing the extracted scheme
    // without lowercasing would block every capitalized link in a real
    // document — a user-visible regression no reject-side case would catch.
    expect(isSafeHref("HTTPS://EXAMPLE.COM/Path")).toBe(true);
    expect(isSafeHref("  https://example.com")).toBe(true);
  });

  // --- W2-11: scheme-less references stay permitted -------------------------
  // The single most likely way to "pass security" while breaking the app:
  // requiring a scheme and rejecting when the regex does not match would block
  // every in-document link.
  it.each(["#section", "./foo.md", "foo/bar.png", "?q=1", "../up.md", "/abs/path.md"])(
    "W2-11: permits scheme-less reference %s",
    (href) => {
      expect(isSafeHref(href)).toBe(true);
    },
  );

  it("W2-12: permits a relative path containing a space", () => {
    // SCOPE LIMIT: isSafeHref returns a boolean, so no assertion here can prove
    // the *opened* string kept its space. Normalization is strip-to-decide,
    // open-the-original. W3-11 proves the opened value at the hook level.
    expect(isSafeHref("./my file.md")).toBe(true);
  });

  it("W2-13: does not treat a non-alpha-leading prefix as a scheme", () => {
    // A regex of /^([^:]*):/ would read `5` as a scheme and block a timestamp.
    // Pairs with W2-19, which pins the continuation class.
    expect(isSafeHref("5:00")).toBe(true);
    expect(isSafeHref("+foo:bar")).toBe(true);
  });

  it("W2-14: rejects empty and whitespace-only hrefs (deliberate NARROWING)", () => {
    // NARROWING, not preservation: isSafeHref("   ") and isSafeHref("\t\n")
    // return TRUE before this work item — the `!href` guard misses them because
    // they are non-empty, and after trim() they match no denylist prefix. Only
    // "" is genuinely preserved behavior.
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("   ")).toBe(false);
    expect(isSafeHref("\t\n")).toBe(false);
  });

  it("W2-15: rejects protocol-relative //host/path at gate A", () => {
    // INVERSION (was: permitted here, adjudicated downstream). Under the
    // production origin `tauri://localhost`, "//evil.com/x" resolves to
    // `tauri://evil.com/x` — an attacker-chosen host wearing the app's own
    // scheme, which is finding C1. Deferring the verdict to a resolved-value
    // gate is exactly what failed, so gate A now refuses the form outright.
    // WI-5's hostname comparison would catch the resolved value independently;
    // this rejection is defense in depth and removes the dependence on URL-
    // parser authority semantics for a non-special scheme.
    //
    // ACCEPTED COST: protocol-relative markdown links no longer open at all,
    // at any origin. Authors must write an explicit https:// scheme.
    expect(isSafeHref("//evil.com/x")).toBe(false);
    expect(isSafeHref("//evil.com")).toBe(false);
    expect(isSafeHref("//evil.com/x?a=b")).toBe(false);
  });

  // --- W2-20: protocol-relative hidden behind control characters ------------
  // The decision must be read off the STRIPPED, lowercased string, never the
  // raw attribute: a leading NUL, space, TAB or CRLF hides the leading "//"
  // from any raw `href.startsWith("//")` check, and the interior-NUL row also
  // defeats `normalized.trimStart().startsWith("//")`.
  //
  // HONESTY NOTE (W2-07 precedent): the two NUL rows are fail-closed hardening,
  // NOT exploitable bypasses. The WHATWG parser strips only U+0009/U+000A/
  // U+000D, so "\u0000//evil.com/x" really resolves to a percent-encoded
  // same-origin path, not to an authority. Only the space, TAB and CRLF rows
  // are parser-reachable. Labelling hardening as an exploit would destroy the
  // suite's ability to tell a reviewer which cases actually matter.
  it.each([
    " //evil.com/x",
    "\t//evil.com/x",
    "\n\r//evil.com",
    "\u0000//evil.com/x",
    "/\u0000/evil.com/x",
    "//evil.com",
  ])("W2-20: rejects control-character-hidden protocol-relative %j", (href) => {
    expect(isSafeHref(href)).toBe(false);
  });

  // --- W2-21: backslash authority forms -------------------------------------
  // All four two-character combinations of "/" and "\" are refused. For
  // SPECIAL schemes the WHATWG parser treats "\" as "/", so under an http base
  // every one of these introduces an authority; under a tauri base they do not.
  //
  // This is deliberately OVER-BLOCKING under a tauri base and correct under an
  // http base — the plan's stated choice (Risks §3), not an oversight. Making
  // the verdict depend on which origin the app happens to be running under is
  // the pattern this fix exists to remove. If a real markdown file is found
  // broken by it, that is an ADR-0002 amendment, not a silent relaxation.
  it.each(["\\\\evil.com/x", "/\\evil.com/x", "\\/evil.com/x", " \\\\evil.com/x"])(
    "W2-21: rejects backslash authority form %j",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );

  // --- W2-22: over-narrowing guard ------------------------------------------
  // The near side of the boundary W2-20/W2-21 test from the far side. Over-
  // aggressive narrowing is the most likely way to "pass security" while
  // breaking every in-document link, so the rejection must be two characters
  // wide, not one: `normalized.startsWith("/")` must not ship.
  it.each([
    "/abs/path.md", // kills the naive startsWith("/")
    "/", // single-character edge; an index-1 read must not throw or mis-decide
    "/a//b", // kills normalized.includes("//")
    "./foo.md", // the most common in-document form
    "#section", // fragment
    "\\evil.com", // ONE backslash: kills "reject any leading slash-or-backslash",
    // and fails loudly if a sibling case's backslashes were mis-escaped
  ])("W2-22: still permits %j", (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  // --- W2-16: PROPERTY — permitted ⟹ resolved scheme is allowlisted ---------
  it("W2-16: every permitted href resolves to an allowlisted scheme", () => {
    const dangerous = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://x/y",
      "about:blank",
      "chrome://settings",
    ];
    const stripped = ["\t", "\n", "\r"];
    const benign = [
      "http://example.com",
      "https://example.com",
      "mailto:user@example.com",
      "tel:+15551234",
      "ftp://ftp.example.com/pub",
      "#section",
      "./foo.md",
      "foo/bar.png",
      "?q=1",
      "../up.md",
      "/abs/path.md",
      "./my file.md",
      "5:00",
      "+foo:bar",
      "//evil.com/x",
    ];

    const candidates: string[] = [...dangerous, ...benign];
    for (const d of dangerous) {
      const colon = d.indexOf(":");
      for (const c of stripped) {
        candidates.push(c + d, d + c);
        for (let i = 1; i < colon; i++) {
          candidates.push(d.slice(0, i) + c + d.slice(i));
        }
      }
    }

    // The oracle is jsdom's own WHATWG URL parser — deliberately independent of
    // the implementation under test.
    const documentScheme = window.location.protocol.replace(":", "");
    const permitted = new Set([...ALLOWED_URI_SCHEMES, documentScheme]);

    const violations: { href: string; resolved: string }[] = [];
    let permittedCount = 0;
    for (const href of candidates) {
      if (!isSafeHref(href)) continue;
      permittedCount++;
      const anchor = document.createElement("a");
      anchor.setAttribute("href", href);
      const resolved = anchor.href;
      const scheme = new URL(resolved).protocol.replace(":", "");
      if (!permitted.has(scheme)) violations.push({ href, resolved });
    }

    expect(
      violations,
      `permitted hrefs resolving to a non-allowlisted scheme: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });

  // --- W2-17: PROPERTY — the shape proof (denylist -> allowlist) ------------
  // Quantified over SCHEME SPACE, not over insertion positions. This is the
  // only case that can prove the shape change: a denylist of any finite size
  // leaves infinitely many schemes permitted, so it fails here by construction.
  //
  // Seeded PRNG is hand-rolled on purpose: fast-check is NOT a dependency of
  // this repo and adding one is out of scope for a security fix.
  it("W2-17: rejects every scheme outside the allowlist, in both URL forms", () => {
    const SEED = 0x5eed1234;

    /** mulberry32 — deterministic, so any failure is reproducible from SEED. */
    function mulberry32(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const rand = mulberry32(SEED);
    const FIRST = "abcdefghijklmnopqrstuvwxyz";
    const REST = "abcdefghijklmnopqrstuvwxyz0123456789+.-";
    const pick = (alphabet: string) => alphabet[Math.floor(rand() * alphabet.length)];

    const random: string[] = [];
    for (let i = 0; i < 500; i++) {
      const len = 2 + Math.floor(rand() * 9); // 2..10 continuation chars
      let scheme = pick(FIRST);
      for (let j = 0; j < len; j++) scheme += pick(REST);
      random.push(scheme);
    }

    const named = [
      "ftps", "telnet", "httpx", "mailtoevil", "ms-msdt", "web+mailto", "s3.aws",
      "h2", "javascript", "data", "vbscript", "file", "blob", "about", "chrome",
      "filesystem", "sms", "callto", "xmpp", "intent", "obsidian", "steam",
      "itms-services", "jar", "view-source", "cid", "matrix",
    ];

    const domain = [...random, ...named].filter((s) => !ALLOWED_URI_SCHEMES.includes(s));
    expect(domain.length, "scheme domain collapsed — generation is broken").toBeGreaterThan(500);

    const violations: { scheme: string; form: string; result: boolean }[] = [];
    for (const scheme of domain) {
      // Both forms are required: `://` and the opaque `:` form take different
      // paths through most scheme-extraction implementations.
      for (const form of [`${scheme}://x/y`, `${scheme}:x`]) {
        const result = isSafeHref(form);
        if (result) violations.push({ scheme, form, result });
      }
    }

    expect(
      violations,
      `seed=0x${SEED.toString(16)} — non-allowlisted schemes permitted: ${JSON.stringify(
        violations.slice(0, 40),
        null,
        2,
      )} (${violations.length} total)`,
    ).toEqual([]);
  });

  // --- W2-18: near-miss schemes that EXTEND an allowlisted one --------------
  // Targets one specific wrong operator:
  //   ALLOWED_URI_SCHEMES.some((s) => scheme.startsWith(s))   // WRONG
  // which passes every other case in the WI-2 set. Required semantics are set
  // membership by equality: ALLOWED_URI_SCHEMES.includes(scheme).
  //
  // Permitting ftps:// would also contradict this repo's own policy module:
  // tests/sanitizer-malicious-fixtures.test.ts:91 lists "ftps://" in
  // BAD_SCHEMES as a scheme that MUST be dropped from anchor hrefs, and
  // linkSafety.ts imports its allowlist from that very policy module. A
  // startsWith comparison would make one module graph enforce two
  // contradictory policies.
  it.each(["ftps://x/", "telnet://h", "httpx://x", "mailtoevil:x"])(
    "W2-18: rejects near-miss scheme %s",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );

  // --- W2-19: scheme continuation class (FAIL-OPEN risk) --------------------
  // Narrowing the scheme regex to /^([a-z]+):/ fails OPEN, not closed:
  // "ms-msdt:x" would not match, so the implementation falls through to the
  // "no scheme -> permit" branch and returns true. Every other scheme named in
  // this suite is pure alpha, so nothing else would notice.
  it.each(["ms-msdt:x", "web+mailto:x", "s3.aws:x", "h2:x"])(
    "W2-19: rejects well-formed non-alpha scheme %s",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );
});
