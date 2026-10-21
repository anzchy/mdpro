#!/usr/bin/env node
/** Purpose: Keep prerequisite-gated tests collected and reject unapproved worker-blocking child calls. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const syncNames = new Set(["spawnSync", "execSync", "execFileSync"]);
const exceptionPath = path.resolve("scripts/lint/d302-sync-exceptions.json");

function checkSyncChildren(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Set(), namespaces = new Set(), findings = [];
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !["node:child_process", "child_process"].includes(statement.moduleSpecifier.text)) continue;
    if (statement.importClause?.name) namespaces.add(statement.importClause.name.text);
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (syncNames.has(item.propertyName?.text ?? item.name.text)) aliases.add(item.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if ((ts.isIdentifier(callee) && aliases.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && syncNames.has(callee.name.text))) {
        findings.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: synchronous child process`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

function registrationName(node) {
  if (!ts.isCallExpression(node)) return null;
  let target = node.expression;
  if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression)) {
    const method = target.expression.name.text;
    if (["skipIf", "runIf", "each"].includes(method)) target = target.expression.expression;
  }
  if (ts.isPropertyAccessExpression(target) && target.name.text === "each") target = target.expression;
  return ts.isIdentifier(target) && ["it", "test", "describe"].includes(target.text) ? target.text : null;
}

function isConditional(node) {
  return ts.isIfStatement(node) || ts.isConditionalExpression(node) ||
    (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
}

export function checkConditionalTests(source, file = "fixture.test.ts") {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  function visit(node, conditional = false) {
    const gated = conditional || isConditional(node);
    const registration = registrationName(node);
    if (registration) {
      if (gated) findings.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: conditional ${registration} registration`);
      const outer = node.expression;
      if (ts.isCallExpression(outer) && ts.isPropertyAccessExpression(outer.expression) && outer.expression.name.text === "each" && outer.arguments.some((arg) => isConditional(arg))) {
        findings.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: conditional .each data`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, gated));
  }
  visit(tree);
  return findings;
}

function filesUnder(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(name) : /(?<!\.d)\.tsx?$/.test(name) ? [name] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const fullScan = process.argv.length <= 2;
  const files = fullScan ? filesUnder("tests") : process.argv.slice(2);
  const exceptions = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
  if (!Array.isArray(exceptions) || exceptions.some((item) => !item?.file || !item?.reason) || new Set(exceptions.map((item) => item.file)).size !== exceptions.length) throw Error("Malformed D302 sync exceptions");
  const permitted = new Set(exceptions.map((item) => item.file));
  const seen = new Set();
  const findings = files.flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const conditional = /\.test\.tsx?$/.test(file) ? checkConditionalTests(source, file) : [];
    const sync = checkSyncChildren(source, file);
    const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
    if (sync.length && permitted.has(relative)) { seen.add(relative); return conditional; }
    return [...conditional, ...sync];
  });
  if (fullScan) for (const file of permitted) if (!seen.has(file)) findings.push(`${file}: stale D302 sync exception`);
  for (const finding of findings) console.error(finding);
  if (findings.length) process.exitCode = 1;
  else process.stdout.write(`Conditional registration PASS (${files.length} files)\n`);
}
