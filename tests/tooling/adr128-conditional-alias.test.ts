// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error -- repository tooling is plain ESM without a declaration file
import { checkConditionalTests } from "../../scripts/lint/conditional-tests.mjs";

const findings = (source: string) => checkConditionalTests(source, "tests/generated.test.ts") as string[];
describe("ADR128 collected registration under aliases", () => {
  it("rejects a named import alias inside an if guard", () => {
    expect(findings('import { it as check } from "vitest"; if (plugin) check("case", () => {});').length).toBeGreaterThan(0);
  });
  it("rejects parenthesized conditional data for each", () => {
    expect(findings('it.each((plugin ? cases : []))("case %s", () => {});').length).toBeGreaterThan(0);
  });
  it("preserves collected skipIf registration through an alias", () => {
    expect(findings('import { it as check } from "vitest"; check.skipIf(!plugin)("case", () => {});')).toEqual([]);
  });
  it("rejects generated alias and guard combinations over a bounded domain", () => {
    for (let seed = 1; seed <= 64; seed++) {
      const alias = `case${seed.toString(36)}`;
      const call = `${alias}("case", () => {})`;
      const gated = seed % 4 === 0 ? `if (plugin) { ${call}; }` : seed % 4 === 1 ? `plugin && ${call};` : seed % 4 === 2 ? `plugin ? ${call} : undefined;` : `${alias}.each((plugin ? cases : []))("case %s", () => {});`;
      expect(findings(`import { it as ${alias} } from "vitest"; ${gated}`).length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});
