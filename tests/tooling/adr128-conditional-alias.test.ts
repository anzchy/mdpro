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
  it.each([
    'const maybe = plugin ? it : () => {}; maybe("lost", () => {});',
    'const check = it; if (plugin) check("lost", () => {});',
    'let register = it; if (!plugin) register = () => {}; register("lost", () => {});',
    'const first = describe; let second = first; if (!plugin) second = () => {}; second("lost", () => {});',
  ])("rejects conditional registration aliases: %s", (source) => {
    expect(findings(source), source).not.toEqual([]);
  });
  it("rejects generated namespace and chained guards", () => {
    for (let seed = 1; seed <= 32; seed++) {
      const name = `v${seed}`;
      const call = seed % 2 ? `${name}.it` : `${name}.describe`;
      const chain = seed % 4 < 2 ? `${call}.skipIf(false).each([1])` : `${call}.each([1]).runIf(true)`;
      const source = `import * as ${name} from "vitest"; if (plugin) ${chain}("lost", () => {});`;
      expect(findings(source), `seed ${seed}`).not.toEqual([]);
    }
  });
  it("rejects an early return in an aliased describe callback", () => {
    expect(findings('import { describe as suite, it } from "vitest"; suite("s", () => { if (!plugin) return; it("lost", () => {}); });')).not.toEqual([]);
  });
  it("rejects an early return in a namespace describe alias", () => {
    expect(findings('import * as v from "vitest"; const suite = v.describe; suite("s", () => { if (!plugin) return; it("lost", () => {}); });')).not.toEqual([]);
  });
});
