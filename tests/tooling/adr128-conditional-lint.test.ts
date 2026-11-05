// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr128-lint-"));
const script = path.resolve("scripts/lint/conditional-tests.mjs");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const batched = new Map<string, { status: number; stderr: string }>();

// The original it.each tables are the single source of fixture bytes. Feed them to one real CLI
// invocation, then attribute each diagnostic to its own file rather than using the batch exit code.
function batchCases() {
  const file = fileURLToPath(import.meta.url);
  const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const cases: Array<{ source: string; rejects: boolean }> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isCallExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === "it" &&
        node.expression.expression.name.text === "each" && ts.isArrayLiteralExpression(node.expression.arguments[0])) {
      const title = node.arguments[0];
      const rejects = ts.isStringLiteral(title) && title.text.startsWith("rejects ");
      for (const value of node.expression.arguments[0].elements) {
        if (!ts.isStringLiteral(value)) throw new Error("ADR128 batch fixture must be a string literal");
        cases.push({ source: value.text, rejects });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return cases;
}

beforeAll(() => {
  const cases = batchCases();
  const files = cases.map(({ source }, index) => {
    const file = path.join(root, `batch-${index}.test.ts`);
    fs.writeFileSync(file, source);
    return file;
  });
  const run = spawnSync(process.execPath, [script, ...files], { encoding: "utf8" });
  if (run.error || run.signal || ![0, 1].includes(run.status ?? -1)) throw new Error(`ADR128 batch CLI failed: ${run.error ?? run.stderr}`);
  const diagnostics = new Map(files.map((file) => [file, [] as string[]]));
  for (const line of run.stderr.split("\n").filter(Boolean)) {
    const file = files.find((candidate) => line.startsWith(`${candidate}:`));
    if (!file) throw new Error(`ADR128 unassigned diagnostic: ${line}`);
    diagnostics.get(file)!.push(line);
  }
  const diagnosed = files.filter((file) => diagnostics.get(file)!.length > 0);
  const expected = files.filter((_, index) => cases[index].rejects);
  expect(diagnosed).toEqual(expected);
  for (const [index, { source }] of cases.entries()) {
    const lines = diagnostics.get(files[index])!;
    batched.set(source, { status: lines.length ? 1 : 0, stderr: lines.join("\n") });
  }
});

function check(source: string) {
  const cached = batched.get(source);
  if (cached) return cached;
  const file = path.join(root, "case.test.ts");
  fs.writeFileSync(file, source);
  return spawnSync(process.execPath, [script, file], { encoding: "utf8" });
}
describe("ADR128 conditional registration lint", () => {
  it.each([
    "if (flag) it('x', () => {});",
    "if (flag) { describe('x', () => {}); }",
    "if (flag) { if (other) test('x', () => {}); }",
    "flag && it('x', () => {});",
    "flag ? it('x', () => {}) : undefined;",
    "it.each(flag ? cases : [])('x', () => {});",
    "describe.each(flag ? cases : [])('x', () => {});",
  ])("rejects disappearing registration: %s", (source) => {
    expect(check(source).status).not.toBe(0);
  });
  it("accepts collected skipIf, runIf and ctx.skip gates", () => {
    expect(check("it.skipIf(!flag)('x', ctx => { ctx.skip(); }); it.runIf(flag)('y', () => {});").status).toBe(0);
  });
  it("accepts conditional behavior inside a registered test", () => {
    expect(check("it('x', () => { if (flag) expect(1).toBe(1); });").status).toBe(0);
  });
  it.each([
    "describe('suite', () => { if (!plugin) return; it('lost', () => {}); });",
    "describe('suite', () => { if (!plugin) { return; } it('lost', () => {}); });",
    "import * as v from 'vitest'; if (plugin) v.it('lost', () => {});",
    "import * as v from 'vitest'; if (plugin) v.describe('lost', () => {});",
    "if (plugin) it.skipIf(false).each([1])('lost', () => {});",
    "if (plugin) describe.each([1]).skipIf(false)('lost', () => {});",
    "const rows = plugin ? [1] : []; it.each(rows)('lost', () => {});",
    "let rows = [1]; if (!plugin) rows = []; it.each(rows)('lost', () => {});",
    "function register() { it('lost', () => {}); } if (plugin) register();",
    "function register() { it('lost', () => {}); } const maybe = register; if (plugin) maybe();",
    "for (const row of rows) it('lost', () => {});",
    "for (let i = 0; i < rows.length; i++) it('lost', () => {});",
    "while (rows.length) it('lost', () => {});",
    "rows.forEach(() => it('lost', () => {}));",
  ])("rejects audit vanishing form: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/conditional|unresolved|loop|registration/);
  });
  it.each([
    "it.skipIf(!plugin)('collected', () => {});",
    "it.runIf(plugin)('collected', () => {});",
    "it('collected', ctx => { if (!plugin) ctx.skip(); });",
    "it.each([1, 2])('collected %s', () => {});",
    "import * as v from 'vitest'; v.it('collected', () => {});",
    "it('collected', () => { if (plugin) expect(1).toBe(1); });",
    "function pure() { return 1; } if (plugin) pure(); it('collected', () => {});",
  ])("keeps collected registration: %s", (source) => {
    expect(check(source).status, source).toBe(0);
  });
  it.each([
    "const rows = getRows(); it.each(rows)('lost', () => {});",
    "const rows = [1]; for (let i = 1; i < rows.length; i++) it('lost', () => {});",
    "function register() { if (!plugin) return; it('lost', () => {}); } register();",
  ])("rejects reviewer collection bypass: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it.each([
    "import { registerCases } from './helper'; if (plugin) registerCases();",
    "const rows = [1]; rows.pop(); for (const row of rows) it('lost', () => {});",
    "const rows = [1]; rows.splice(0); it.each(rows)('lost', () => {});",
  ])("rejects unresolved helper or mutated case data: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it.each([
    "const register = () => { if (!plugin) return; it('lost', () => {}); }; register();",
    "import * as helpers from './missing-helper'; if (plugin) helpers.registerCases();",
    "const rows = [1]; const alias = rows; alias.pop(); it.each(rows)('lost', () => {});",
  ])("rejects second-review registration bypass: %s", (source) => {
    expect(check(source).status, source).not.toBe(0);
  });
  it("rejects a registration helper through a re-export barrel", () => {
    fs.writeFileSync(path.join(root, "registration-helper.ts"), "import { it } from 'vitest'; export function registerCases() { it('lost', () => {}); }");
    fs.writeFileSync(path.join(root, "barrel.ts"), "export { registerCases } from './registration-helper';");
    expect(check("import { registerCases } from './barrel'; if (plugin) registerCases();").status).not.toBe(0);
  });
  it.each([
    "function register(){ it('lost',()=>{}); } describe('suite',()=>{ if(!plugin) return; register(); });",
    "const rows=getRows(); function register(){ it('lost',()=>{}); } rows.forEach(register);",
    "const rows=getRows(); function unrelated(){ const rows=[1]; } for(const row of rows) it('lost',()=>{});",
    "for(const row of [1]){ if(!plugin) continue; it('lost',()=>{}); }",
  ])("rejects Codex round-two vanishing form: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/registration|loop|return|continue/);
  });
  it("resolves nonempty array proofs through lexical binding under both shadowing orders", () => {
    for (const outer of ["rows", "unrelatedRows"]) {
      const runtimeInner = `const ${outer}=[1]; describe('suite',()=>{ const rows=getRows(); for(const row of rows) it('lost',()=>{}); });`;
      const literalInner = `const ${outer}=getRows(); describe('suite',()=>{ const rows=[1]; for(const row of rows) it('collected',()=>{}); });`;
      expect(check(runtimeInner).status, runtimeInner).not.toBe(0);
      expect(check(literalInner).status, literalInner).toBe(0);
    }
  });
  it("keeps a proven nonempty loop and unconditional helper collected", () => {
    expect(check("const rows=[1]; for(const row of rows) it('collected',()=>{});").status).toBe(0);
    expect(check("function register(){ it('collected',()=>{}); } describe('suite',()=>{ register(); });").status).toBe(0);
  });
  it.each([
    "import {suite,it} from 'vitest'; suite('s',()=>{ if(!plugin) return; it('lost',()=>{}); });",
    "if(plugin) it.concurrent('lost',()=>{});",
    "if(plugin) it.sequential('lost',()=>{});",
    "if(plugin) it.only('lost',()=>{});",
    "if(plugin) it.fails('lost',()=>{});",
    "if(plugin) it.shuffle('lost',()=>{});",
    "if(plugin) describe.shuffle('lost',()=>{});",
    "const t=test.extend({}); if(plugin)t('lost',()=>{});",
    "const t=it.extend({}); if(plugin)t('lost',()=>{});",
    "import * as v from 'vitest'; const {it:t}=v; if(plugin)t('lost',()=>{});",
    "const {it:t}=await import('vitest'); if(plugin)t('lost',()=>{});",
    "const api={it}; if(plugin)api.it('lost',()=>{});",
    "if(plugin)it.call(undefined,'lost',()=>{});",
    "if(plugin)it.apply(undefined,['lost',()=>{}]);",
    "function register(fn){fn('lost',()=>{});} if(plugin)register(it);",
    "if(plugin)[()=>it('lost',()=>{})][0]();",
    "if(plugin)(0,it)('lost',()=>{});",
    "try{if(!plugin)throw 0;it('lost',()=>{});}catch{}",
    "if(plugin)it.mystery('lost',()=>{});",
  ])("rejects Fable round-two registration form: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/registration|conditional|unknown|unsupported|helper/);
  });
  it.each([
    "if(plugin)it['concurrent']('lost',()=>{});",
    "if(plugin)it['call'](undefined,'lost',()=>{});",
    "import * as v from 'vitest'; if(plugin)v['it']['concurrent']('lost',()=>{});",
    "if(plugin)it['mystery']('lost',()=>{});",
    "import {it} from 'vitest'; it('visible',()=>{}); const register=it.bind(undefined); if(plugin)register('lost',()=>{});",
    "import {it} from 'vitest'; it('visible',()=>{}); const register=it['bind'](undefined); if(plugin)register('lost',()=>{});",
    "it.mystery('lost',()=>{});",
  ])("rejects bracket and unconditional unknown properties: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/registration|unknown|unsupported/);
  });
  it.each([
    "const rows=[1]; describe('suite',()=>{ const {rows}={rows:[]}; for(const row of rows) it('lost',()=>{}); });",
    "const rows=[1]; describe('suite',()=>{ const [rows]=[[]]; for(const row of rows) it('lost',()=>{}); });",
  ])("rejects a destructured binding that shadows an outer nonempty proof: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/registration|loop/);
  });
  it("keeps destructuring rejection when the unrelated outer binding is renamed", () => {
    for (const inner of ["const {rows}={rows:[]};", "const [rows]=[[]];"]) {
      const source = `const unrelatedRows=[1]; describe('suite',()=>{ ${inner} for(const row of rows) it('lost',()=>{}); });`;
      const result = check(source);
      expect(result.status, source).not.toBe(0);
      expect(result.stderr, source).toMatch(/registration|loop/);
    }
  });
  it("applies the same data gate to dotted and bracket each access", () => {
    for (const access of [".each", "['each']"]) {
      expect(check(`it${access}([])('lost',()=>{});`).status, access).not.toBe(0);
      expect(check(`const rows=getRows(); it${access}(rows)('lost',()=>{});`).status, access).not.toBe(0);
      expect(check(`it${access}([1])('collected',()=>{});`).status, access).toBe(0);
    }
  });
  it.each([
    "const register=(it as typeof it).bind(undefined); if(plugin)register('lost',()=>{});",
    "const register=it!.bind(undefined); if(plugin)register('lost',()=>{});",
  ])("rejects TypeScript-wrapped unknown registration property: %s", (source) => {
    const result = check(source);
    expect(result.status, source).not.toBe(0);
    expect(result.stderr, source).toMatch(/registration|unknown/);
  });
});
