// @vitest-environment node
import { describe, expect, it } from "vitest";

const RELEASE = `0.3.5-dev@${"a".repeat(40)}`;
const bundle = "/tmp/测试 build/mdpro.app";
const pid = 4242;

async function evaluate(facts: unknown) {
  // @ts-expect-error -- plain ESM script, no declaration file
  const module = await import("../../scripts/device/identityChecks.mjs");
  return module.evaluateIdentity(facts);
}

function goodFacts() {
  return {
    bundlePath: bundle,
    bundleExists: true,
    expectedReleaseId: RELEASE,
    processes: [{ pid, exe: `${bundle}/Contents/MacOS/tauri-app` }],
    records: [
      { event: "window.open", status: "success", context: { pid } },
      { event: "app.ready", status: "success", context: { pid, releaseId: RELEASE } },
    ],
  };
}

describe("device identity decision", () => {
  it("reports four passes for one bundled process and its startup events", async () => {
    const result = await evaluate(goodFacts());
    expect(result).toEqual({
      lines: ["[PASS] bundle", "[PASS] process", "[PASS] releaseId", "[PASS] window"],
      exit: 0,
    });
  });

  it("keeps a Unicode and spaced bundle path inside the bundle boundary", async () => {
    const result = await evaluate(goodFacts());
    expect(result.lines[1]).toBe("[PASS] process");
  });
});
