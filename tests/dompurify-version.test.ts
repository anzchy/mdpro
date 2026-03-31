/**
 * Regression test for issue #44
 * Ensures DOMPurify is pinned to >=3.3.2 to avoid two production XSS CVEs:
 *   GHSA-h8r8-wccr-v5f2 (improper sanitization)
 *   GHSA-v2wj-7wpq-c8vv (mutation-XSS bypass)
 * Both are patched in 3.3.2+.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const resolvedPkg = JSON.parse(
  readFileSync(resolve(root, "node_modules/dompurify/package.json"), "utf-8")
);

/**
 * Compare two semver strings. Returns true if `a >= b`.
 * Only works on canonical `X.Y.Z` strings — not range expressions.
 */
function semverGte(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) throw new Error(`Not a canonical version: ${v}`);
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  };
  const [aMa, aMi, aPa] = parse(a);
  const [bMa, bMi, bPa] = parse(b);
  return (
    aMa > bMa ||
    (aMa === bMa && (aMi > bMi || (aMi === bMi && aPa >= bPa)))
  );
}

/**
 * Extract the minimum version a constraint allows.
 * Accepts standard npm forms: ^X.Y.Z, ~X.Y.Z, >=X.Y.Z, X.Y.Z
 * Rejects downward constraints (<X.Y.Z, <=X.Y.Z) and range syntax.
 */
function minAllowedVersion(constraint: string): string {
  // Reject explicitly downward-only constraints
  if (/^<[^=]/.test(constraint) || /^<=/.test(constraint)) {
    throw new Error(`Constraint allows vulnerable versions: ${constraint}`);
  }
  // Reject range syntax (spaces, ||, hyphens between versions)
  if (/\s/.test(constraint) || constraint.includes("||")) {
    throw new Error(`Range syntax not supported in this test: ${constraint}`);
  }
  // Strip leading ^, ~, >=, >
  const bare = constraint.replace(/^[\^~]|^>=?/, "");
  if (!/^\d+\.\d+\.\d+$/.test(bare)) {
    throw new Error(`Cannot extract minimum version from: ${constraint}`);
  }
  return bare;
}

describe("DOMPurify dependency security", () => {
  it("package.json constraint floor must be >=3.3.2", () => {
    const constraint: string = pkg.dependencies?.dompurify ?? "";
    expect(constraint).toBeTruthy();
    const floor = minAllowedVersion(constraint);
    expect(semverGte(floor, "3.3.2")).toBe(true);
  });

  it("package.json constraint must not allow 3.2.x (vulnerable range)", () => {
    const constraint: string = pkg.dependencies?.dompurify ?? "";
    expect(constraint).not.toMatch(/\^3\.2\./);
    expect(constraint).not.toMatch(/~3\.2\./);
    // bare 3.2.x
    expect(constraint).not.toMatch(/^3\.2\./);
  });

  it("resolved installed version must be >=3.3.2", () => {
    const version: string = resolvedPkg.version ?? "";
    expect(version).toBeTruthy();
    expect(semverGte(version, "3.3.2")).toBe(true);
  });
});
