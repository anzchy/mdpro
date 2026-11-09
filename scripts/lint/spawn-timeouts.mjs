/**
 * Purpose: GH727 (#727) — find each tests/tooling test that reaches a child process but keeps Vitest's 5 s default
 * timeout. Part of the conditional-tests lint family; conditional-tests.mjs runs it and holds the findings to
 * scripts/lint/gh727-spawn-timeout-baseline.json.
 *
 * Key decisions: reachability is syntactic. It follows child_process imports, require and import(), local
 * declarations (a block-local name only within its block), assignments (file-wide), and relative imports export by
 * export. A timeout counts only when it is statically above 5 000 ms; anything unresolvable fails closed.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const MESSAGE = "spawning test without explicit timeout (give it spawnBudget(<worst alone ms>) or a numeric literal above 5000)";
const childModules = new Set(["node:child_process", "child_process"]);
const registrationRoots = new Set(["it", "test"]);
/** Vitest's default test timeout: a budget at or below it is not a budget. */
const DEFAULT_TIMEOUT_MS = 5_000;
/** spawnBudget's floor (tests/support/spawnBudget.ts): any valid measurement yields at least this. */
const SPAWN_BUDGET_FLOOR_MS = 15_000;

function unwrap(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}
/** The const initializer `identifier` names in its own or an enclosing block, or null. */
function constValue(identifier) {
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== identifier.text) continue;
        return statement.declarationList.flags & ts.NodeFlags.Const ? declaration.initializer ?? null : null;
      }
    }
  }
  return null;
}
/** The budget in ms that `node` sets, or null when it is not statically a number (fail closed). */
function budgetMs(node, seen = new Set()) {
  node = unwrap(node);
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
  if (ts.isIdentifier(node) && node.text !== "undefined" && !seen.has(node.text)) {
    const value = constValue(node);
    return value ? budgetMs(value, new Set([...seen, node.text])) : null;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "spawnBudget" &&
      node.arguments.length === 1 && budgetMs(node.arguments[0], seen) !== null) return SPAWN_BUDGET_FLOOR_MS;
  return null;
}
const explicit = (ms) => ms !== null && ms > DEFAULT_TIMEOUT_MS;
function optionsTimeout(node) {
  node = unwrap(node);
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const property = node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === "timeout");
  return property ? budgetMs(property.initializer) : undefined;
}
/** Whether a registration call carries an explicit budget: a timeout argument, or `{ timeout }` options. */
function hasBudget(call, callback) {
  return call.arguments.some((arg, index) => {
    if (index === 0 || arg === callback) return false;
    const fromOptions = optionsTimeout(arg);
    return fromOptions === undefined ? explicit(budgetMs(arg)) : explicit(fromOptions);
  });
}

function rootName(node) {
  let callee = node.expression;
  for (;;) {
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee)) callee = callee.expression;
    else return null;
  }
}
const registration = (node) => registrationRoots.has(rootName(node));
const suiteRoots = new Set(["describe", "suite"]);

/** Every identifier a declaration name binds, through object and array destructuring. */
function boundNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => (ts.isBindingElement(element) ? boundNames(element.name) : []));
  }
  return [];
}

