// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runNative } from "./windows-driver-native-harness";

describe("D337 native window proof cleanup", () => {
  it("removes its owned window property even when initial post-pin validation rejects the window", async () => {
    const result = await runNative([{ op: "focus" }], { rectChangesAfterPin: true });
    expect(result.status, result.stderr).toBe(1);
    expect(result.trace.filter((v) => v.startsWith("property:"))).toEqual(["property:pin", "property:remove"]);
    expect(result.trace.filter((v) => /^(logical|mouse|scan):/.test(v))).toEqual([]);
    expect(result.log.join(" ")).toContain("IDENTITY_NATIVE_RECT_CHANGED");
  }, 15000);
  it("a failed native property removal fails cleanup and the transaction", async () => {
    const result = await runNative([{ op: "focus" }], { failRemoveProp: true });
    expect(result.status, result.stderr).toBe(1);
    expect(result.log.join(" ")).toContain("IDENTITY_WINDOW_UNPIN_FAILED");
    const value = JSON.parse(result.log.find((v) => v.startsWith("OUTCOME "))!.slice(8));
    expect(value).toMatchObject({ status: "failed", cleanup: "failed", inputOutcome: "none", heldInput: "released" });
  }, 15000);
});
