// @vitest-environment node
/**
 * D284-WI-1: the locked ammonia is out of RUSTSEC-2026-0373's range.
 *
 * ammonia 4.1.7 matched CSS `url(` case-sensitively. The fix is in 4.1.8 on
 * the 4.1 line and in 4.2.4 on the 4.2 line, so 4.2.0–4.2.3 are still
 * affected. mdpro never reaches the matcher (sanitize_html keeps the default
 * builder's `style_properties: None` and allows no `style` attribute; trace in
 * the D284 row), so this pin keeps `cargo audit` green, nothing more.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const lock = fs.readFileSync(path.resolve(__dirname, "../../src-tauri/Cargo.lock"), "utf8");

function lockedVersions(name: string): string[] {
  return lock
    .split("[[package]]")
    .slice(1)
    .filter((body) => new RegExp(`^name = "${name}"$`, "m").test(body))
    .map((body) => /^version = "([^"]+)"$/m.exec(body)?.[1] ?? "");
}

/** True when `v` is a release RUSTSEC-2026-0373 lists as fixed. */
function isFixed(v: string): boolean {
  const [major, minor, patch] = v.split(".").map(Number);
  if (major !== 4) return major > 4;
  if (minor === 1) return patch >= 8;
  if (minor === 2) return patch >= 4;
  return minor > 2;
}

describe("D284 the locked ammonia carries the CSS url( fix", () => {
  it("a1 the range check matches the advisory's patched list", () => {
    const cases = ["4.1.7", "4.1.8", "4.2.0", "4.2.3", "4.2.4", "4.3.0", "5.0.0", "3.9.9"];
    expect(cases.map((v) => [v, isFixed(v)])).toEqual([
      ["4.1.7", false],
      ["4.1.8", true],
      ["4.2.0", false],
      ["4.2.3", false],
      ["4.2.4", true],
      ["4.3.0", true],
      ["5.0.0", true],
      ["3.9.9", false],
    ]);
  });

  it("a2 Cargo.lock has exactly one ammonia, and it is a fixed release", () => {
    const versions = lockedVersions("ammonia");
    expect(versions.length).toBe(1);
    expect({ version: versions[0], fixed: isFixed(versions[0] ?? "") }).toEqual({ version: versions[0], fixed: true });
  });
});
