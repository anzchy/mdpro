// @vitest-environment node
/**
 * ADR47-WI009-1: the `control-channel` Cargo feature and its CI check.
 *
 * The feature is off by default and implies `verify-run` (plan WI-009
 * acceptance 1), so a default or release build has no control channel. The
 * rust-test job checks the crate with the feature on after `cargo test`, which
 * on ubuntu-latest proves the non-macOS arm compiles. It rides inside
 * rust-test, so ci-gate's `needs` is unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { job, list, steps, stepRun } from "../support/workflowBlocks";

const ROOT = path.resolve(__dirname, "..", "..");
const CI = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const CARGO = fs.readFileSync(path.join(ROOT, "src-tauri", "Cargo.toml"), "utf8");
const CHECK = "cargo check --manifest-path src-tauri/Cargo.toml --features control-channel";

/** The `[features]` table's body, up to the next table header. */
function featuresTable(toml: string): string {
  const m = /^\[features\]\s*$([\s\S]*?)(?=^\[)/m.exec(toml);
  return m ? m[1] : "";
}

/** One feature's value list from `[features]`, or null when it is absent. */
function feature(toml: string, name: string): string[] | null {
  const m = new RegExp(`^${name}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(featuresTable(toml));
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s !== "");
}

describe("ADR47-WI009-1 control-channel feature", () => {
  it("defines control-channel as implying verify-run", () => {
    expect(feature(CARGO, "control-channel")).toEqual(["verify-run"]);
  });

  it("keeps it out of the default feature set", () => {
    expect(feature(CARGO, "default") ?? []).not.toContain("control-channel");
  });
});

describe("ADR47-WI009-1 rust-test checks the feature build", () => {
  const runs = steps(job(CI, "rust-test"))
    .map(stepRun)
    .filter((r): r is string => r !== null);

  it("runs the control-channel check after cargo test", () => {
    const test = runs.indexOf("cargo test --manifest-path src-tauri/Cargo.toml");
    const check = runs.indexOf(CHECK);
    expect(test).toBeGreaterThanOrEqual(0);
    expect(check).toBeGreaterThan(test);
  });

  it("leaves ci-gate's needs unchanged", () => {
    expect((list(job(CI, "ci-gate"), "needs") ?? []).sort()).toEqual(["frontend", "prose-checks", "rust-test", "scope"]);
  });
});
