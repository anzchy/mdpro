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

function unwrap(node) { while (ts.isParenthesizedExpression(node)) node = node.expression; return node; }
function unwrapValue(node) {
  node = unwrap(node);
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = unwrap(node.expression);
  return node;
}

const registrationRoots = new Set(["it", "test", "describe", "suite", "bench"]);
const allowedModifiers = new Set(["skipIf", "runIf", "each", "concurrent", "sequential", "only", "fails", "shuffle", "extend", "skip", "todo"]);
function accessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function registrationRoot(node, names, namespaces) {
  node = unwrapValue(node);
  if (ts.isIdentifier(node)) return names.has(node.text) ? node.text : null;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) return registrationRoot(node.right, names, namespaces);
  if (ts.isCallExpression(node)) return registrationRoot(node.expression, names, namespaces);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const member = accessName(node);
    const base = node.expression;
    if (ts.isIdentifier(base) && namespaces.has(base.text) && member && registrationRoots.has(member)) return member;
    if (ts.isIdentifier(base) && member && names.has(`${base.text}.${member}`)) return `${base.text}.${member}`;
    return registrationRoot(base, names, namespaces);
  }
  return null;
}
function registrationName(node, names, namespaces) {
  return ts.isCallExpression(node) ? registrationRoot(node.expression, names, namespaces) : null;
}

