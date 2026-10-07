// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useUpdaterStore } from "../src/stores/updaterStore";

describe("updaterStore", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ cachedResult: null });
  });

  it("caches up-to-date state", () => {
    const { setCachedResult } = useUpdaterStore.getState();
    setCachedResult({ phase: "up-to-date" });
    expect(useUpdaterStore.getState().cachedResult).toEqual({
      phase: "up-to-date",
    });
  });

  it("caches error state", () => {
    const { setCachedResult } = useUpdaterStore.getState();
    setCachedResult({ phase: "error", message: "Network failure" });
    expect(useUpdaterStore.getState().cachedResult).toEqual({
      phase: "error",
      message: "Network failure",
    });
  });

  it("caches updates-disabled state", () => {
    const { setCachedResult } = useUpdaterStore.getState();
    setCachedResult({ phase: "updates-disabled" });
    expect(useUpdaterStore.getState().cachedResult).toEqual({
      phase: "updates-disabled",
    });
  });

  it("clears cache", () => {
    const { setCachedResult, clearCache } = useUpdaterStore.getState();
    setCachedResult({ phase: "up-to-date" });
    clearCache();
    expect(useUpdaterStore.getState().cachedResult).toBeNull();
  });

  it("starts with null cache", () => {
    expect(useUpdaterStore.getState().cachedResult).toBeNull();
  });
});
