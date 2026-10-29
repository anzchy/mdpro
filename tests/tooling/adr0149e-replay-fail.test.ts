// @vitest-environment node
/**
 * ADR0149E-4b (AC-4, ADR-0145 d2, ADR-0149 d2): the replay fails, naming the id, when any
 * recorded id fails elsewhere or with another message at base, passes, skips or
 * disappears, fails at head, or was not an assertion at RED; and it refuses an entry
 * whose pin ref is missing or moved.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReceiptRepo, pluginVersion, type ReceiptRepo } from "./adr0149eRepo";

vi.setConfig({ testTimeout: 240_000 });
let repo: ReceiptRepo;
beforeEach(async (context) => { repo = await createReceiptRepo(context.signal); });
afterEach(async () => { await repo.close(); });

async function replay() {
  const result = await repo.entry("replay", "--id", "A");
  const path = /^evidence: (.+)$/m.exec(result.output)?.[1];
  const evidence = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  return { ...result, result: evidence?.replay?.result as string | undefined, reasons: (evidence?.replay?.reasons ?? []) as string[] };
}
const header = 'import { expect, it } from "vitest";\nimport * as calc from "../src/calc.mjs";\n';

/** Base production `base`, a branch commit before the RED to `red`, the RED on `spec`, then head `head` (and `headSpec`). */
async function scenario(o: { base: string; red: string; spec: string; head: string; headSpec?: string }) {
  repo.write("src/calc.mjs", o.base);
  await repo.commit("base");
  await repo.git("branch", "-f", "master", "HEAD");
  repo.write("src/calc.mjs", o.red);
  repo.write("tests/calc.test.ts", o.spec);
  await repo.commit("red");
  const recorded = await repo.entry("record", "--id", "A", "--test", "tests/calc.test.ts");
  expect(recorded.status, recorded.output).toBe(0);
  repo.write("src/calc.mjs", o.head);
  if (o.headSpec) repo.write("tests/calc.test.ts", o.headSpec);
  await repo.commit("head");
  return replay();
}
const id = (title: string) => JSON.stringify(["tests/calc.test.ts", title]);

