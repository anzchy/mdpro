import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs helper shared with the approval-recorder workflow (no type decls)
import { canonicalizeBody, bodySha256 } from "../.github/scripts/canonicalize-body.mjs";

// Locks the body-hash transform used by the small-feature approval-recorder (WI-F0).
// The recorder workflow inlines a byte-identical copy of this transform (it is
// pure-API and cannot checkout to import the module). If this test's pinned hash
// ever changes, the inlined copies in cc-feature-approval-recorder.yml and the
// WI-F1/WI-F3 re-checks MUST be updated in lockstep — a divergence silently fails
// the body-hash gate closed.

describe("canonicalizeBody", () => {
  it("strips trailing whitespace per line and collapses CRLF to LF", () => {
    const input = "## Acceptance Criteria\r\n- [ ] do thing  \r\n- [ ] do other\t\n\n  \n";
    expect(canonicalizeBody(input)).toBe(
      "## Acceptance Criteria\n- [ ] do thing\n- [ ] do other",
    );
  });

  it("drops trailing blank lines and a trailing newline", () => {
    expect(canonicalizeBody("a\n\n\n")).toBe("a");
    expect(canonicalizeBody("a\n")).toBe("a");
    expect(canonicalizeBody("a")).toBe("a");
  });

  it("treats null/undefined as empty", () => {
    expect(canonicalizeBody(null)).toBe("");
    expect(canonicalizeBody(undefined)).toBe("");
  });

  it("is idempotent (canonicalizing a canonical string is a no-op)", () => {
    const once = canonicalizeBody("x  \r\ny\t\n");
    expect(canonicalizeBody(once)).toBe(once);
  });

  it("a cosmetic re-render (CRLF vs LF, trailing spaces) does not change the canonical form", () => {
    const lf = "line one\nline two\n";
    const crlfWithTrailing = "line one  \r\nline two\t\r\n";
    expect(canonicalizeBody(lf)).toBe(canonicalizeBody(crlfWithTrailing));
  });
});

describe("bodySha256", () => {
  // PINNED VECTOR — do not change without updating every inlined copy of the transform.
  it("produces the pinned hash for the canonical acceptance-criteria vector", () => {
    const input = "## Acceptance Criteria\r\n- [ ] do thing  \r\n- [ ] do other\t\n\n  \n";
    expect(bodySha256(input)).toBe(
      "cf64ce3af60d2c27ee4819f8fbdba7b7dc2a13ba299fb5d2ffdb4eba5be29577",
    );
  });

  it("hashes the canonical form, so cosmetic edits yield the same digest", () => {
    const a = "## H\r\n- [ ] one  \n";
    const b = "## H\n- [ ] one";
    expect(bodySha256(a)).toBe(bodySha256(b));
  });

  it("a real body edit changes the digest", () => {
    expect(bodySha256("## H\n- [ ] one")).not.toBe(bodySha256("## H\n- [ ] one and two"));
  });

  it("empty and null hash to the sha256 of the empty string", () => {
    const emptyDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(bodySha256("")).toBe(emptyDigest);
    expect(bodySha256(null)).toBe(emptyDigest);
  });
});
