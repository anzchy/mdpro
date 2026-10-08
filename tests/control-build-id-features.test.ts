// @vitest-environment node
/**
 * WI-19 (ADR-0047 fix round): a feature name may not start with `-`.
 * Matrix: `.claude/tdd-guardian/tests-20261002-201520.md`, unit WI-3, T11.
 * Split from `control-build-id.test.ts`, which is already past 300 lines.
 */
import { describe, expect, it } from "vitest";
import {
  BuildIdInputError,
  computeBuildId,
  isValidFeatureName,
  // @ts-expect-error -- plain ESM script, no .d.ts by design
} from "../scripts/control/buildId.mjs";

const BASE = {
  sourceTree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sourceTreeExcludes: [".claude/", "docs/", "**/*.tsbuildinfo"],
  profile: "release",
  features: [] as string[],
  sidecarSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

describe("computeBuildId feature names (WI-19)", () => {
  it.each(["-x", "--x", "-"])("WI-3/T11 feature %j throws BuildIdInputError naming features", (f) => {
    expect(() => computeBuildId({ ...BASE, features: [f] })).toThrow(BuildIdInputError);
    expect(() => computeBuildId({ ...BASE, features: [f] })).toThrow(/features/);
  });

  it("WI-3/T11 isValidFeatureName refuses a leading - and keeps - and _ elsewhere", () => {
    const list = ["-x", "--x", "-", "x-", "a-b", "_x"];
    expect(list.map((f) => isValidFeatureName(f))).toEqual([false, false, false, true, true, true]);
  });
});