function isConditional(node) {
  node = unwrap(node);
  return ts.isIfStatement(node) || ts.isConditionalExpression(node) ||
    (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
}

export function checkConditionalTests(source, file = "fixture.test.ts") {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const names = new Set(registrationRoots), describeNames = new Set(["describe", "suite"]);
  const namespaces = new Set(), importedCalls = new Set(), guardedCollections = new Set(), unstableAliases = new Set(), unstableData = new Set();
  // Look up a constant in the scope containing its use. A same-named binding in
  // another function must never prove a runtime collection nonempty.
  function constInitializer(identifier) {
    function binds(name) {
      if (ts.isIdentifier(name)) return name.text === identifier.text;
      if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) return name.elements.some((element) => ts.isBindingElement(element) && binds(element.name));
      return false;
    }
    for (let scope = identifier.parent; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!binds(declaration.name)) continue;
          return ts.isIdentifier(declaration.name) && statement.declarationList.flags & ts.NodeFlags.Const ? declaration : null;
        }
      }
      if (ts.isBlock(scope) && (ts.isFunctionDeclaration(scope.parent) || ts.isFunctionExpression(scope.parent) || ts.isArrowFunction(scope.parent))) {
        if (scope.parent.parameters.some((parameter) => binds(parameter.name))) return null;
      }
    }
    return null;
  }
  function importMayRegister(specifier, owner, seen = new Set()) {
    const base = path.resolve(path.dirname(owner), specifier);
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, "index.ts")].find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile());
    if (!target) return true;
    if (seen.has(target)) return false;
    seen.add(target);
    const importedTree = ts.createSourceFile(target, fs.readFileSync(target, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of importedTree.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier?.text?.startsWith(".") && importMayRegister(statement.moduleSpecifier.text, target, seen)) return true;
      if (!ts.isImportDeclaration(statement)) continue;
      const moduleName = statement.moduleSpecifier.text;
      if (moduleName === "vitest") {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) return true;
        if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((item) => registrationRoots.has(item.propertyName?.text ?? item.name.text))) return true;
      }
      if (moduleName.startsWith(".") && importMayRegister(moduleName, target, seen)) return true;
    }
    return false;
  }
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.moduleSpecifier.text.endsWith("/collectionCases")) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName?.text ?? item.name.text) === "collectionCases") guardedCollections.add(item.name.text);
    }
    if (statement.moduleSpecifier.text.startsWith(".") && !statement.moduleSpecifier.text.endsWith("/collectionCases") && importMayRegister(statement.moduleSpecifier.text, file)) {
      if (statement.importClause?.name) importedCalls.add(statement.importClause.name.text);
      const imported = statement.importClause?.namedBindings;
      if (imported && ts.isNamedImports(imported)) for (const item of imported.elements) importedCalls.add(item.name.text);
      if (imported && ts.isNamespaceImport(imported)) importedCalls.add(imported.name.text);
    }
    if (statement.moduleSpecifier.text !== "vitest") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (registrationRoots.has(item.propertyName?.text ?? item.name.text)) names.add(item.name.text);
      if (["describe", "suite"].includes(item.propertyName?.text ?? item.name.text)) describeNames.add(item.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const at = (node, message) => findings.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${message}`);
  function definitelyNonEmpty(node, seen = new Set()) {
    node = unwrapValue(node);
    if (ts.isArrayLiteralExpression(node)) return node.elements.some((item) => !ts.isSpreadElement(item) || definitelyNonEmpty(item.expression, seen));
    if (ts.isIdentifier(node) && !unstableData.has(node.text)) {
      const declaration = constInitializer(node);
      if (declaration?.initializer && !seen.has(declaration)) return definitelyNonEmpty(declaration.initializer, new Set([...seen, declaration]));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["map", "entries"].includes(node.expression.name.text)) return definitelyNonEmpty(node.expression.expression, seen);
    return false;
  }
  function referencesRegistration(node) {
    node = unwrap(node);
    if (registrationRoot(node, names, namespaces)) return true;
    if (ts.isConditionalExpression(node)) return referencesRegistration(node.whenTrue) || referencesRegistration(node.whenFalse);
    return false;
  }
  // Resolve local aliases to a fixed point so alias-of-alias order does not hide registration.
  for (let changed = true; changed;) {
    changed = false;
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer &&
          (ts.isIdentifier(node.initializer) && namespaces.has(node.initializer.text) ||
           ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression) && node.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword && node.initializer.expression.arguments[0]?.text === "vitest")) {
        for (const element of node.name.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (ts.isIdentifier(element.name) && registrationRoots.has(imported) && !names.has(element.name.text)) { names.add(element.name.text); changed = true; }
          if (ts.isIdentifier(element.name) && ["describe", "suite"].includes(imported)) describeNames.add(element.name.text);
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) {
          const member = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;
          const value = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) ? property.initializer : null;
          if (member && value && referencesRegistration(value) && !names.has(`${node.name.text}.${member}`)) { names.add(`${node.name.text}.${member}`); changed = true; }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && referencesRegistration(node.initializer)) {
        if (!names.has(node.name.text)) { names.add(node.name.text); changed = true; }
        if (ts.isIdentifier(node.initializer) && describeNames.has(node.initializer.text) ||
            registrationRoot(node.initializer, names, namespaces) && ["describe", "suite"].includes(registrationRoot(node.initializer, names, namespaces))) describeNames.add(node.name.text);
        if (isConditional(node.initializer)) unstableAliases.add(node.name.text);
      }
      ts.forEachChild(node, collect);
    }
    collect(tree);
  }
  const helpers = new Set();
  function containsRegistration(node) {
    if (registrationName(node, names, namespaces)) return true;
    return ts.forEachChild(node, containsRegistration) === true;
  }
  for (let changed = true; changed;) {
    changed = false;
    function collect(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body && (containsRegistration(node.body) || containsHelperCall(node.body))) {
        if (!helpers.has(node.name.text)) { helpers.add(node.name.text); changed = true; }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ((ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) && (containsRegistration(node.initializer.body) || containsHelperCall(node.initializer.body)) ||
           ts.isIdentifier(node.initializer) && helpers.has(node.initializer.text))) {
        if (!helpers.has(node.name.text)) { helpers.add(node.name.text); changed = true; }
      }
      ts.forEachChild(node, collect);
    }
    collect(tree);
  }
  function containsHelperCall(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) return true;
    return ts.forEachChild(node, containsHelperCall) === true;
  }
  function conditionalData(node) {
    node = unwrap(node);
    if (isConditional(node)) return true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && guardedCollections.has(node.expression.text)) return false;
    return !definitelyNonEmpty(node);
  }
  // Data and registration aliases can be made conditional by a later assignment.
  const dataAliases = [];
  function collectAssignments(node, gated = false) {
    const now = gated || isConditional(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isConditional(node.initializer)) unstableData.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer)) dataAliases.push([node.name.text, node.initializer.text]);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      if (now || isConditional(node.right)) {
        unstableData.add(node.left.text);
        if (names.has(node.left.text)) unstableAliases.add(node.left.text);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "length" && ts.isIdentifier(node.left.expression)) unstableData.add(node.left.expression.text);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && ["pop", "shift", "splice", "fill", "copyWithin"].includes(node.expression.name.text)) unstableData.add(node.expression.expression.text);
    ts.forEachChild(node, (child) => collectAssignments(child, now));
  }
  collectAssignments(tree);
  for (let changed = true; changed;) {
    changed = false;
    for (const [left, right] of dataAliases) if (unstableData.has(left) || unstableData.has(right)) {
      if (!unstableData.has(left)) { unstableData.add(left); changed = true; }
      if (!unstableData.has(right)) { unstableData.add(right); changed = true; }
    }
  }
  function loopMayVanish(node) {
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const expression = unwrapValue(node.expression);
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && guardedCollections.has(expression.expression.text)) return false;
      return !definitelyNonEmpty(expression) || hasExitBeforeRegistration(node.statement);
    }
    if (ts.isForStatement(node)) return true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "forEach" && (containsRegistration(node) || node.arguments.some((argument) => ts.isIdentifier(argument) && helpers.has(argument.text) || containsHelperCall(argument)))) return !definitelyNonEmpty(node.expression.expression);
    return ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
  }
  function hasExitBeforeRegistration(body) {
    const exits = [], registrations = [];
    function scan(node) {
      if (ts.isContinueStatement(node) || ts.isBreakStatement(node)) exits.push(node.getStart(tree));
      if (registrationName(node, names, namespaces) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) registrations.push(node.getStart(tree));
      ts.forEachChild(node, scan);
    }
    scan(body);
    return exits.some((exit) => registrations.some((registration) => exit < registration));
  }
  function eachData(node) {
    let current = unwrap(node.expression);
    while (ts.isCallExpression(current) && (ts.isPropertyAccessExpression(current.expression) || ts.isElementAccessExpression(current.expression)) && allowedModifiers.has(accessName(current.expression))) {
      if (accessName(current.expression) === "each" && current.arguments.some(conditionalData)) return true;
      current = unwrap(current.expression.expression);
    }
    return false;
  }
  function unsupportedRegistrationAccess(node) {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    const member = accessName(node);
    if (ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) return !member || !registrationRoots.has(member);
    if (!registrationRoot(node.expression, names, namespaces)) return false;
    return !member || !allowedModifiers.has(member);
  }
  function returnBeforeRegistration(callback) {
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback) && !ts.isFunctionDeclaration(callback)) return;
    const returns = [], registrations = [];
    function scan(node) {
      if (node !== callback && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))) return;
      if (ts.isReturnStatement(node)) returns.push(node.getStart(tree));
      if (registrationName(node, names, namespaces) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) registrations.push(node);
      ts.forEachChild(node, scan);
    }
    scan(callback.body);
    for (const registration of registrations) if (returns.some((position) => position < registration.getStart(tree))) at(registration, "conditional registration after return");
  }
  function throwBeforeRegistration(block) {
    const throws = [], registrations = [];
    function scan(node) {
      if (node !== block && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) return;
      if (ts.isThrowStatement(node)) throws.push(node.getStart(tree));
      if (registrationName(node, names, namespaces) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) registrations.push(node);
      ts.forEachChild(node, scan);
    }
    scan(block);
    for (const registration of registrations) if (throws.some((position) => position < registration.getStart(tree))) at(registration, "conditional registration after throw");
  }
  function atCollectionCall(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionDeclaration(parent)) return false;
      if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
        if (!ts.isCallExpression(parent.parent) || !describeNames.has(registrationName(parent.parent, names, namespaces))) return false;
      }
    }
    return true;
  }
  function visit(node, conditional = false, collection = true) {
    const gated = conditional || isConditional(node) || loopMayVanish(node);
    const registration = registrationName(node, names, namespaces);
    if (unsupportedRegistrationAccess(node)) at(node, "unknown registration property");
    if (registration) {
      if (gated || unstableAliases.has(registration)) at(node, `conditional ${registration} registration`);
      if (eachData(node)) at(node, "conditional .each data");
      if (registration === "describe" || describeNames.has(registration)) for (const arg of node.arguments) returnBeforeRegistration(arg);
    }
    if (ts.isFunctionDeclaration(node) && node.name && helpers.has(node.name.text)) returnBeforeRegistration(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && helpers.has(node.name.text) && node.initializer) returnBeforeRegistration(node.initializer);
    if (collection && ts.isTryStatement(node)) throwBeforeRegistration(node.tryBlock);
    if (collection && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text) && gated) at(node, "conditional registration helper");
    if (collection && ts.isCallExpression(node) && gated && node.arguments.some((argument) => referencesRegistration(argument))) at(node, "conditional registration argument");
    if (collection && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "forEach" && gated && node.arguments.some((argument) => ts.isIdentifier(argument) && helpers.has(argument.text) || containsHelperCall(argument))) at(node, "conditional registration loop");
    if (collection && gated && atCollectionCall(node) && ts.isCallExpression(node) &&
        (ts.isIdentifier(node.expression) && importedCalls.has(node.expression.text) ||
         ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && importedCalls.has(node.expression.expression.text))) at(node, "unresolved conditional registration helper");
    const inTest = registration === "it" || registration === "test";
    ts.forEachChild(node, (child) => visit(child, gated, collection && !inTest));
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
  for (const finding of findings) process.stderr.write(`${finding}\n`);
  if (findings.length) process.exitCode = 1;
  else process.stdout.write(`Conditional registration PASS (${files.length} files)\n`);
}
