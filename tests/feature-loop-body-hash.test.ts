// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs helper shared with the approval-recorder workflow (no type decls)
import { canonicalizeBody, bodySha256 } from "../.github/scripts/canonicalize-body.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORDER_YML = resolve(
  HERE,
  "../.github/workflows/cc-feature-approval-recorder.yml",
);
const recorderText = readFileSync(RECORDER_YML, "utf8");

/**
 * Extract and reconstruct the inlined canonicalize+hash transform from the recorder
 * YAML so we can run the SAME implementation the workflow uses (not the module) on
 * shared vectors. The YAML embeds the snippet inside `script: |`; the `rstrip`,
 * `canonicalizeBody`, and `bodySha256` declarations are reproduced here by slicing
 * the YAML text between the `const rstrip` declaration and the end of the
 * `bodySha256` arrow function, then evaluating it against an injected `crypto`.
 * If the inline copy drifts from the module, this transform diverges from
 * `bodySha256` and the parity test below fails.
 */
function inlineTransformFromYaml(): (body: unknown) => string {
  const start = recorderText.indexOf("const rstrip =");
  const endAnchor = ".digest('hex');";
  const end = recorderText.indexOf(endAnchor, start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate inline transform in recorder YAML");
  }
  // The YAML lines are indented; trim each line so the snippet is valid JS.
  const snippet = recorderText
    .slice(start, end + endAnchor.length)
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "crypto",
    `${snippet}\nreturn bodySha256;`,
  ) as (crypto: { createHash: typeof createHash }) => (body: unknown) => string;
  return factory({ createHash });
}

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

  // PINNED VECTOR — Unicode/CJK body. UTF-8 encoding + per-line rstrip must be
  // multi-byte-safe; the \s+ rstrip must not corrupt CJK codepoints.
  it("produces the pinned hash for a CJK/Unicode vector", () => {
    const input = "## 验收标准\r\n- [ ] 实现功能  \r\n- [ ] 测试覆盖\t\n\n  \n";
    expect(canonicalizeBody(input)).toBe("## 验收标准\n- [ ] 实现功能\n- [ ] 测试覆盖");
    expect(bodySha256(input)).toBe(
      "b2d129bed172663a544d9d47936ec679fbe99542ca8c166331f331a9b3d47667",
    );
  });

  // PINNED VECTOR — moderately large body (200 CRLF lines, trailing whitespace each).
  // Guards against any line-count / buffering assumption in the transform.
  it("produces the pinned hash for a moderately large vector", () => {
    const large =
      Array.from(
        { length: 200 },
        (_, i) => `- [ ] task line number ${i} with some trailing whitespace   `,
      ).join("\r\n") + "\n\n";
    expect(bodySha256(large)).toBe(
      "7c4dc0b270cd24a172607900913559cc7bb481d07708a7c41d78862d4704770d",
    );
  });
});

// Anti-drift guard (WI-F0, Dim 5/7): the recorder INLINES a copy of the transform
// because it is pure-API and cannot checkout to import the module. This suite runs
// the inline copy extracted from the YAML against the module on the SAME vectors and
// asserts byte-identical output, so a silent drift between the two fails the build.
describe("recorder inline transform parity", () => {
  const inlineBodySha256 = inlineTransformFromYaml();

  // Shared vectors: cosmetic edge cases + Unicode + large + the pinned expected hashes.
  const vectors: Array<{ name: string; input: unknown; expected: string }> = [
    {
      name: "acceptance-criteria",
      input: "## Acceptance Criteria\r\n- [ ] do thing  \r\n- [ ] do other\t\n\n  \n",
      expected: "cf64ce3af60d2c27ee4819f8fbdba7b7dc2a13ba299fb5d2ffdb4eba5be29577",
    },
    {
      name: "empty-string",
      input: "",
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      name: "null",
      input: null,
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      name: "undefined",
      input: undefined,
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      name: "cjk-unicode",
      input: "## 验收标准\r\n- [ ] 实现功能  \r\n- [ ] 测试覆盖\t\n\n  \n",
      expected: "b2d129bed172663a544d9d47936ec679fbe99542ca8c166331f331a9b3d47667",
    },
    {
      name: "large",
      input:
        Array.from(
          { length: 200 },
          (_, i) => `- [ ] task line number ${i} with some trailing whitespace   `,
        ).join("\r\n") + "\n\n",
      expected: "7c4dc0b270cd24a172607900913559cc7bb481d07708a7c41d78862d4704770d",
    },
  ];

  it.each(vectors)(
    "inline copy === module === pinned hash for vector: $name",
    ({ input, expected }) => {
      const fromModule = bodySha256(input);
      const fromInline = inlineBodySha256(input);
      // inline copy must equal the module implementation...
      expect(fromInline).toBe(fromModule);
      // ...and both must equal the pinned expected hash.
      expect(fromModule).toBe(expected);
      expect(fromInline).toBe(expected);
    },
  );
});

// Security invariants of the recorder YAML (WI-F0): the file is pure-API and pwn-safe.
// These greps fail closed if a future edit reintroduces a checkout, a PAT, or a REST
// re-fetch of the issue body (the TOCTOU the body-hash pin exists to close).
describe("recorder security invariants", () => {
  it("hashes the webhook-delivered issue body (payload.issue.body)", () => {
    expect(recorderText).toMatch(/payload\.issue\.body/);
  });

  it("does NOT re-fetch the issue body via REST (no issues.get / request(...issues...))", () => {
    expect(recorderText).not.toMatch(/issues\.get\b/);
    expect(recorderText).not.toMatch(/request\([^)]*issues/);
  });

  // Strip YAML/JS comment lines so the security-documentation that NAMES these
  // forbidden patterns ("no actions/checkout", "NEVER PAT_TOKEN") doesn't trip the
  // grep — we want to fail only on real USAGE, not on the invariant being documented.
  const codeOnly = recorderText
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && !t.startsWith("//");
    })
    .join("\n");

  it("does NOT use actions/checkout", () => {
    expect(codeOnly).not.toMatch(/actions\/checkout/);
  });

  it("does NOT reference PAT_TOKEN", () => {
    expect(codeOnly).not.toMatch(/PAT_TOKEN/);
  });

  it("pins actions/github-script to a 40-char commit SHA", () => {
    const m = recorderText.match(/actions\/github-script@([0-9a-f]+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/^[0-9a-f]{40}$/);
  });
});