describe.skipIf(!pluginVersion)("ADR0149E-4b replay fails closed", () => {
  it("fails when the base fails at another line with another message", async () => {
    const r = await scenario({
      base: "export const flag = () => false;\nexport const add = (a, b) => a - b;\n",
      red: "export const flag = () => true;\nexport const add = (a, b) => a - b;\n",
      spec: `${header}it("x", () => {\n  expect(calc.flag()).toBe(true);\n  expect(calc.add(1, 1)).toBe(2);\n});\n`,
      head: "export const flag = () => true;\nexport const add = (a, b) => a + b;\n",
    });
    expect(r.status).not.toBe(0);
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("x"));
  });

  it("fails when the base fails with the RED message on another line while the RED line still maps", async () => {
    const r = await scenario({
      base: "export const a = () => 1;\nexport const b = () => 1;\n",
      red: "export const a = () => 2;\nexport const b = () => 1;\n",
      spec: `${header}it("x", () => {\n  expect(calc.a()).toBe(2);\n\n  expect(calc.b()).toBe(2);\n});\n`,
      head: "export const a = () => 2;\nexport const b = () => 2;\n",
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("x"));
  });

  it("fails when the head edited the RED line in place and the base message differs", async () => {
    const r = await scenario({
      base: "export const v = () => 1;\n",
      red: "export const v = () => 1;\n",
      spec: `${header}it("x", () => {\n  expect(calc.v()).toBe(5);\n});\n`,
      head: "export const v = () => 5;\n",
      headSpec: `${header}it("x", () => {\n  expect(calc.v()).toBeGreaterThan(1);\n});\n`,
    });
    expect(r.result).toBe("failed");
  });

  it("fails when an id passes at base", async () => {
    const r = await scenario({
      base: "export const mul = (a, b) => a * b;\n",
      red: "export const mul = (a, b) => a + b;\n",
      spec: `${header}it("mul", () => {\n  expect(calc.mul(2, 3)).toBe(6);\n});\n`,
      head: "export const mul = (a, b) => a * b;\n",
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toMatch(/passed at base/);
  });

  it("fails when only one of two ids meets the condition, naming the other", async () => {
    const r = await scenario({
      base: "export const mul = (a, b) => a * b;\nexport const add = (a, b) => a - b;\n",
      red: "export const mul = (a, b) => a + b;\nexport const add = (a, b) => a - b;\n",
      spec: `${header}it("mul", () => {\n  expect(calc.mul(2, 3)).toBe(6);\n});\nit("add", () => {\n  expect(calc.add(1, 1)).toBe(2);\n});\n`,
      head: "export const mul = (a, b) => a * b;\nexport const add = (a, b) => a + b;\n",
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("mul"));
    expect(r.reasons.join("\n")).not.toContain(id("add"));
  });

  it("fails when an id is skipped or removed at head", async () => {
    const r = await scenario({
      base: "export const v = () => 1;\n",
      red: "export const v = () => 1;\n",
      spec: `${header}it("x", () => {\n  expect(calc.v()).toBe(2);\n});\n`,
      head: "export const v = () => 2;\n",
      headSpec: `${header}it.skip("x", () => {\n  expect(calc.v()).toBe(2);\n});\n`,
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toMatch(/skipped|disappeared/);
  });

  it("fails when the id also fails at head", async () => {
    const r = await scenario({ base: "export const v = () => 1;\n", red: "export const v = () => 1;\n", spec: `${header}it("x", () => {\n  expect(calc.v()).toBe(2);\n});\n`, head: "export const v = () => 3;\n" });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toMatch(/at head/);
  });

  it("fails closed when the base cannot collect the test, or the base kind is not an assertion", async () => {
    const r = await scenario({
      base: "export const v = () => 1;\n",
      red: "export const v = () => 1;\nexport const f = () => ({ x: 1 });\n",
      spec: `${header}it("x", () => {\n  expect(calc.f().x).toBe(2);\n});\n`,
      head: "export const v = () => 1;\nexport const f = () => ({ x: 2 });\n",
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("x"));
  });

  it("fails closed when the test imports a module the branch added", async () => {
    repo.write("src/calc.mjs", "export const v = () => 1;\n");
    await repo.commit("base");
    await repo.git("branch", "-f", "master", "HEAD");
    repo.write("src/new.mjs", "export const n = () => 1;\n");
    repo.write("tests/calc.test.ts", 'import { expect, it } from "vitest";\nimport { n } from "../src/new.mjs";\nit("x", () => {\n  expect(n()).toBe(2);\n});\n');
    await repo.commit("red");
    expect((await repo.entry("record", "--id", "A", "--test", "tests/calc.test.ts")).status).toBe(0);
    repo.write("src/new.mjs", "export const n = () => 2;\n");
    await repo.commit("head");
    const r = await replay();
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("x"));
  });

  it("fails closed on a RED with no assertion id, and on a mixed RED set, naming the panic id", async () => {
    const r = await scenario({
      base: "export const v = () => 1;\n",
      red: "export const v = () => 1;\n",
      spec: `${header}it("assert", () => {\n  expect(calc.v()).toBe(2);\n});\nit("throws", () => {\n  if (calc.v() !== 2) throw new TypeError("v is wrong");\n});\n`,
      head: "export const v = () => 2;\n",
    });
    expect(r.result).toBe("failed");
    expect(r.reasons.join("\n")).toContain(id("throws"));
    expect(r.reasons.join("\n")).toMatch(/panic/);
  });

  it("refuses an entry whose pin ref is missing or moved", async () => {
    await scenario({ base: "export const v = () => 1;\n", red: "export const v = () => 1;\n", spec: `${header}it("x", () => {\n  expect(calc.v()).toBe(2);\n});\n`, head: "export const v = () => 2;\n" });
    const ref = repo.evidence().entries.A.tests_tree.ref as string;
    const tree = repo.evidence().entries.A.tests_tree.tree as string;
    const other = (await repo.git("rev-parse", "HEAD^{tree}")).stdout.trim();
    await repo.git("update-ref", ref, other);
    expect((await repo.entry("replay", "--id", "A")).status).toBe(64);
    await repo.git("update-ref", "-d", ref);
    const missing = await repo.entry("replay", "--id", "A");
    expect(missing.status).toBe(64);
    expect(missing.output).toMatch(/pin/i);
    await repo.git("update-ref", ref, tree);
  });
});
