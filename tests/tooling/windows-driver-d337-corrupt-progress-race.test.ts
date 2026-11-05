// @vitest-environment node
import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { supervisorFixture } from "./windows-driver-native-supervisor-harness";

const outcome = (lines: string[]) => JSON.parse(lines.findLast((line) => line.startsWith("OUTCOME "))!.slice(8));
const exists = async (file: string) => access(file).then(() => true, () => false);

describe("D337 corrupt progress fixture race", () => {
  it("never retains a valid progress state before the corrupt write", async () => {
    const fixture = await supervisorFixture("corrupt-progress", { env: { TEST_CORRUPT_GAP_MS: "1500" } });
    const result = await fixture.start().result;
    expect(result.status).not.toBe(0);
    expect(outcome(result.lines)).toMatchObject({ inputOutcome: "unknown", heldInput: "uncertain" });
    expect(await exists(path.join(fixture.dir, "native-session-blocked.json"))).toBe(true);
  }, 20000);
});
