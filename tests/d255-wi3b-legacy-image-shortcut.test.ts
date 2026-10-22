// @vitest-environment node
import { expect, it } from "vitest";
import cases from "./fixtures/legacy-image-shortcut-cases.json";
import { resolveBindings } from "../src/commands/bindingConflicts";
import { normaliseStored } from "../src/commands/chord";
import type { Platform } from "../src/commands/commandTable.types";
import { collectionCases } from "./support/collectionCases";

for (const { platform, stored, expected } of collectionCases("legacy image shortcut parity", cases)) {
it(`D255-WI-3b TS binding parity: ${platform} saved ${stored}`, () => {
  const p = platform as Platform;
  const resolved = resolveBindings(p, 1, { formatImage: stored }).formatImage;
  if (expected === "<unassigned>") expect(resolved).toEqual({ kind: "unassigned" });
  else expect(resolved).toEqual({ kind: "bound", chord: normaliseStored(expected, p) });
});
}
