// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInventory, profileFor } from "../../scripts/ci/compare-report.mjs";

const ROOT = resolve(__dirname, "../..");
const inventory = JSON.parse(readFileSync(resolve(ROOT, "tests/ci-inventory.json"), "utf8"));
const accepted = new Set(["plugin", "hook-token", "macos", "rustfmt", "codex-cli"]);
const unknown = (items: Array<{ prerequisite: string }>) => items.map((item) => item.prerequisite).filter((tag) => !accepted.has(tag));

describe("GH607 platform prerequisite declarations", () => {
  it("keeps every inventory tag in the comparator and runner vocabulary", () => {
    expect(unknown(inventory.tests)).toEqual([]);
    expect(parseInventory(inventory)).toEqual(inventory);
    expect(profileFor("macos+rustfmt+codex-cli")).toEqual(new Set(["macos", "rustfmt", "codex-cli"]));
  });

  it("rejects an unknown synthetic tag while preserving the original inventory", () => {
    const changed = { ...inventory, tests: [{ ...inventory.tests[0], prerequisite: "linux-magic" }, ...inventory.tests.slice(1)] };
    expect(unknown(changed.tests)).toEqual(["linux-magic"]);
    expect(() => parseInventory(changed)).toThrow("Malformed inventory test");
    expect(unknown(inventory.tests)).toEqual([]);
  });

  it("requires macOS declarations without excluding supported Linux behavior", () => {
    const rule = readFileSync(resolve(ROOT, ".claude/rules/60-review-checklist.md"), "utf8");
    const line = rule.split("\n").find((part) => part.includes("macOS-only"));
    expect(line).toBe("- [ ] macOS-only Vitest inventory `prerequisite: macos`+skipIf; Rust `cfg(target_os)`; no ubuntu tests.");
  });
});
