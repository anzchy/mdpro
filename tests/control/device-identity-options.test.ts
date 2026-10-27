// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script, no declaration file
import { parseIdentityOptions } from "../../scripts/device/identityOptions.mjs";

const bundle = "/tmp/测试 bundle/mdpro.app";
const expected = `0.3.5-dev@${"a".repeat(40)}`;

describe("device identity options", () => {
  it("resolves checkout release id when no override is given", async () => {
    const result = await parseIdentityOptions(["--bundle", bundle], { resolveDefault: async () => expected });
    expect(result).toMatchObject({ bundlePath: bundle, expectedReleaseId: expected, checkOnly: false });
  });

  it("explicit identity wins without asking the default resolver", async () => {
    const result = await parseIdentityOptions(["--bundle", bundle, "--expected-release-id", expected], {
      resolveDefault: async () => { throw new Error("should not run"); },
    });
    expect(result.expectedReleaseId).toBe(expected);
  });

  it("rejects malformed full-length IDs and bad arguments before launch", async () => {
    const bad = ["unknown", `0.3.5-dev@${"a".repeat(39)}`, `0.3.5-dev@${"A".repeat(40)}`,
      `0.3.5-dev@${"g".repeat(40)}`, `00.3.5-dev@${"a".repeat(40)}`,
      `0.3-dev@${"a".repeat(40)}`, `0.3.5+meta@${"a".repeat(40)}`,
      `0.3.5-@${"a".repeat(40)}`, ` ${expected}`];
    for (const id of bad) {
      await expect(parseIdentityOptions(["--bundle", bundle, "--expected-release-id", id], { resolveDefault: async () => expected })).rejects.toThrow();
    }
    for (const args of [["--bundle", "relative.app"], ["--bundle", bundle, "--unknown"],
      ["--bundle", bundle, "--bundle", bundle]]) {
      await expect(parseIdentityOptions(args, { resolveDefault: async () => expected })).rejects.toThrow();
    }
  });
});