/** The file a relative specifier names, trying the extensions this repo's tests use; null when none exists. */
function resolveImport(specifier, owner) {
  const base = path.resolve(path.dirname(owner), specifier);
  const bare = base.replace(/\.(m?js)$/, "");
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${bare}.ts`, `${bare}.tsx`, path.join(base, "index.ts")]
    .find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) ?? null;
}

const exported = (statement) => ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((item) => item.kind === ts.SyntaxKind.ExportKeyword);

/**
 * Which local names in `tree` reach a child process, and which of its exports do. Relative imports are followed by
 * export, through re-exports, with `cache` holding each module (an entry exists before its imports are read, so an
 * import cycle ends).
 */
function analyse(tree, file, cache) {
  const result = { spawning: new Set(), exports: new Set(), reaches: null };
  cache.set(file, result);
  const spawning = result.spawning;
  const moduleOf = (specifier) => {
    const target = specifier.startsWith(".") ? resolveImport(specifier, file) : null;
    if (!target) return null;
    if (cache.has(target)) return cache.get(target);
    const source = fs.readFileSync(target, "utf8");
    return analyse(ts.createSourceFile(target, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), target, cache);
  };
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause, bindings = clause.namedBindings;
    if (childModules.has(statement.moduleSpecifier.text)) {
      if (clause.name) spawning.add(clause.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) spawning.add(item.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) spawning.add(bindings.name.text);
      continue;
    }
    const other = moduleOf(statement.moduleSpecifier.text);
    if (!other) continue;
    if (clause.name && other.exports.has("default")) spawning.add(clause.name.text);
    if (bindings && ts.isNamespaceImport(bindings) && other.exports.size) spawning.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) if (other.exports.has((item.propertyName ?? item.name).text)) spawning.add(item.name.text);
    }
  }
  // `require("child_process")` and `import("child_process")` reach a child process wherever they appear.
  const loadsChild = (node) => ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) &&
    childModules.has(node.arguments[0].text) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"));
  // Declarations that reach a spawning name, to a fixed point (helpers of helpers, in any order). A name declared at
  // the top level, or assigned with `x = ...`, counts across the file; a name declared inside a block or function
  // counts only within that scope, so a same-named local elsewhere does not inherit it.
  const declarations = [];
  const scopeOf = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isSourceFile(parent)) return null;
      if (ts.isBlock(parent) || ts.isFunctionLike(parent) || ts.isForStatement(parent) || ts.isForOfStatement(parent) ||
          ts.isForInStatement(parent) || ts.isCaseBlock(parent)) return parent;
    }
    return null;
  };
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declarations.push([node.name.text, node.body, scopeOf(node)]);
    if (ts.isClassDeclaration(node) && node.name) declarations.push([node.name.text, node, scopeOf(node)]);
    if (ts.isVariableDeclaration(node) && node.initializer) for (const name of boundNames(node.name)) declarations.push([name, node.initializer, scopeOf(node)]);
    // `project = createProject()` in a hook: the variable carries what its value reaches, wherever it was declared.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) declarations.push([node.left.text, node.right, null]);
    ts.forEachChild(node, collect);
  };
  collect(tree);
  const scoped = [];
  const spawns = (identifier) => spawning.has(identifier.text) ||
    scoped.some(([name, scope]) => name === identifier.text && scope.pos <= identifier.pos && identifier.end <= scope.end);
  const reaches = (node) => {
    let hit = false;
    const visit = (child) => {
      if (hit) return;
      if ((ts.isIdentifier(child) && spawns(child)) || loadsChild(child)) hit = true;
      else ts.forEachChild(child, visit);
    };
    visit(node);
    return hit;
  };
  result.reaches = reaches;
  const marked = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const declaration of declarations) {
      const [name, body, scope] = declaration;
      if (marked.has(declaration) || (!scope && spawning.has(name)) || !reaches(body)) continue;
      marked.add(declaration);
      if (scope) scoped.push([name, scope]);
      else spawning.add(name);
      changed = true;
    }
  }
  for (const statement of tree.statements) {
    if (exported(statement) && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && spawning.has(statement.name.text)) {
      result.exports.add(statement.name.text);
    }
    if (exported(statement) && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) for (const name of boundNames(declaration.name)) if (spawning.has(name)) result.exports.add(name);
    }
    if (ts.isExportAssignment(statement) && reaches(statement.expression)) result.exports.add("default");
    if (!ts.isExportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? moduleOf(statement.moduleSpecifier.text) : null;
    if (!statement.exportClause) { for (const name of from?.exports ?? []) result.exports.add(name); continue; }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const item of statement.exportClause.elements) {
      const local = (item.propertyName ?? item.name).text;
      if (from ? from.exports.has(local) : spawning.has(local)) result.exports.add(item.name.text);
    }
  }
  return result;
}

/** The lint's scope: test files under tests/tooling, at any depth. */
export const inScope = (file) => /(^|\/)tests\/tooling\/(.+\/)?[^/]+\.test\.tsx?$/.test(file.replaceAll("\\", "/"));

export function checkSpawnTimeouts(source, file, cache = new Map()) {
  if (!inScope(file)) return [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { reaches } = analyse(tree, path.resolve(file), cache);
  // A top-level vi.setConfig({ testTimeout }) runs at collection, before any test, so it covers the whole file.
  const fileCovered = tree.statements.some((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const call = unwrap(statement.expression);
    return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "setConfig" &&
      call.arguments.some((arg) => {
        arg = unwrap(arg);
        if (!ts.isObjectLiteralExpression(arg)) return false;
        const property = arg.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === "testTimeout");
        return property !== undefined && explicit(budgetMs(property.initializer));
      });
  });
  const suiteCovered = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isCallExpression(parent) && suiteRoots.has(rootName(parent)) && parent.arguments.some((arg) => explicit(optionsTimeout(arg) ?? null))) return true;
    }
    return false;
  };
  const findings = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && registration(node)) {
      const callback = node.arguments.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      if (callback && reaches(callback) && !fileCovered && !hasBudget(node, callback) && !suiteCovered(node)) {
        findings.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${MESSAGE}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return findings;
}

/** True when anything in a test file (a test, a hook, a top-level call) reaches a child process. */
export function reachesSpawn(source, file, cache = new Map()) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return analyse(tree, path.resolve(file), cache).reaches(tree);
}
